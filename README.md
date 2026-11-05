# হিফজ মোবাইল — গতি পরীক্ষা

ফোনের ব্রাউজারেই Tarteel-এর Whisper মডেল চালিয়ে দেখা: ৫ সেকেন্ডের তিলাওয়াত থেকে আরবি লেখা পেতে কত সময় লাগে।
সার্ভার নেই; মডেল আর অডিও দুটোই ফোনে থাকে। পরে এখানেই পুরো মোবাইল হিফজ অ্যাপ আসবে।

- `index.html`, `app.js` — পরীক্ষার পেজ (transformers.js 4.3.2, WebGPU থাকলে এনকোডার GPU-তে, নইলে WASM)
- `coi-serviceworker.js` — GitHub Pages-এ মাল্টি-থ্রেড WASM চালু করার জন্য COOP/COEP হেডার
- `models/` — ONNX মডেল (নিচে লাইসেন্স দেখো)
- `tools/convert_models.py` — মডেল রূপান্তরের স্ক্রিপ্ট; `tools/serve.py` — ল্যাপটপে পরীক্ষার সার্ভার

## Models and license

`models/whisper-tiny-ar-quran` and `models/whisper-base-ar-quran` are ONNX conversions of
[tarteel-ai/whisper-tiny-ar-quran](https://huggingface.co/tarteel-ai/whisper-tiny-ar-quran) and
[tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran) by Tarteel AI,
licensed under the Apache License 2.0 (`models/LICENSE`).
Changes: exported to ONNX with Optimum (merged decoder with KV cache), encoder also stored as fp16,
encoder and decoder dynamically quantized to int8, and a `generation_config.json` added
(taken from openai/whisper-tiny / whisper-base, with no suppress list) so transformers.js can set the
Arabic transcribe prefix. This project is not made by or affiliated with Tarteel AI.
