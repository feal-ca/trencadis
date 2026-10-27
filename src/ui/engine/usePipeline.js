import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoGroutColor } from '../../core/color.js';
import { DRAFT_LONG, keysForStage } from '../../core/params.js';
import { createRenderer } from '../../gl/renderer.js';

// With ?debug in the URL, run timings are collected in window.__runs and the
// engine is reachable as window.__trencadis (for scripts).
export const DEBUG = typeof location !== 'undefined' && location.search.includes('debug');
// With ?nogl the renderer is skipped, to try the path of browsers without WebGL2.
const NOGL = typeof location !== 'undefined' && location.search.includes('nogl');
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
  const redrawTimer = useRef(0);
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;
  // The newest shards and colours from the worker, whether or not the GPU is
  // up, and whether they come from a draft.
  const latest = useRef({ shards: null, colors: null, draft: false });
  // A control is being dragged: runs are drafts until it is released.
  const dragging = useRef(false);
  // Whether the last run sent was a draft, so releasing needs a full one.
  const lastDraft = useRef(false);
  const debounce = useRef(0);
  // Callers waiting for the full result to replace a draft on screen.
  const fullWaiters = useRef([]);

  const glCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.className = 'viewer-canvas';
    return c;
  }, []);
  // The renderer is created before the callbacks that react to losing the
  // context, so it reaches them through these refs.
  const onLost = useRef(null);
  const onRestored = useRef(null);
  const renderer = useMemo(() => {
    if (NOGL) return { ok: false };
    try {
      return createRenderer(glCanvas, { onLost: () => onLost.current?.(), onRestored: () => onRestored.current?.() });
    } catch { return { ok: false }; }
  }, [glCanvas]);
  const [gpu, setGpu] = useState(renderer.ok);

  const requestRender = useCallback(() => {
    if (!renderer.ok || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const [cw, ch] = view.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const [W, H] = renderer.sizeFor(1000);
      const s = Math.min((cw * dpr) / W, (ch * dpr) / H, Math.min(4096, renderer.maxSize) / Math.max(W, H));
      // Draft shards are in pixels of the draft, so lengths scale from its size.
      const p = effectiveRef.current;
      renderer.render(latest.current.draft ? { ...p, workLong: Math.min(p.workLong, DRAFT_LONG) } : p,
        Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)));
    });
  }, [renderer]);

  // The settings of the run in flight, so its result can be read against them.
  const posted = useRef(null);
  // Exports waiting for the worker, by id.
  const exports = useRef(new Map());
  const exportId = useRef(0);
  // The long side the CPU render was last asked to draw at.
  const sentLong = useRef(0);

  const flushFull = useCallback(() => {
    for (const resolve of fullWaiters.current.splice(0)) resolve();
  }, []);
  // Resolves once a full run has finished, when a draft is on screen: its
  // shards and colours are both there only at `done`.
  const awaitFull = useCallback(() => (latest.current.draft
    ? new Promise((resolve) => fullWaiters.current.push(resolve))
    : Promise.resolve()), []);

  useEffect(() => {
    const w = new Worker(new URL('../../worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
      const waiting = exports.current.get(data.id);
      if (waiting) {
        exports.current.delete(data.id);
        if (data.type === 'exported') waiting.resolve(data.image);
        else waiting.reject(new Error(data.message));
        return;
      }
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
        // Kept even while the context is lost, so a restore uploads the latest.
        if (data.shards) {
          latest.current.draft = !!data.draft;
          latest.current.shards = { list: data.shards.map((poly, i) => ({ poly, row: data.rows?.[i] })), w: data.w, h: data.h };
          if (renderer.ok) renderer.setShards(latest.current.shards.list, data.w, data.h, effectiveRef.current.seed);
        }
        if (data.colors) {
          latest.current.colors = data.colors;
          if (renderer.ok) renderer.setColors(data.colors, effectiveRef.current.seed);
        }
        if (renderer.ok && data.colors) {
          setMosaicReady(true);
          requestRender();
        }
        if (data.lines) setLines(data.lines);
        if (data.stage === 'render') setMosaicReady(true);
      } else if (data.type === 'done') {
        if (!data.draft) flushFull();
        if (DEBUG) (window.__runs ??= []).push({ ms: performance.now() - sentAt.current, timings: data.timings, draft: data.draft });
        setBusy(null);
        setInfo({ shards: data.shards, sMax: posted.current?.sMax });
      } else if (data.type === 'error') {
        flushFull();
        setBusy(null);
        setError(data.message);
      }
    };
    worker.current = w;
    return () => w.terminate();
  }, [renderer, requestRender, flushFull]);

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

  // Without a GPU the screen needs the mosaic at screen size only; the download
  // is drawn apart (requestCpuExport).
  const cpuLongFor = useCallback((p) => {
    const [vw, vh] = view.current;
    return Math.min(p.outLong, Math.round(Math.max(vw, vh) * Math.min(2, window.devicePixelRatio || 1)));
  }, []);

  const post = useCallback((p) => {
    sent.current = p;
    sentLong.current = cpuLongFor(p);
    posted.current = p;
    // Below the draft size a draft would be the full run itself.
    const draft = dragging.current && p.workLong > DRAFT_LONG;
    lastDraft.current = draft;
    const id = ++runId.current;
    setError(null);
    setBusy('analysis');
    sentAt.current = performance.now();
    worker.current.postMessage({ type: 'run', id, params: p, views: wanted.current, cpuRender: !renderer.ok, cpuLong: sentLong.current, draft });
  }, [renderer, cpuLongFor]);

  useEffect(() => {
    if (!bitmap || !readable) return;
    const kind = changeKind(sent.current, effective);
    if (kind === 'none') return;
    if (kind === 'render' && renderer.ok) {
      sent.current = effective;
      requestRender();
      return;
    }
    const t = debounce.current = setTimeout(() => { debounce.current = 0; post(effective); }, 40);
    return () => { clearTimeout(t); debounce.current = 0; };
  }, [effective, bitmap, readable, renderer, post, requestRender]);

  const rerun = useCallback(() => post(effectiveRef.current), [post]);

  const dragStart = useCallback(() => { dragging.current = true; }, []);
  // Releasing a control redoes the last draft in full. A run still waiting in
  // the debounce will be sent in full by itself.
  const dragEnd = useCallback(() => {
    dragging.current = false;
    if (lastDraft.current && !debounce.current && sent.current) post(effectiveRef.current);
  }, [post]);
  // A control released outside the window or after a blur never gets its own
  // pointerup, so the app would stay in draft.
  useEffect(() => {
    window.addEventListener('pointerup', dragEnd);
    window.addEventListener('blur', dragEnd);
    return () => {
      window.removeEventListener('pointerup', dragEnd);
      window.removeEventListener('blur', dragEnd);
    };
  }, [dragEnd]);

  // A lost context moves the mosaic to the CPU; a restored one brings it back.
  onLost.current = () => {
    setGpu(false);
    setMosaicReady(false);
    if (bitmap && readable) rerun();
  };
  onRestored.current = () => {
    const { shards, colors } = latest.current;
    const seed = effectiveRef.current.seed;
    if (shards) renderer.setShards(shards.list, shards.w, shards.h, seed);
    if (colors) renderer.setColors(colors, seed);
    setGpu(true);
    // Without a mosaic yet, the next run fills the renderer.
    setMosaicReady(!!(shards && colors));
    requestRender();
  };

  // A new photo starts without the results of the old one.
  const resetResults = useCallback(() => {
    setImages({});
    latest.current = { shards: null, colors: null, draft: false };
    flushFull();
    setInfo(null);
    setMosaicReady(false);
  }, [flushFull]);

  // The stage image on screen. The worker only draws this one after a run;
  // asking for it here draws it from the last result if it is missing.
  const setWanted = useCallback((key) => {
    wanted.current = key === 'original' ? ['original'] : [key];
    worker.current?.postMessage({ type: 'views', keys: wanted.current });
  }, []);

  // The mosaic at export size, drawn by the worker from its last finished run.
  const requestCpuExport = useCallback(() => new Promise((resolve, reject) => {
    const id = `export-${++exportId.current}`;
    exports.current.set(id, { resolve, reject });
    worker.current.postMessage({ type: 'export', id });
  }), []);

  const setViewport = useCallback((w, h) => {
    view.current = [w, h];
    requestRender();
    // Without a GPU the mosaic on screen is redrawn when its size changes.
    if (!renderer.ok && sent.current && cpuLongFor(sent.current) !== sentLong.current) {
      clearTimeout(redrawTimer.current);
      redrawTimer.current = setTimeout(() => post(effectiveRef.current), 150);
    }
  }, [renderer, requestRender, cpuLongFor, post]);

  return {
    worker, renderer, effectiveRef, glCanvas, gpu, bitmap, setBitmap, readable, images, labels, busy, info,
    error, setError, mosaicReady, lines, post, rerun, dragStart, dragEnd, awaitFull, requestRender, requestCpuExport, setWanted, setViewport, resetResults,
  };
}
