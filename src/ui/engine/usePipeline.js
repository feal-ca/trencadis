import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoGroutColor } from '../../core/color.js';
import { keysForStage } from '../../core/params.js';
import { createRenderer } from '../../gl/renderer.js';

// With ?debug in the URL, run timings are collected in window.__runs and the
// engine is reachable as window.__trencadis (for scripts).
export const DEBUG = typeof location !== 'undefined' && location.search.includes('debug');
const RENDER_KEYS = new Set(keysForStage('render'));

// Firefox's fingerprinting protection can return random pixels from canvas
// reads (until the user allows it). Its lighter mode only adds a little noise,
// which is fine, so the check tolerates small differences.
function canvasReadable() {
  try {
    const cv = new OffscreenCanvas(2, 1);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(1, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 2, 1).data;
    const near = (i, v) => Math.abs(d[i] - v) <= 12;
    return near(0, 255) && near(1, 0) && near(2, 0) && near(4, 0) && near(5, 0) && near(6, 255);
  } catch {
    return false;
  }
}

// Which pipeline work a change from `a` to `b` needs: 'none', 'render' or 'run'.
function changeKind(a, b) {
  if (!a) return 'run';
  let render = false;
  for (const k of Object.keys(b)) {
    if (a[k] === b[k]) continue;
    if (!RENDER_KEYS.has(k)) return 'run';
    render = true;
  }
  return render ? 'render' : 'none';
}

// Owns the pipeline worker and the WebGL renderer: sends them the photo and
// the settings, and keeps what they answer. `setAutoGrout` receives the grout
// colour chosen from each photo.
export function usePipeline(effective, setAutoGrout) {
  const [images, setImages] = useState({});
  const [labels, setLabels] = useState({});
  const [busy, setBusy] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [bitmap, setBitmap] = useState(null);
  const [mosaicReady, setMosaicReady] = useState(false);
  // Guide lines actually used for rows (drawn ones first), from the worker.
  const [lines, setLines] = useState({ drawn: 0, lines: [] });

  const worker = useRef(null);
  const runId = useRef(0);
  const sentAt = useRef(0);
  const wanted = useRef(['final']);
  const sent = useRef(null);
  const view = useRef([800, 600]);
  const frame = useRef(0);
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;

  const glCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.className = 'viewer-canvas';
    return c;
  }, []);
  const renderer = useMemo(() => {
    try { return createRenderer(glCanvas); } catch { return { ok: false }; }
  }, [glCanvas]);
  const gpu = renderer.ok;

  const requestRender = useCallback(() => {
    if (!renderer.ok || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const [cw, ch] = view.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const [W, H] = renderer.sizeFor(1000);
      const s = Math.min((cw * dpr) / W, (ch * dpr) / H, Math.min(4096, renderer.maxSize) / Math.max(W, H));
      renderer.render(effectiveRef.current, Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)));
    });
  }, [renderer]);

  // The settings of the run in flight, so its result can be read against them.
  const posted = useRef(null);

  useEffect(() => {
    const w = new Worker(new URL('../../worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
      if (data.id !== runId.current) return;
      if (data.type === 'progress') setBusy(data.stage);
      else if (data.type === 'stage') {
        setImages((prev) => {
          const next = { ...prev, ...Object.fromEntries(data.images.map((v) => [v.key, v.image])) };
          // Views of this stage that were not redrawn are out of date now.
          for (const k of data.stale ?? []) delete next[k];
          return next;
        });
        setLabels((prev) => ({ ...prev, ...Object.fromEntries(data.images.map((v) => [v.key, v.label])) }));
        if (renderer.ok && data.shards) {
          renderer.setShards(data.shards.map((poly, i) => ({ poly, row: data.rows?.[i] })), data.w, data.h, effectiveRef.current.seed);
        }
        if (renderer.ok && data.colors) {
          renderer.setColors(data.colors, effectiveRef.current.seed);
          setMosaicReady(true);
          requestRender();
        }
        if (data.lines) setLines(data.lines);
        if (data.stage === 'render') setMosaicReady(true);
      } else if (data.type === 'done') {
        if (DEBUG) (window.__runs ??= []).push({ ms: performance.now() - sentAt.current, timings: data.timings });
        setBusy(null);
        setInfo({ shards: data.shards, sMax: posted.current?.sMax });
      } else if (data.type === 'error') {
        setBusy(null);
        setError(data.message);
      }
    };
    worker.current = w;
    return () => w.terminate();
  }, [renderer, requestRender]);

  // Send the photo, resized to the working resolution, whenever either changes.
  // If the browser is hiding canvas pixels, wait for the first click and retry.
  const [readable, setReadable] = useState(canvasReadable);
  useEffect(() => {
    if (readable) return;
    setError('El navegador está ocultando los píxeles de las imágenes (protección contra el rastreo). Haz clic en la página; si sigue así, permite «extraer datos del canvas» en el icono de la barra de direcciones.');
    const retry = () => {
      if (canvasReadable()) { setError(null); setReadable(true); }
    };
    window.addEventListener('pointerdown', retry);
    window.addEventListener('keydown', retry);
    return () => {
      window.removeEventListener('pointerdown', retry);
      window.removeEventListener('keydown', retry);
    };
  }, [readable]);

  useEffect(() => {
    if (!bitmap || !worker.current || !readable) return;
    const s = effective.workLong / Math.max(bitmap.width, bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * s)), h = Math.max(1, Math.round(bitmap.height * s));
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const thumb = new OffscreenCanvas(64, Math.max(1, Math.round((64 * h) / w)));
    thumb.getContext('2d').drawImage(cv, 0, 0, thumb.width, thumb.height);
    setAutoGrout(autoGroutColor(thumb.getContext('2d').getImageData(0, 0, thumb.width, thumb.height).data));
    worker.current.postMessage({ type: 'image', image: data }, [data.data.buffer]);
    sent.current = null;
  }, [bitmap, effective.workLong, readable, setAutoGrout]);

  const post = useCallback((p) => {
    sent.current = p;
    posted.current = p;
    const id = ++runId.current;
    setError(null);
    setBusy('analysis');
    sentAt.current = performance.now();
    worker.current.postMessage({ type: 'run', id, params: p, views: wanted.current, cpuRender: !renderer.ok });
  }, [renderer]);

  useEffect(() => {
    if (!bitmap || !readable) return;
    const kind = changeKind(sent.current, effective);
    if (kind === 'none') return;
    if (kind === 'render' && renderer.ok) {
      sent.current = effective;
      requestRender();
      return;
    }
    const t = setTimeout(() => post(effective), 40);
    return () => clearTimeout(t);
  }, [effective, bitmap, readable, renderer, post, requestRender]);

  const rerun = useCallback(() => post(effectiveRef.current), [post]);

  // A new photo starts without the results of the old one.
  const resetResults = useCallback(() => {
    setImages({});
    setInfo(null);
    setMosaicReady(false);
  }, []);

  // The stage image on screen. The worker only draws this one after a run;
  // asking for it here draws it from the last result if it is missing.
  const setWanted = useCallback((key) => {
    wanted.current = key === 'original' ? ['original'] : [key];
    worker.current?.postMessage({ type: 'views', keys: wanted.current });
  }, []);

  const setViewport = useCallback((w, h) => {
    view.current = [w, h];
    requestRender();
  }, [requestRender]);

  return {
    worker, renderer, effectiveRef, glCanvas, gpu, bitmap, setBitmap, readable, images, labels, busy, info,
    error, setError, mosaicReady, lines, post, rerun, requestRender, setWanted, setViewport, resetResults,
  };
}
