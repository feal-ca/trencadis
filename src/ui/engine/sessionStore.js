// The last session (the photo, or which sample) kept in the browser's
// IndexedDB, so a reload brings it back. Nothing leaves the device.
// Snapshot = { v: 2, sample, photo, name }: `sample` is a sample's src or
// null, and `photo` the photo as a Blob when it is not a sample.

const DB = 'trencadis', STORE = 'session', KEY = 'last';

export const toSnapshot = ({ sample, photo, name }) => ({ v: 2, sample: sample ?? null, photo: photo ?? null, name });

// The snapshot as stored, or null when it cannot be trusted: another version
// or no photo.
export function fromSnapshot(obj) {
  if (!obj || typeof obj !== 'object' || obj.v !== 2) return null;
  const hasSample = typeof obj.sample === 'string' && obj.sample;
  if (!hasSample && !(obj.photo instanceof Blob)) return null;
  return { v: 2, sample: hasSample ? obj.sample : null, photo: hasSample ? null : obj.photo, name: typeof obj.name === 'string' ? obj.name : 'foto' };
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
