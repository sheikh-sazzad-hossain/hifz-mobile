// Port of Python's difflib.SequenceMatcher for short strings (no junk handling: strings under 200 characters,
// which is all the app compares). Same matching blocks, opcodes and ratio as Python, tie-breaks included.
export class SequenceMatcher {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this.b2j = new Map();
    for (let j = 0; j < b.length; j++) {
      const c = b[j];
      if (!this.b2j.has(c)) this.b2j.set(c, []);
      this.b2j.get(c).push(j);
    }
    this._blocks = null;
  }

  findLongestMatch(alo, ahi, blo, bhi) {
    const { a, b2j } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    return [besti, bestj, bestsize];
  }

  matchingBlocks() {
    if (this._blocks) return this._blocks;
    const la = this.a.length;
    const lb = this.b.length;
    const queue = [[0, la, 0, lb]];
    const found = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const x = this.findLongestMatch(alo, ahi, blo, bhi);
      const [i, j, k] = x;
      if (k) {
        found.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    found.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const out = [];
    for (const [i2, j2, k2] of found) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
      else {
        if (k1) out.push([i1, j1, k1]);
        i1 = i2; j1 = j2; k1 = k2;
      }
    }
    if (k1) out.push([i1, j1, k1]);
    out.push([la, lb, 0]);
    this._blocks = out;
    return out;
  }

  opcodes() {
    let i = 0;
    let j = 0;
    const out = [];
    for (const [ai, bj, size] of this.matchingBlocks()) {
      let tag = '';
      if (i < ai && j < bj) tag = 'replace';
      else if (i < ai) tag = 'delete';
      else if (j < bj) tag = 'insert';
      if (tag) out.push([tag, i, ai, j, bj]);
      i = ai + size;
      j = bj + size;
      if (size) out.push(['equal', ai, i, bj, j]);
    }
    return out;
  }

  ratio() {
    const total = this.a.length + this.b.length;
    if (!total) return 1;
    let m = 0;
    for (const [, , k] of this.matchingBlocks()) m += k;
    return (2 * m) / total;
  }
}
