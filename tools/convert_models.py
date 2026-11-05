"""Convert Tarteel's Whisper models to ONNX for the browser (transformers.js).

Run with a Python that has optimum-onnx, onnxruntime, onnx, transformers, torch and accelerate
(without accelerate the export keeps a second copy of the tied embedding: tiny int8 decoder 50 MB, not 30):
    python -I tools/convert_models.py models [check.wav]

For each model it writes models/<name>/ (config, generation_config, preprocessor, tokenizer)
and models/<name>/onnx/:
    encoder_model.onnx                    fp32  WebGPU
    encoder_model_fp16.onnx               fp16  WebGPU on GPUs with shader-f16
    encoder_model_quantized.onnx          int8  WASM (CPU)
    decoder_model_merged_quantized.onnx   int8  decoder on the CPU (WASM)
    decoder_model_merged_fp16.onnx        fp16  decoder on the GPU (WebGPU)
The fp32 decoder is left out (tiny 118 MB, base 208 MB). GitHub refuses files over 100 MB, so a
bigger file keeps its weights in <=95 MB pieces (<file>.onnx_data, <file>.onnx_data_1, ...) and
config.json tells transformers.js how many ("transformers.js_config" -> use_external_data_format).

With a .wav it also checks every ONNX variant against the PyTorch model
(greedy, same <|ar|><|transcribe|><|notimestamps|> prefix) on the whole clip and its first 5 s.
"""
import json
import shutil
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np

MODELS = {  # folder name: (fine-tuned model, original Whisper it was trained from)
    "whisper-tiny-ar-quran": ("tarteel-ai/whisper-tiny-ar-quran", "openai/whisper-tiny"),
    "whisper-base-ar-quran": ("tarteel-ai/whisper-base-ar-quran", "openai/whisper-base"),
}
META = ["config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json"]
PREFIX = [50258, 50272, 50359, 50363]  # <|startoftranscript|> <|ar|> <|transcribe|> <|notimestamps|>
EOT = 50257
BEGIN_SUPPRESS = [220, 50257]
MAX_NEW = 128


def generation_config(whisper_id):
    """The fine-tunes ship no generation_config.json, but transformers.js needs the language and
    task tables to build PREFIX. Start from the original Whisper's file and switch off what the
    laptop app's HF generate() did not use either (no suppress list, no forced ids)."""
    from huggingface_hub import hf_hub_download

    with open(hf_hub_download(whisper_id, "generation_config.json"), encoding="utf-8") as f:
        g = json.load(f)
    g.update(suppress_tokens=[], forced_decoder_ids=None, begin_suppress_tokens=BEGIN_SUPPRESS, max_length=448)
    return g


def export(model_id, work):
    from optimum.exporters.onnx import main_export

    main_export(model_id, output=work, task="automatic-speech-recognition-with-past", device="cpu")


def quantize_int8(src, dst):
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic

    ops = {n.op_type for n in onnx.load(str(src), load_external_data=False).graph.node}
    # onnxruntime-web has no ConvInteger for int8 weights, so use uint8 when there is a Conv (encoder)
    weight = QuantType.QUInt8 if "Conv" in ops else QuantType.QInt8
    quantize_dynamic(str(src), str(dst), weight_type=weight, per_channel=False, reduce_range=False,
                     extra_options={"EnableSubgraph": True, "MatMulConstBOnly": True})


def _half(src):
    """fp16 inside, fp32 inputs/outputs (also the KV cache), so transformers.js needs no changes."""
    import onnx
    from onnxruntime.transformers.float16 import convert_float_to_float16

    model = convert_float_to_float16(onnx.load(str(src)), keep_io_types=True)
    _toposort(model.graph)  # the converter appends its Cast nodes at the end; onnx.checker wants order
    return model


def _toposort(graph):
    known = {i.name for i in graph.input} | {t.name for t in graph.initializer} | {""}
    todo, done = list(graph.node), []
    while todo:
        rest = []
        for node in todo:
            if all(i in known for i in node.input):
                done.append(node)
                known.update(node.output)
            else:
                rest.append(node)
        if len(rest) == len(todo):
            raise ValueError(f"cannot order nodes, e.g. {rest[0].name} needs {[i for i in rest[0].input if i not in known]}")
        todo = rest
    del graph.node[:]
    graph.node.extend(done)


def to_fp16(src, dst):
    """Returns the number of external weight pieces (0 = everything in the one file)."""
    return save_limited(_half(src), dst)


