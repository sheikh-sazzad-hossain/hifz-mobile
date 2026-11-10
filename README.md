# হিফজ মোবাইল — গতি পরীক্ষা

ফোনের ব্রাউজারেই কুরআন তিলাওয়াতের মডেল চালিয়ে দেখা: live হিফজ মোডের জন্য ফোন যথেষ্ট দ্রুত কি না।
সার্ভার নেই; মডেল আর অডিও দুটোই ফোনে থাকে। পরে এখানেই পুরো মোবাইল হিফজ অ্যাপ আসবে।

- `index.html`, `stream.js` — streaming পরীক্ষা: Quran-Lab zipformer (ধ্বনি-ভিত্তিক streaming CTC) পড়ার সাথে সাথে
  ধ্বনি লেখে, থামানোর পর গতি মাপে (RTF = ১ সেকেন্ড অডিওতে মডেলের কত সেকেন্ড লাগে)
- `zipformer-worker.js` — মডেল worker-এ চলে (onnxruntime-web 1.31.1, WASM); `fbank.js` — Kaldi-মাপের fbank;
  `mic-worklet.js` — মাইক থেকে ১৬ kHz অডিও
- `whisper.html`, `whisper.js` — আগের পরীক্ষা: Tarteel Whisper (transformers.js 4.3.2); ফোনে live-এর জন্য প্রায় ৫ গুণ ধীর
- `coi-serviceworker.js` — GitHub Pages-এ মাল্টি-থ্রেড WASM চালু করার জন্য COOP/COEP হেডার
- `models/` — ONNX মডেল (নিচে লাইসেন্স দেখো)
- `tools/convert_models.py` — Whisper মডেল রূপান্তর; `tools/describe_zipformer.py` — zipformer-এর `io.json` ও
  `ikhlas.json` বানায়; `tools/serve.py` — ল্যাপটপে পরীক্ষার সার্ভার

স্বয়ংক্রিয় চেক ভুল হতে পারে। এটা শিক্ষকের বিকল্প নয়, কোনো ধর্মীয় রায়ও নয়।

## Models and license

`models/whisper-tiny-ar-quran` and `models/whisper-base-ar-quran` are ONNX conversions of
[tarteel-ai/whisper-tiny-ar-quran](https://huggingface.co/tarteel-ai/whisper-tiny-ar-quran) and
[tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran) by Tarteel AI,
licensed under the Apache License 2.0 (`models/LICENSE`).
Changes: exported to ONNX with Optimum (merged decoder with KV cache), encoder also stored as fp16,
encoder and decoder dynamically quantized to int8, and a `generation_config.json` added
(taken from openai/whisper-tiny / whisper-base, with no suppress list) so transformers.js can set the
Arabic transcribe prefix. This project is not made by or affiliated with Tarteel AI.

`models/zipformer-quran-v3.1` holds `zipformer_p_arabic_v3.1.int8.onnx` and `tokens.txt`, unmodified, from
[Quran-Lab/zipformer_p-arabic-v3](https://huggingface.co/Quran-Lab/zipformer_p-arabic-v3) by Muno459 / Quran-Lab,
under the Quran-Lab No-Profit License 1.2 (`models/zipformer-quran-v3.1/LICENSE`): free to use and share,
never for sale, never behind a payment or ads, and anything derived from it stays under the same license.
The files were downloaded from the un-gated copy
[Ahmedhodzic/zipformer_p-arabic-v3-web](https://huggingface.co/Ahmedhodzic/zipformer_p-arabic-v3-web); the model's
SHA-256 (`31755836528da336a6192121cd7bc82cb41752dddb65566fd000b89c8686da6b`) is the one the original repository lists.
`io.json` (tensor names and shapes read from the model) and `ikhlas.json` (Surah 112 taken from the model's
`ordered_quran_phonemes.json`) are derived from it and fall under the same license.
This project is free, has no ads, and is not made by or affiliated with Quran-Lab.
