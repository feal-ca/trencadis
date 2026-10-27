import { useEffect, useRef } from 'react';
import { openSessionStore, toSnapshot } from './sessionStore.js';

// How long start-up waits for the database before giving up on it.
const LOAD_TIMEOUT = 2000;
// Pause after the last change before the session is written.
const SAVE_DELAY = 1000;

// The reduced bitmap as a JPEG, encoded once per bitmap (guide changes save
// again, the photo is not re-encoded).
const encoded = new WeakMap();
function jpegOf(bitmap) {
  if (!encoded.has(bitmap)) {
    const cv = new OffscreenCanvas(bitmap.width, bitmap.height);
    cv.getContext('2d').drawImage(bitmap, 0, 0);
    const blob = cv.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
    encoded.set(bitmap, blob);
    // A failed encoding is tried again by the next save.
    blob.catch(() => encoded.delete(bitmap));
  }
  return encoded.get(bitmap);
}

// Keeps the photo (or sample), touched shapes, lines and segments in
// IndexedDB, and brings the saved session back on start; without a usable one
// the first sample loads. A saved session that cannot be read is no error.
export function useSession({ samples, loadBlob, loadSample, chosen, rebaseHistory, setError, photoGen, zones, guides, sample, bitmap, photoName, segments }) {
  const store = useRef(null);
  store.current ??= openSessionStore();
  // The blob a photo was restored from, so saving it again does not re-encode it.
  const restored = useRef(null);

  // True once the user picked a photo or sample, or one loaded since `gen`:
  // start-up then leaves the screen alone.
  const taken = (gen) => chosen.current || photoGen.current !== gen;

  const restore = async (snap, gen0) => {
    const known = snap.sample && samples.find((s) => s.src === snap.sample);
    if (snap.sample && !known) return false;
    let blob = snap.photo;
    if (known) {
      const res = await fetch(known.src);
      if (!res.ok) return false;
      blob = await res.blob();
    }
    if (taken(gen0)) return true;
    const gen = photoGen.current;
    if (!(await loadBlob(blob, snap.name, snap.segments ?? known?.seg ?? null, known?.src ?? null))) {
      // Dropped for a photo chosen meanwhile: nothing failed.
      if (chosen.current) return true;
      setError(null);
      return false;
    }
    // Another photo chosen while this one loaded wins.
    if (photoGen.current !== gen + 1) return true;
    if (!known) restored.current = { gen: photoGen.current, blob };
    // The restored shapes and lines are where the history starts, not a step.
    if (snap.zones.length || snap.guides.length) rebaseHistory();
    zones.loadZones(snap.zones);
    guides.restoreGuides(snap.guides.map((g) => ({ ...g, gen: photoGen.current })));
    return true;
  };

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const gen0 = photoGen.current;
      const timeout = new Promise((resolve) => setTimeout(resolve, LOAD_TIMEOUT, null));
      const snap = await Promise.race([store.current.load(), timeout]);
      try {
        if (snap && await restore(snap, gen0)) return;
      } catch { /* a session that does not restore is as good as none */ }
      if (taken(gen0)) return;
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