def to_fp16_decoder(decoder, decoder_with_past, dst):
    """Convert the two decoders first and merge them afterwards. Converting the merged model breaks
    its If-branches (the converter renames values inside them: "Subgraph output (logits) is an
    outer scope value being returned directly")."""
    import onnx
    from optimum.onnx import merge_decoders

    tmp = Path(decoder).with_name("decoder_model_merged_fp16.onnx")  # merge_decoders insists on a path
    merge_decoders(_half(decoder), _half(decoder_with_past), strict=False, save_path=tmp)
    return save_limited(onnx.load(str(tmp)), dst)


def _tensors(graph):
    """Every stored tensor, also the ones inside If-branches of the merged decoder."""
    yield from graph.initializer
    for node in graph.node:
        for a in node.attribute:
            if a.HasField("t"):
                yield a.t
            yield from a.tensors
            if a.HasField("g"):
                yield from _tensors(a.g)
            for g in a.graphs:
                yield from _tensors(g)


def save_limited(model, dst, limit=95_000_000):
    import onnx
    from onnx import numpy_helper
    from onnx.external_data_helper import set_external_data

    dst = Path(dst)
    for old in dst.parent.glob(dst.name + "_data*"):
        old.unlink()
    if model.ByteSize() < limit:
        onnx.save(model, str(dst))
        return 0
    pieces, offset, out = 0, 0, None
    for t in _tensors(model.graph):
        if not t.raw_data:  # move values from the typed fields to raw_data first
            if numpy_helper.to_array(t).nbytes < 4096:
                continue
            t.CopyFrom(numpy_helper.from_array(numpy_helper.to_array(t), t.name))
        if len(t.raw_data) < 4096:
            continue
        if out is None or (offset and offset + len(t.raw_data) > limit):
            if out:
                out.close()
            name = dst.name + "_data" + (f"_{pieces}" if pieces else "")
            out, offset, pieces = open(dst.parent / name, "wb"), 0, pieces + 1
        out.write(t.raw_data)
        set_external_data(t, location=name, offset=offset, length=len(t.raw_data))
        t.data_location = onnx.TensorProto.EXTERNAL
        offset += len(t.raw_data)
        t.ClearField("raw_data")
    out.close()
    onnx.save(model, str(dst))
    return pieces


# ---------------------------------------------------------------- checks

def read_wav(path):
    with wave.open(str(path)) as w:
        assert w.getsampwidth() == 2, "16-bit WAV only"
        rate, channels = w.getframerate(), w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    x = x.reshape(-1, channels).mean(1)
    if rate != 16000:  # linear resampling is enough for a check
        n = int(len(x) * 16000 / rate)
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    return x


class OnnxWhisper:
    """Greedy decoding with an encoder file and a merged decoder file, like transformers.js."""

    def __init__(self, folder, encoder, decoder):
        import onnxruntime as ort

        cpu = ["CPUExecutionProvider"]
        self.enc = ort.InferenceSession(str(encoder), providers=cpu)
        self.dec = ort.InferenceSession(str(decoder), providers=cpu)
        self.inputs = [i.name for i in self.dec.get_inputs()]
        self.outputs = [o.name for o in self.dec.get_outputs()]
        cfg = json.loads((folder / "config.json").read_text(encoding="utf-8"))
        self.heads = cfg["decoder_attention_heads"]
        self.dim = cfg["d_model"] // self.heads

    def __call__(self, feats):
        hidden = self.enc.run(None, {"input_features": feats})[0]
        empty = np.zeros((1, self.heads, 0, self.dim), np.float32)
        past = {n: empty for n in self.inputs if n.startswith("past_key_values")}
        ids, out = list(PREFIX), []
        for step in range(MAX_NEW):
            feed = {"input_ids": np.array([ids if step == 0 else ids[-1:]], np.int64),
                    "encoder_hidden_states": hidden, "use_cache_branch": np.array([step > 0]), **past}
            missing = [n for n in self.inputs if n not in feed]
            assert not missing, f"decoder wants inputs transformers.js may not give: {missing}"
            res = dict(zip(self.outputs, self.dec.run(None, {n: feed[n] for n in self.inputs})))
            logits = res["logits"][0, -1].astype(np.float32)
            if step == 0:
                logits[BEGIN_SUPPRESS] = -np.inf
            tok = int(logits.argmax())
            if tok == EOT:
                break
            ids.append(tok)
            out.append(tok)
            for name, value in res.items():
                key = name.replace("present", "past_key_values")
                if name.startswith("present") and (step == 0 or ".decoder." in key):
                    past[key] = value
        return out


