// The last session (photo or sample, shapes, lines, segments) kept in the
// browser's IndexedDB, so a reload brings it back. Nothing leaves the device.
// Snapshot = { v: 1, sample, photo, name, guides, zones, segments }, where
// `sample` is the src of a sample (and `photo` null) or `photo` a JPEG Blob.

const DB = 'trencadis', STORE = 'session', KEY = 'last';
const typed = (a, Type) => a instanceof Type;

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
  for (const z of obj.zones) {
    if (!z || !typed(z.region?.data, Uint8Array) || !Array.isArray(z.points)) return null;
    if (z.parts != null && !typed(z.parts.labels, Int32Array)) return null;
  }
  const s = obj.segments;
  if (s != null && !(ArrayBuffer.isView(s.labels) && s.w > 0 && s.h > 0)) return null;
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
