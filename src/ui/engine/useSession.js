import { useEffect, useRef } from 'react';
import { openSessionStore, toSnapshot } from './sessionStore.js';

// Pause after the last change before the session is written.
const SAVE_DELAY = 1000;

// The reduced bitmap as a JPEG, encoded once per bitmap (guide changes save
// again, the photo is not re-encoded).
const encoded = new WeakMap();
function jpegOf(bitmap) {
  if (!encoded.has(bitmap)) {
    const cv = new OffscreenCanvas(bitmap.width, bitmap.height);
    cv.getContext('2d').drawImage(bitmap, 0, 0);
    encoded.set(bitmap, cv.convertToBlob({ type: 'image/jpeg', quality: 0.92 }));
  }
  return encoded.get(bitmap);
}

// Keeps the photo (or sample), touched shapes, lines and segments in
// IndexedDB, and brings the saved session back on start; without a usable one
// the first sample loads. A saved session that cannot be read is no error.
export function useSession({ samples, loadBlob, loadSample, setError, photoGen, zones, guides, sample, bitmap, photoName, segments }) {
  const store = useRef(null);
  store.current ??= openSessionStore();
  // The blob a photo was restored from, so saving it again does not re-encode it.
  const restored = useRef(null);

  const restore = async (snap) => {
    const known = snap.sample && samples.find((s) => s.src === snap.sample);
    if (snap.sample && !known) return false;
    let blob = snap.photo;
    if (known) {
      const res = await fetch(known.src);
      if (!res.ok) return false;
      blob = await res.blob();
    }
    const gen = photoGen.current;
    if (!(await loadBlob(blob, snap.name, snap.segments ?? known?.seg ?? null, known?.src ?? null))) {
      setError(null);
      return false;
    }
    // Another photo chosen while this one loaded wins.
    if (photoGen.current !== gen + 1) return true;
    if (!known) restored.current = { gen: photoGen.current, blob };
    zones.loadZones(snap.zones);
    guides.restoreGuides(snap.guides.map((g) => ({ ...g, gen: photoGen.current })));
    return true;
  };

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const snap = await store.current.load();
      try {
        if (snap && await restore(snap)) return;
      } catch { /* a session that does not restore is as good as none */ }
      loadSample(samples[0].src);
    })();
  }, []);

  useEffect(() => {
    if (!bitmap) return;
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        let photo = null;
        if (!sample) {
          if (restored.current?.gen === photoGen.current && !encoded.has(bitmap)) encoded.set(bitmap, Promise.resolve(restored.current.blob));
          photo = await jpegOf(bitmap);
        }
        if (stale) return;
        await store.current.save(toSnapshot({
          sample, photo, name: photoName, guides: guides.guides, zones: zones.zones, pixelsOf: zones.pixelsOf, segments,
        }));
      } catch { /* the session just is not kept */ }
    }, SAVE_DELAY);
    return () => { stale = true; clearTimeout(timer); };
  }, [bitmap, sample, photoName, guides.guides, zones.zonesView, segments]);
}
