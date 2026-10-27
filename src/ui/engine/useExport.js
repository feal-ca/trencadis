import { useCallback, useEffect, useRef, useState } from 'react';
import { TOUCH } from '../useMedia.js';
import { drawSignature } from '../signature.js';
import { DEBUG } from './usePipeline.js';

const FORMAT_STORE = 'trencadis.format.v1';
const SIGN_STORE = 'trencadis.sign.v1';
const KOFI_STORE = 'trencadis.kofi.v1';
// Web Share with files: phones mostly, and Safari/Edge on desktop.
export const CAN_SHARE = typeof navigator !== 'undefined' && !!navigator.canShare
  && navigator.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] });
// How long the mosaic must stay as it is before the share file is encoded, and
// the largest download size that is encoded ahead (bigger ones wait for the tap).
const SETTLE_MS = 2500;
const AHEAD_MAX_LONG = 2000;
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

// The signature is on unless the user turned it off.
function initialSign() {
  try { return localStorage.getItem(SIGN_STORE) !== 'off'; } catch { return true; }
}

// The Ko-fi note appears once per browser, after the first successful download or share.
function kofiSeen() {
  try { return localStorage.getItem(KOFI_STORE) === 'shown'; } catch { return false; }
}

// Saving and sharing the mosaic at export size. `settings` is what a finished
// mosaic depends on: the effective parameters, the run's result and whether a
// run is in flight.
export function useExport({ photoName, renderer, effectiveRef, requestCpuExport, awaitFull, setError, settings }) {
  const [format, setFormatState] = useState(initialFormat);
  const formatRef = useRef(format);
  formatRef.current = format;
  const setFormat = useCallback((f) => {
    setFormatState(f);
    try { localStorage.setItem(FORMAT_STORE, f); } catch { /* storage unavailable */ }
  }, []);

  const [sign, setSignState] = useState(initialSign);
  const signRef = useRef(sign);
  signRef.current = sign;
  const setSign = useCallback((on) => {
    setSignState(on);
    try { localStorage.setItem(SIGN_STORE, on ? 'on' : 'off'); } catch { /* storage unavailable */ }
  }, []);

  // The Ko-fi note: shown after the first successful download or share, then never again.
  const [kofi, setKofi] = useState(false);
  const thanked = useRef(kofiSeen());
  const offerKofi = useCallback(() => {
    if (thanked.current) return;
    thanked.current = true;
    try { localStorage.setItem(KOFI_STORE, 'shown'); } catch { /* storage unavailable */ }
    setKofi(true);
  }, []);
  const closeKofi = useCallback(() => setKofi(false), []);

  // The mosaic at export size, as PNG or JPG, signed if asked. This is the one
  // encode step, so downloads, shares and the cached share file agree.
  const exportFile = useCallback(async (format = formatRef.current) => {
    // The GPU may still hold a draft; a download is always the full mosaic.
    await awaitFull();
    if (DEBUG) (window.__exports ??= []).push({ runs: window.__runs?.length, draft: !!window.__runs?.at(-1)?.draft });
    const p = effectiveRef.current;
    const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
    // On the GPU the pixels are read back in one task, with the screen frame
    // drawn again before it ends; without one the worker draws the download
    // apart from what is on screen.
    const image = renderer.ok ? renderer.pixels(p, p.outLong) : await requestCpuExport(p);
    const cv = document.createElement('canvas');
    cv.width = image.width;
    cv.height = image.height;
    const ctx = cv.getContext('2d');
    ctx.putImageData(image, 0, 0);
    if (signRef.current) await drawSignature(ctx, cv.width, cv.height);
    const blob = await new Promise((r) => cv.toBlob(r, type, 0.9));
    if (!blob) throw new Error('No se ha podido guardar el mosaico.');
    return new File([blob], `trencadis-${photoName}-${p.algorithm}-${p.seed}.${format}`, { type });
  }, [photoName, renderer, effectiveRef, requestCpuExport, awaitFull]);

  // The export can fail without a GPU (the worker may have nothing to draw, or
  // run out of memory); the error goes to the status line like the others.
  const exportOrReport = useCallback(async (format) => {
    try {
      const file = await exportFile(format);
      setError(null);
      return file;
    } catch (e) {
      setError(e?.message || 'No se ha podido guardar el mosaico.');
      return null;
    }
  }, [exportFile, setError]);

  // The share file, encoded in the background once the mosaic has stood still
  // and the tab is in view. Only on the GPU and up to AHEAD_MAX_LONG: without
  // one, or for a bigger file, it costs more than it saves, so the share
  // encodes it at the tap. It is keyed by what decides the output (photo,
  // settings, the run's result, format), so a file made for anything else is
  // never used and the same key is never encoded twice.
  const { effective, info, busy, mosaicReady } = settings;
  const infoIds = useRef(new WeakMap());
  const infoCount = useRef(0);
  if (info && !infoIds.current.has(info)) infoIds.current.set(info, ++infoCount.current);
  const key = `${photoName}|${info ? infoIds.current.get(info) : ''}|${format}|${sign}|${JSON.stringify(effective)}`;
  const current = useRef({ key, busy });
  current.current = { key, busy };
  const prepared = useRef(null);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  useEffect(() => {
    if (!CAN_SHARE || !renderer.ok || effective.outLong > AHEAD_MAX_LONG) return;
    if (!mosaicReady || busy || hidden || prepared.current?.key === key) return;
    let idle = 0;
    let stale = false;
    const timer = setTimeout(() => {
      idle = whenIdle(async () => {
        try {
          // Never a draft: wait for the full run if one is pending.
          await awaitFull();
          if (stale) return;
          const file = await exportFile(format);
          if (DEBUG) window.__shareStats = { ...window.__shareStats, background: (window.__shareStats?.background ?? 0) + 1 };
          if (file && !stale) prepared.current = { key, file };
        } catch { /* the share will encode it again and report the failure */ }
      });
    }, SETTLE_MS);
    return () => { stale = true; clearTimeout(timer); cancelIdle(idle); };
  }, [key, busy, mosaicReady, hidden, format, exportFile, awaitFull, renderer, effective.outLong]);

  const download = useCallback(async (f = formatRef.current) => {
    const file = await exportOrReport(f);
    if (!file) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    offerKofi();
  }, [exportOrReport, offerKofi]);

  // Web Share with the image as a file (phones: save to Photos, send, post).
  // Falls back to a download if the browser refuses, e.g. when encoding took
  // long enough for the tap to stop counting as a user gesture.
  const share = useCallback(async (f = formatRef.current) => {
    // The file made while idle, if it is still for these settings.
    const { key: now, busy: running } = current.current;
    const ready = !running && f === formatRef.current && prepared.current?.key === now ? prepared.current.file : null;
    if (DEBUG) window.__shareStats = { ...window.__shareStats, [ready ? 'cached' : 'atShare']: (window.__shareStats?.[ready ? 'cached' : 'atShare'] ?? 0) + 1 };
    const file = ready ?? await exportOrReport(f);
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: 'Trencadís' });
      offerKofi();
    } catch (e) {
      if (e.name !== 'AbortError') download(f);
    }
  }, [exportOrReport, download, offerKofi]);

  return { download, share, format, setFormat, sign, setSign, kofi, closeKofi };
}
