// Where the app keeps its data: sessions, weak words, accepted readings, settings (JSON values) and recordings / clips
// (Float32Array at 16 kHz). The page uses IndexedDB; tests and Node use a memory backend with the same interface.
//   const store = await openStore(backend)    backend: idbBackend() | memoryBackend()
//   store.get(key, default) / store.set(key, value)         JSON values (key: "sessions", "weak", "accepted", "index", "settings")
//   store.getBlob(kind, name) / store.putBlob(kind, name, Float32Array) / store.hasBlob / store.blobNames(kind) / store.deleteBlob
//   store.exportAll() → JSON-able object (blobs as base64 16-bit PCM)   store.importAll(obj, { merge })
// kind: "recordings" (each session's audio), "clips" (accepted readings), "marks" (clips of red words kept for review).
const DB = 'hifz-mobile';
const VERSION = 1;

export function memoryBackend() {
  const kv = new Map();
  const blobs = new Map();
  return {
    async getKv(key) { return kv.has(key) ? structuredClone(kv.get(key)) : undefined; },
    async setKv(key, value) { kv.set(key, structuredClone(value)); },
    async getBlob(kind, name) { return blobs.get(`${kind}/${name}`); },
    async putBlob(kind, name, data) { blobs.set(`${kind}/${name}`, data.slice()); },
    async deleteBlob(kind, name) { blobs.delete(`${kind}/${name}`); },
    async blobNames(kind) { return [...blobs.keys()].filter((k) => k.startsWith(`${kind}/`)).map((k) => k.slice(kind.length + 1)); },
    async clear() { kv.clear(); blobs.clear(); },
  };
}

export function idbBackend(name = DB) {
  let dbp = null;
  const db = () => dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); req.result.createObjectStore('blobs'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (store, mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    getKv: (key) => tx('kv', 'readonly', (s) => s.get(key)),
    setKv: (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key)),
    getBlob: (kind, n) => tx('blobs', 'readonly', (s) => s.get(`${kind}/${n}`)),
    putBlob: (kind, n, data) => tx('blobs', 'readwrite', (s) => s.put(data, `${kind}/${n}`)),
    deleteBlob: (kind, n) => tx('blobs', 'readwrite', (s) => s.delete(`${kind}/${n}`)),
    blobNames: async (kind) => (await tx('blobs', 'readonly', (s) => s.getAllKeys())).filter((k) => k.startsWith(`${kind}/`)).map((k) => k.slice(kind.length + 1)),
    clear: async () => { await tx('kv', 'readwrite', (s) => s.clear()); await tx('blobs', 'readwrite', (s) => s.clear()); },
  };
}

const toI16 = (f32) => {
  const pcm = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
  return pcm;
};
const toF32 = (pcm) => Float32Array.from(pcm, (v) => v / 32767);

const toB64 = (f32) => {
  const pcm = toI16(f32);
  let s = '';
  const bytes = new Uint8Array(pcm.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64) => {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer);
  return Float32Array.from(pcm, (v) => v / 32767);
};

const KV_KEYS = ['sessions', 'weak', 'accepted', 'index', 'settings'];
const KINDS = ['recordings', 'clips', 'marks'];

export async function openStore(backend = memoryBackend()) {
  const cache = {};
  for (const k of KV_KEYS) cache[k] = await backend.getKv(k);
  const store = {
    backend,
    // JSON values are kept in memory too (history.js works on plain objects); set() writes through.
    get: (key, fallback) => (cache[key] === undefined ? fallback : cache[key]),
    async set(key, value) { cache[key] = value; await backend.setKv(key, value); },
    // audio is kept as 16-bit PCM (half the space) and comes back as Float32Array
    async getBlob(kind, name) { const v = await backend.getBlob(kind, name); return v === undefined ? undefined : toF32(v); },
    putBlob: (kind, name, data) => backend.putBlob(kind, name, toI16(data)),
    deleteBlob: (kind, name) => backend.deleteBlob(kind, name),
    blobNames: (kind) => backend.blobNames(kind),
    async hasBlob(kind, name) { return (await backend.getBlob(kind, name)) !== undefined; },
    async blobBytes(kind) { let n = 0; for (const name of await backend.blobNames(kind)) n += ((await backend.getBlob(kind, name))?.length ?? 0) * 2; return n; },

    // A file with everything (for backup / moving to another phone). Recordings are 16-bit PCM in base64.
    async exportAll() {
      const out = { app: 'hifz-mobile', version: 1, kv: {}, blobs: {} };
      for (const k of KV_KEYS) if (cache[k] !== undefined) out.kv[k] = cache[k];
      for (const kind of KINDS) {
        out.blobs[kind] = {};
        for (const n of await backend.blobNames(kind)) out.blobs[kind][n] = toB64(toF32(await backend.getBlob(kind, n)));
      }
      return out;
    },

    // merge: add the file's sessions / marks to what is here (otherwise the file replaces everything).
    async importAll(obj, { merge = false } = {}) {
      if (obj?.app !== 'hifz-mobile') throw new Error('not a hifz-mobile file');
      if (!merge) await backend.clear();
      for (const k of KV_KEYS) cache[k] = merge ? cache[k] : undefined;
      const theirs = obj.kv ?? {};
      if (merge) {
        const sessions = [...(cache.sessions ?? [])];
        for (const s of theirs.sessions ?? []) if (!sessions.some((x) => x.start === s.start && x.surah === s.surah)) sessions.push(s);
        sessions.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.surah - b.surah));
        cache.sessions = sessions;
        cache.weak = { ...(theirs.weak ?? {}), ...(cache.weak ?? {}) }; // what is here wins
        const acc = cache.accepted ?? { places: {}, log: [] };
        for (const [p, items] of Object.entries(theirs.accepted?.places ?? {})) {
          const mine = (acc.places[p] ??= []);
          for (const it of items) if (!mine.some((m) => m.clip === it.clip && m.heard === it.heard)) mine.push(it);
        }
        acc.log = [...acc.log, ...(theirs.accepted?.log ?? []).filter((l) => !acc.log.some((m) => m.time === l.time && m.place === l.place))];
        cache.accepted = acc;
        cache.index = { ...(theirs.index ?? {}), ...(cache.index ?? {}) };
        cache.settings = { ...(theirs.settings ?? {}), ...(cache.settings ?? {}) };
      } else {
        for (const k of KV_KEYS) cache[k] = theirs[k];
      }
      for (const k of KV_KEYS) if (cache[k] !== undefined) await backend.setKv(k, cache[k]);
      for (const kind of KINDS) for (const [n, b64] of Object.entries(obj.blobs?.[kind] ?? {})) {
        if (!merge || !(await backend.getBlob(kind, n))) await backend.putBlob(kind, n, toI16(fromB64(b64)));
      }
    },
  };
  return store;
}

// History / feedback / review need synchronous reads of their clips, so the page loads the blob names it will need
// into memory first (loadBlobs) and writes new ones through.
export async function blobCache(store, kind) {
  const map = new Map();
  for (const n of await store.blobNames(kind)) map.set(n, await store.getBlob(kind, n));
  return {
    get: (n) => map.get(n),
    has: (n) => map.has(n),
    put(n, data) { map.set(n, data); return store.putBlob(kind, n, data); },
    names: () => [...map.keys()],
  };
}
