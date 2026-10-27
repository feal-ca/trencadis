import { useCallback, useEffect, useRef, useState } from 'react';
import { TOUCH } from '../useMedia.js';
import { DEBUG } from './usePipeline.js';

const FORMAT_STORE = 'trencadis.format.v1';
// Web Share with files: phones mostly, and Safari/Edge on desktop.
export const CAN_SHARE = typeof navigator !== 'undefined' && !!navigator.canShare
  && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });
// How long the mosaic must stay as it is before the share file is encoded.
const SETTLE_MS = 800;
const whenIdle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn) : setTimeout(fn, 0));
const cancelIdle = (id) => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id));

// The saved format; with none, JPG on phones (lighter to send) and PNG elsewhere.
function initialFormat() {
  try {
    const saved = localStorage.getItem(FORMAT_STORE);
    if (saved === 'png' || saved === 'jpg') return saved;
  } catch { /* storage unavailable */ }
  return typeof matchMedia !== 'undefined' && matchMedia(TOUCH).matches ? 'jpg' : 'png';
}

// Saving and sharing the mosaic at export size. `settings` is what a finished
// mosaic depends on: the effective parameters, the run's result and whether a
// run is in flight.
export function useExport({ photoName, renderer, effectiveRef, requestRender, requestCpuExport, awaitFull, setError, settings }) {
  const [format, setFormatState] = useState(initialFormat);
  const formatRef = useRef(format);
  formatRef.current = format;
  const setFormat = useCallback((f) => {
    setFormatState(f);
    try { localStorage.setItem(FORMAT_STORE, f); } catch { /* storage unavailable */ }
  }, []);

  // The mosaic at export size, as PNG or JPG.
  const exportFile = useCallback(async (format = formatRef.current) => {
    // The GPU may still hold a draft; a download is always the full mosaic.
    await awaitFull();
    if (DEBUG) (window.__exports ??= []).push({ runs: window.__runs?.length, draft: !!window.__runs?.at(-1)?.draft });
    const p = effectiveRef.current;
    const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
    let blob;
    if (renderer.ok) {
      blob = await renderer.toBlob(p, p.outLong, type, 0.9);
      requestRender();
    } else {
      // No GPU: the worker draws the download apart from what is on screen.
      const image = await requestCpuExport();
      const cv = document.createElement('canvas');
      cv.width = image.width;
      cv.height = image.height;
      cv.getContext('2d').putImageData(image, 0, 0);
      blob = await new Promise((r) => cv.toBlob(r, type, 0.9));
    }
    return blob && new File([blob], `trencadis-${photoName}-${p.algorithm}-${p.seed}.${format}`, { type });
  }, [photoName, renderer, requestRender, requestCpuExport, awaitFull]);

  // The export can fail without a GPU (the worker may have nothing to draw, or
  // run out of memory); the error goes to the status line like the others.
  const exportOrReport = useCallback(async (format) => {
    try {
      return await exportFile(format);
    } catch (e) {
      setError(e?.message || 'No se ha podido guardar el mosaico.');
      return null;
    }
  }, [exportFile, setError]);

  // The share file, encoded in the background once the mosaic has stood still.
  // `version` changes with anything it depends on, so a file made for an
  // earlier version is never used.
  const version = useRef(0);
  const prepared = useRef(null);
  const { effective, info, busy, mosaicReady } = settings;
  useEffect(() => {
    const mine = ++version.current;
    prepared.current = null;
    if (!CAN_SHARE || !mosaicReady || busy) return;
    let idle = 0;
    const timer = setTimeout(() => {
      idle = whenIdle(async () => {
        try {
          // Never a draft: wait for the full run if one is pending.
          await awaitFull();
          if (version.current !== mine) return;
          const file = await exportFile(format);
          if (file && version.current === mine) prepared.current = { format, file };
        } catch { /* the share will encode it again and report the failure */ }
      });
    }, SETTLE_MS);
    return () => { clearTimeout(timer); cancelIdle(idle); };
  }, [effective, info, busy, mosaicReady, format, exportFile, awaitFull]);

  const download = useCallback(async (f = formatRef.current) => {
    const file = await exportOrReport(f);
    if (!file) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [exportOrReport]);

  // Web Share with the image as a file (phones: save to Photos, send, post).
  // Falls back to a download if the browser refuses, e.g. when encoding took
  // long enough for the tap to stop counting as a user gesture.
  const share = useCallback(async (f = formatRef.current) => {
    // The file made while idle, if it is still for these settings.
    const ready = prepared.current?.format === f ? prepared.current.file : null;
    const file = ready ?? await exportOrReport(f);
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: 'Trencadís' });
    } catch (e) {
      if (e.name !== 'AbortError') download(f);
    }
  }, [exportOrReport, download]);

  return { download, share, format, setFormat };
}
