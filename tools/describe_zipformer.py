"""Write the small files the web page needs next to a streaming zipformer CTC model:
io.json (chunk sizes, state tensor names and shapes: onnxruntime-web cannot read the model's metadata)
and ikhlas.json (the words and expected phonemes of Surah 112, for the page's accuracy check).
    python tools/describe_zipformer.py models/zipformer-quran-v3.1
Needs onnxruntime."""
import hashlib
import json
import sys
from pathlib import Path

import onnxruntime as ort

folder = Path(sys.argv[1])
model = next(folder.glob("*.onnx"))
sess = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
meta = sess.get_modelmeta().custom_metadata_map
inputs, outputs = sess.get_inputs(), sess.get_outputs()
assert inputs[0].name == "x" and len(inputs) == len(outputs)
io = {
    "model": model.name,
    "bytes": model.stat().st_size,
    "sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
    "T": int(meta["T"]),  # feature frames per call
    "shift": int(meta["decode_chunk_len"]),  # frames to move forward after each call
    "states": [{"name": a.name, "type": "int64" if "int64" in a.type else "float32",
                "dims": [d if isinstance(d, int) else 1 for d in a.shape]} for a in inputs[1:]],
    "outputs": [o.name for o in outputs],  # log_probs first, then the new states in the same order
}
(folder / "io.json").write_text(json.dumps(io, separators=(",", ":")), encoding="utf-8", newline="\n")
print(f"io.json: T={io['T']} shift={io['shift']} states={len(io['states'])} bytes={io['bytes']}")

phonemes = folder / "ordered_quran_phonemes.json"
if phonemes.exists():
    quran = json.loads(phonemes.read_text(encoding="utf-8"))
    # Words that merge in recitation are one phoneme word (112:4 "yakul-lahu"), so their text is shown together
    merged = {"112:4": [[0], [1, 2], [3], [4]]}
    ayahs = []
    for key in ("112:1", "112:2", "112:3", "112:4"):
        text, phon = quran[key]["aya_text"].split(), quran[key]["aya_phonemes_list"]
        groups = merged.get(key, [[i] for i in range(len(text))])
        assert len(groups) == len(phon) and sum(map(len, groups)) == len(text), key
        ayahs.append({"ayah": key, "words": [{"t": " ".join(text[i] for i in g), "p": p} for g, p in zip(groups, phon)]})
    (folder / "ikhlas.json").write_text(json.dumps(ayahs, ensure_ascii=False, separators=(",", ":")),
                                        encoding="utf-8", newline="\n")
    print("ikhlas.json:", sum(len(a["words"]) for a in ayahs), "words")
