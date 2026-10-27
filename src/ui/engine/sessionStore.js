// The last session (photo or sample, shapes, lines, segments) kept in the
// browser's IndexedDB, so a reload brings it back. Nothing leaves the device.
// Snapshot = { v: 1, sample, photo, name, guides, zones, segments }, where
// `sample` is the src of a sample (and `photo` null) or `photo` a JPEG Blob.

const DB = 'trencadis', STORE = 'session', KEY = 'last';
const typed = (a, Type) => a instanceof Type;
const dim = (n) => Number.isInteger(n) && n > 0;
// A grid { w, h } whose array `key` holds one entry per cell.
const grid = (g, key, Type) => !!g && dim(g.w) && dim(g.h) && typed(g[key], Type) && g[key].length === g.w * g.h;

// The snapshot to store. Shapes without a mode or without pixels are left out.
export function toSnapshot({ sample, photo, name, guides, zones, pixelsOf, segments }) {
  const kept = [];
  for (const z of zones) {
    const px = pixelsOf(z);
    if (!z.mode || !px?.region) continue;
    kept.push({ id: z.id, mode: z.mode, points: z.points, region: px.region, parts: px.parts ?? null });
  }
  return {
    v: 1, sample: sample ?? null, photo: photo ?? null, name, guides, zones: kept,
    segments: segments ? { w: segments.w, h: segments.h, labels: segments.labels, count: segments.count } : null,
  };
}

// The snapshot as stored, or null when it cannot be trusted: another version,
// no photo, or data that did not survive as it was written.
export function fromSnapshot(obj) {
  if (!obj || typeof obj !== 'object' || obj.v !== 1) return null;
  const hasSample = typeof obj.sample === 'string' && obj.sample;
  if (!hasSample && !(obj.photo instanceof Blob)) return null;
  if (!Array.isArray(obj.guides) || !Array.isArray(obj.zones)) return null;
  const pair = (pt) => Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite);
  // A line has a mode and its points; an erase (long press on a line) has the points it touched and a radius.
  for (const g of obj.guides) {
    if (!g) return null;
    if (g.erase !== undefined) {
      if (!Array.isArray(g.erase) || !g.erase.every(pair) || !Number.isFinite(g.radius)) return null;
    } else if (typeof g.mode !== 'string' || !Array.isArray(g.points) || !g.points.every(pair)) return null;
  }
  for (const z of obj.zones) {
    if (!z || !Array.isArray(z.points) || !grid(z.region, 'data', Uint8Array)) return null;
    if (!Array.isArray(z.region.box) || z.region.box.length !== 4 || !z.region.box.every(Number.isFinite)) return null;
    if (z.parts != null && !(grid(z.parts, 'labels', Int32Array) && Number.isInteger(z.parts.count) && z.parts.count >= 0)) return null;
  }
  const s = obj.segments;
  if (s != null && !(ArrayBuffer.isView(s.labels) && s.labels.length === s.w * s.h && dim(s.w) && dim(s.h) && Number.isInteger(s.count) && s.count > 0)) return null;
  return {
    v: 1, sample: hasSample ? obj.sample : null, photo: hasSample ? null : obj.photo,
    name: typeof obj.name === 'string' ? obj.name : 'foto',
    guides: obj.guides, zones: obj.zones, segments: s ?? null,
  };
}

const request = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

// load() gives the snapshot or null; save() stores one. Any error (private
// browsing, quota) is a null on load and nothing on save.
export function openSessionStore(idb = globalThis.indexedDB) {
  const open = () => {
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    return request(req);
  };
  return {
    async load() {
      try {
        const db = await open();
        try { return fromSnapshot(await request(db.transaction(STORE).objectStore(STORE).get(KEY))); } finally { db.close(); }
      } catch { return null; }
    },
    async save(snapshot) {
      try {
        const db = await open();
        try {
          const tx = db.transaction(STORE, 'readwrite');
          const done = new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = tx.onabort = () => reject(tx.error); });
          tx.objectStore(STORE).put(snapshot, KEY);
          await done;
        } finally { db.close(); }
      } catch { /* the session just is not kept */ }
    },
  };
}