def torch_greedy(model_id, feats):
    import torch
    from transformers import WhisperForConditionalGeneration

    model = WhisperForConditionalGeneration.from_pretrained(model_id).eval()
    with torch.no_grad():
        enc = model.model.encoder(torch.from_numpy(feats)).last_hidden_state
        ids, out = list(PREFIX), []
        for step in range(MAX_NEW):
            logits = model(encoder_outputs=(enc,), decoder_input_ids=torch.tensor([ids])).logits[0, -1]
            if step == 0:
                logits[BEGIN_SUPPRESS] = -float("inf")
            tok = int(logits.argmax())
            if tok == EOT:
                break
            ids.append(tok)
            out.append(tok)
    return out


def check(name, model_id, folder, fp32_decoder, wav):
    from transformers import AutoTokenizer, WhisperFeatureExtractor

    fe = WhisperFeatureExtractor.from_pretrained(str(folder))
    tok = AutoTokenizer.from_pretrained(str(folder))
    audio = read_wav(wav)
    clips = {"full": audio[: 30 * 16000], "first 5 s": audio[: 5 * 16000]}
    onnx_dir = folder / "onnx"
    variants = {
        "onnx fp32": (onnx_dir / "encoder_model.onnx", fp32_decoder),
        "onnx fp16 (GPU set)": (onnx_dir / "encoder_model_fp16.onnx", onnx_dir / "decoder_model_merged_fp16.onnx"),
        "onnx fp16 enc + int8 dec": (onnx_dir / "encoder_model_fp16.onnx", onnx_dir / "decoder_model_merged_quantized.onnx"),
        "onnx fp32 enc + int8 dec": (onnx_dir / "encoder_model.onnx", onnx_dir / "decoder_model_merged_quantized.onnx"),
        "onnx int8 (wasm set)": (onnx_dir / "encoder_model_quantized.onnx", onnx_dir / "decoder_model_merged_quantized.onnx"),
    }
    for clip, x in clips.items():
        feats = fe(x, sampling_rate=16000, return_tensors="np").input_features.astype(np.float32)
        ref = torch_greedy(model_id, feats)
        print(f"\n[{name}] {clip} ({len(x) / 16000:.1f} s)\n  pytorch : {tok.decode(ref, skip_special_tokens=True)}")
        for label, (enc, dec) in variants.items():
            try:
                runner = OnnxWhisper(folder, enc, dec)
                t = time.perf_counter()
                got = runner(feats)
                ms = (time.perf_counter() - t) * 1000
                same = "SAME" if got == ref else f"diff ({sum(a != b for a, b in zip(got, ref)) + abs(len(got) - len(ref))} tok)"
                print(f"  {label:26s}: {same:12s} {ms:6.0f} ms  {tok.decode(got, skip_special_tokens=True)}")
            except Exception as e:  # report and go on with the other variants
                print(f"  {label:26s}: ERROR {type(e).__name__}: {e}")


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # Arabic in the check lines
    args = [a for a in sys.argv[1:] if not a.startswith("--only=")]
    only = next((a[7:] for a in sys.argv[1:] if a.startswith("--only=")), "")  # e.g. --only=tiny
    root = Path(args[0]).resolve()
    wav = Path(args[1]) if len(args) > 1 else None
    for name, (model_id, whisper_id) in MODELS.items():
        if only not in name:
            continue
        dst = root / name
        (dst / "onnx").mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            print(f"== export {model_id}", flush=True)
            export(model_id, work)
            print("   exported:", sorted(p.name for p in work.glob("*.onnx")), flush=True)
            for f in META:
                shutil.copy(work / f, dst / f)
            (dst / "generation_config.json").write_text(json.dumps(generation_config(whisper_id), indent=2), encoding="utf-8")
            shutil.copy(work / "encoder_model.onnx", dst / "onnx" / "encoder_model.onnx")
            pieces = {"encoder_model_fp16.onnx": to_fp16(work / "encoder_model.onnx", dst / "onnx" / "encoder_model_fp16.onnx"),
                      "decoder_model_merged_fp16.onnx": to_fp16_decoder(work / "decoder_model.onnx", work / "decoder_with_past_model.onnx",
                                                                        dst / "onnx" / "decoder_model_merged_fp16.onnx")}
            quantize_int8(work / "encoder_model.onnx", dst / "onnx" / "encoder_model_quantized.onnx")
            quantize_int8(work / "decoder_model_merged.onnx", dst / "onnx" / "decoder_model_merged_quantized.onnx")
            cfg = json.loads((dst / "config.json").read_text(encoding="utf-8"))
            cfg["transformers.js_config"] = {"use_external_data_format": {k: v for k, v in pieces.items() if v}}
            (dst / "config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")
            for p in sorted((dst / "onnx").iterdir()):
                print(f"   {p.name:40s} {p.stat().st_size / 1e6:6.1f} MB", flush=True)
            if wav:
                check(name, model_id, dst, work / "decoder_model_merged.onnx", wav)


if __name__ == "__main__":
    main()
