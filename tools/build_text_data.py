"""Builds the text data files of the app (run once, output is committed):

    python -X utf8 tools/build_text_data.py <quran-simple.json> <hafs-uthmani.json>

  quran-simple.json  Tanzil "quran-simple" as served by api.alquran.cloud (the text the laptop app uses)
  hafs-uthmani.json  https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions/ara-quranuthmanihaf.json

Writes
  data/quran.json     {"surahs": [{"n", "name", "en", "a": [ayah text, ...]}]}  (compact copy of the simple text)
  data/spelling.json  {model word: standard word(s)}  the words quran-asr-tiny writes (Uthmani rasm without
                      harakat, alif forms folded) → the app's normalised standard spelling, built by aligning
                      the Uthmani text with the simple text ayah by ayah (method of the model's own
                      code/quran_asr/spelling.py, aimed at OUR text instead of the benchmark's).
"""
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---- the app's normalisation (same as quran.normalize of the laptop app) ----
_DIAC = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ﻿]")
_MAP = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ؤ": "و", "ئ": "ي", "ة": "ه"})
BASMALA = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"


def normalize(w):
    return _DIAC.sub("", w).translate(_MAP)


def words(text):
    return [w for w in text.replace("﻿", "").split() if normalize(w)]


# ---- the model's label normalisation (code/quran_asr/text.py of Abdou/quran-asr-tiny) ----
LETTERS = "ءابتثجحخدذرزسشصضطظعغفقكلمنهوي"
_FOLD = {"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ٲ": "ا", "ٳ": "ا", "ى": "ي", "ئ": "ي", "ے": "ي", "ی": "ي",
         "ؤ": "و", "ة": "ه", "ک": "ك"}


def _is_mark(c):
    o = ord(c)
    return 0x064B <= o <= 0x065F or o == 0x0670 or 0x06D6 <= o <= 0x06ED or o in (0x0640, 0x200F, 0x06DE) \
        or 0x0660 <= o <= 0x0669 or c.isdigit()


def model_word(word):
    out = []
    for c in word:
        if _is_mark(c):
            continue
        c = _FOLD.get(c, c)
        if c in LETTERS:
            out.append(c)
    return "".join(out)


def model_words(text):
    out = []
    for w in text.replace(" ", " ").split():
        w = model_word(w)
        if w in ("ا", "ي") and out:
            out[-1] += w
        elif w:
            out.append(w)
    return out


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i] + [0] * len(b)
        for j in range(1, len(b) + 1):
            cur[j] = min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] != b[j - 1]))
        prev = cur
    return prev[-1]


def skeleton(t):
    return t.replace("ا", "").replace("ء", "")


def align(u, s):
    def cost(a, b):
        a, b = skeleton(a.replace(" ", "")), skeleton(b.replace(" ", ""))
        return edit_distance(a, b) / max(1, len(a), len(b))
    inf = float("inf")
    best = [[inf] * (len(s) + 1) for _ in range(len(u) + 1)]
    back = {}
    best[0][0] = 0.0
    for i in range(len(u) + 1):
        for j in range(len(s) + 1):
            if best[i][j] == inf:
                continue
            for di, dj in ((1, 1), (1, 2), (2, 1)):
                if i + di <= len(u) and j + dj <= len(s):
                    c = best[i][j] + cost(" ".join(u[i:i + di]), " ".join(s[j:j + dj])) + 0.3 * (di + dj > 2)
                    if c < best[i + di][j + dj]:
                        best[i + di][j + dj], back[(i + di, j + dj)] = c, (i, j)
    if best[len(u)][len(s)] == inf:
        return []
    pairs, ij = [], (len(u), len(s))
    while ij != (0, 0):
        i0, j0 = back[ij]
        pairs.append((" ".join(u[i0:ij[0]]), " ".join(s[j0:ij[1]])))
        ij = (i0, j0)
    return pairs[::-1]


def main(simple_path, hafs_path):
    src = json.load(open(simple_path, encoding="utf-8"))["data"]["surahs"]
    surahs = [{"n": i + 1, "name": s["name"], "en": s["englishName"], "a": [a["text"] for a in s["ayahs"]]}
              for i, s in enumerate(src)]
    (ROOT / "data").mkdir(exist_ok=True)
    with open(ROOT / "data" / "quran.json", "w", encoding="utf-8") as f:
        json.dump({"surahs": surahs}, f, ensure_ascii=False, separators=(",", ":"))

    hafs = {(v["chapter"], v["verse"]): v["text"] for v in json.load(open(hafs_path, encoding="utf-8"))["quran"]}
    bas = [normalize(w) for w in words(BASMALA)]
    seen = collections.defaultdict(collections.Counter)
    exact = total = 0
    for s in surahs:
        for k, text in enumerate(s["a"], 1):
            ours = [normalize(w) for w in words(text)]
            if s["n"] not in (1, 9) and k == 1 and ours[:len(bas)] == bas:
                ours = ours[len(bas):]
            theirs = model_words(hafs[(s["n"], k)])
            pairs = list(zip(theirs, ours)) if len(theirs) == len(ours) else align(theirs, ours)
            for a, b in pairs:
                if " " not in a:
                    seen[a][b] += 1
            total += 1
            exact += theirs == ours
    table = {a: c.most_common(1)[0][0] for a, c in seen.items() if c.most_common(1)[0][0] != a}
    with open(ROOT / "data" / "spelling.json", "w", encoding="utf-8") as f:
        json.dump(table, f, ensure_ascii=False, indent=0, sort_keys=True)
    amb = sum(1 for a, c in seen.items() if len(c) > 1)
    print(f"surahs {len(surahs)}, ayahs {total} ({exact} identical without the table), table {len(table)} words, {amb} words with more than one target")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
