# হিফজ সহায়ক — Hifz helper (phone app)

A Quran memorisation helper that runs completely inside the phone browser: no server, no account. You recite, the
words of the text appear as you say them, mistakes turn red, and the app remembers where you keep getting stuck.
It is the phone version of a laptop app (Python + Gradio) and works the same way.

ফোনের ব্রাউজারেই চলে — তিলাওয়াত শুনে শব্দ খোলে, ভুল লাল করে, আর কোথায় বারবার আটকাও তা মনে রাখে।
**স্বয়ংক্রিয় চেক ভুল হতে পারে। এটা শিক্ষকের বিকল্প নয়, কোনো ধর্মীয় রায়ও নয়।**

## What it does

- **Recite page:** choose a surah (with an ayah range) or let the app find the surah and ayah from your recitation;
  words stay hidden until recited (memorise mode) or all shown (reading mode, the eye button); hint button; pause and
  resume; the app follows you from surah to surah, takes going back and reciting again in its stride, and warns when
  you wander into another surah. Only real mistakes turn red (a skipped word is re-heard before it turns red); words you
  added are marked too. Tap a red word to hear what you recited and Alafasy reciting the word in its place, or to say
  "I recited it right" (the same reading is then accepted at that place). After a silence of your choice Alafasy recites on
  from the next word (as hints) until you start again. Indo-Pak text and font, dark mode.
- **Progress page:** per surah the sessions, recent accuracy, how much was recited from memory and an ayah-by-ayah strip
  of weak places; a weak view with ayah map, the weakest stretches, and weak words by level (they fade after three right
  sessions in a row); tap a marked word to hear what you recited back then and clear a wrong mark.
- **Phone:** the model (about 19 MB) is downloaded once, then everything works offline; installable as an app; all data
  stays on the phone (IndexedDB) and can be exported to / imported from a file.

## How it works

`engine/` runs the speech model (onnxruntime-web, WASM, a worker), `core/` holds the logic (plain ES modules that also run in
Node: text rules, surah detection, the follower, history, feedback, review, store), `app/` is the page, `data/` the text and
word tables. `sw.js` makes the page work offline and adds the headers multi-threaded WASM needs on GitHub Pages.
`PORT.md` is the build log: plan, decisions, and the differences from the laptop app.

```
npm install        # dev dependencies only (onnxruntime-node/-web for the tests; the page uses vendor/)
npm test           # the whole test suite (Node)
python tools/serve.py 8765     # then open http://localhost:8765/
```

URL options for testing: `?fakemic=<wav url>` (a recording instead of the microphone, `&fakespeed=N`, `&fakeloop=1`),
`?mute=1` (no sound at all), `?slow=N` (every model call N times slower, to imitate a slow phone), `?threads=N`.

Tests compare the JavaScript against the laptop app's Python on thousands of cases (text rules, surah detection,
progress statistics, MFCC/DTW) and replay real recordings through both followers (`tests/`). The tests that need the
author's own recordings read them from the laptop app's folder and are skipped when it is absent; no recording of a person
is part of this repository.

## Credits and licences

- **Speech model:** [Abdou/quran-asr-tiny](https://huggingface.co/Abdou/quran-asr-tiny) (`models/quran-asr-tiny`, int8,
  unmodified), MIT licence (`models/quran-asr-tiny/LICENSE`). Not affiliated with its author.
- **onnxruntime-web 1.31.1** (`vendor/`), MIT licence, Microsoft. Fbank front end after Kaldi / sherpa-onnx (Apache 2.0).
- **Quran text:** Tanzil quran-simple (via api.alquran.cloud) in `data/quran.json`; the Uthmani spelling table
  `data/spelling.json` was made by aligning Tanzil's Uthmani text with it.
- **Indo-Pak text, Alafasy word timings and audio:** Quran.com (`data/indopak_words.json`, `data/alafasy_words.json`, audio
  streamed from download.quranicaudio.com); the Indo-Pak Nastaleeq font `fonts/indopak-nastaleeq-waqf-lazim-v4.2.1.woff2`
  from the quran.com frontend (licence as published there).
- **Icons:** Lucide (ISC licence).
- Mishary Rashid Alafasy's recitation belongs to its rights holders; it is only streamed, and the cached copy stays in
  the user's browser.
- This project is free, has no ads and is not for sale.
