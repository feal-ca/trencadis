import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyMacroDefaults } from '../core/macros.js';
import { DEFAULTS, keysForStage } from '../core/params.js';
import { createRenderer } from '../gl/renderer.js';

const STORE = 'trencadis.params.v2';
// With ?debug in the URL, run timings are collected in window.__runs.
const DEBUG = typeof location !== 'undefined' && location.search.includes('debug');
const RENDER_KEYS = new Set(keysForStage('render'));
// Render keys that are lengths in working pixels (halved for preview geometry).
const LENGTH_KEYS = ['grout', 'bevel'];

export const SAMPLES = [
  { src: './samples/vermeer.jpg', label: 'Vermeer' },
  { src: './samples/vangogh.jpg', label: 'Van Gogh' },
];

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved) return { ...applyMacroDefaults(DEFAULTS), ...saved };
  } catch { /* storage unavailable */ }
  return applyMacroDefaults(DEFAULTS);
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

// Owns the worker, the WebGL renderer and the current parameters.
export function useEngine() {
  const [params, setParams] = useState(loadParams);
  const [images, setImages] = useState({});
  const [labels, setLabels] = useState({});
  const [busy, setBusy] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [bitmap, setBitmap] = useState(null);
  const [mosaicReady, setMosaicReady] = useState(false);

  const worker = useRef(null);
  const runId = useRef(0);
  const sentAt = useRef(0);
  const wanted = useRef(['final']);
  const sent = useRef(null);
  const dragging = useRef(false);
  const lastWasPreview = useRef(false);
  const geomScale = useRef(1);
  const view = useRef([800, 600]);
  const frame = useRef(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const glCanvas = useMemo(() => {
    const c = document.createElement('canvas');
    c.className = 'viewer-canvas';
    return c;
  }, []);
  const renderer = useMemo(() => {
    try { return createRenderer(glCanvas); } catch { return { ok: false }; }
  }, [glCanvas]);
  const gpu = renderer.ok;

  const scaled = (p) => {
    const q = { ...p };
    for (const k of LENGTH_KEYS) q[k] *= geomScale.current;
    return q;
  };

  const requestRender = useCallback(() => {
    if (!renderer.ok || frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const [cw, ch] = view.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const [W, H] = renderer.sizeFor(1000);
      const s = Math.min((cw * dpr) / W, (ch * dpr) / H, 2400 / Math.max(W, H));
      renderer.render(scaled(paramsRef.current), Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)));
    });
  }, [renderer]);

  useEffect(() => {
    const w = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
      if (data.id !== runId.current) return;
      if (data.type === 'progress') setBusy(data.stage);
      else if (data.type === 'stage') {
        setImages((prev) => ({ ...prev, ...Object.fromEntries(data.images.map((v) => [v.key, v.image])) }));
        setLabels((prev) => ({ ...prev, ...Object.fromEntries(data.images.map((v) => [v.key, v.label])) }));
        if (renderer.ok && data.shards) {
          renderer.setShards(data.shards.map((poly) => ({ poly })), data.w, data.h);
          geomScale.current = data.preview ? 0.5 : 1;
        }
        if (renderer.ok && data.colors) {
          renderer.setColors(data.colors, paramsRef.current.seed);
          setMosaicReady(true);
          requestRender();
        }
        if (data.stage === 'render') setMosaicReady(true);
      } else if (data.type === 'done') {
        if (DEBUG) (window.__runs ??= []).push({ preview: data.preview, ms: performance.now() - sentAt.current, timings: data.timings, visual: data.visualMs });
        setBusy(null);
        if (!data.preview) setInfo({ shards: data.shards });
      } else if (data.type === 'error') {
        setBusy(null);
        setError(data.message);
      }
    };
    worker.current = w;
    return () => w.terminate();
  }, [renderer, requestRender]);

  // Send the photo, resized to the working resolution, whenever either changes.
  useEffect(() => {
    if (!bitmap || !worker.current) return;
    const s = params.workLong / Math.max(bitmap.width, bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * s)), h = Math.max(1, Math.round(bitmap.height * s));
    const cv = new OffscreenCanvas(w, h);
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    worker.current.postMessage({ type: 'image', image: data }, [data.data.buffer]);
    sent.current = null;
  }, [bitmap, params.workLong]);

  const post = useCallback((p, preview) => {
    const id = ++runId.current;
    setError(null);
    lastWasPreview.current = preview;
    sentAt.current = performance.now();
    worker.current.postMessage({ type: 'run', id, params: p, preview, views: wanted.current, cpuRender: !renderer.ok });
  }, [renderer]);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(params)); } catch { /* ignore */ }
    if (!bitmap) return;
    const kind = changeKind(sent.current, params);
    if (kind === 'none') return;
    if (kind === 'render' && renderer.ok) {
      sent.current = params;
      requestRender();
      return;
    }
    const preview = dragging.current;
    const t = setTimeout(() => { sent.current = params; post(params, preview); }, preview ? 30 : 40);
    return () => clearTimeout(t);
  }, [params, bitmap, renderer, post, requestRender]);

  const beginDrag = useCallback(() => { dragging.current = true; }, []);
  const endDrag = useCallback(() => {
    dragging.current = false;
    // Replace the half-size preview with the full result.
    if (lastWasPreview.current && bitmap) { sent.current = paramsRef.current; post(paramsRef.current, false); }
  }, [bitmap, post]);

  const loadBlob = useCallback(async (blob) => {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      setImages({});
      setInfo(null);
      setMosaicReady(false);
      setBitmap(bmp);
    } catch {
      setError('No se ha podido leer esa imagen. Prueba con un JPG o un PNG.');
    }
  }, []);

  const loadSample = useCallback(async (src) => {
    const res = await fetch(src);
    await loadBlob(await res.blob());
  }, [loadBlob]);

  // The stage image on screen; previews only draw this one.
  const setWanted = useCallback((key) => { wanted.current = [key]; }, []);

  const setViewport = useCallback((w, h) => {
    view.current = [w, h];
    requestRender();
  }, [requestRender]);

  const download = useCallback(async () => {
    const p = paramsRef.current;
    let blob;
    if (renderer.ok) {
      blob = await renderer.toBlob(scaled(p), p.outLong);
      requestRender();
    } else if (images.final) {
      const cv = document.createElement('canvas');
      cv.width = images.final.width;
      cv.height = images.final.height;
      cv.getContext('2d').putImageData(images.final, 0, 0);
      blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
    }
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `trencadis-${p.algorithm}-${p.seed}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [renderer, images.final, requestRender]);

  return {
    params, setParams, images, labels, busy, info, error, gpu, glCanvas, mosaicReady,
    hasImage: !!bitmap, bitmap,
    setParam: (key, value) => setParams((p) => {
      const next = { ...p, [key]: value };
      if (key === 'sMin' && value > next.sMax) next.sMax = value;
      if (key === 'sMax' && value < next.sMin) next.sMin = value;
      return next;
    }),
    beginDrag, endDrag, loadBlob, loadSample, setViewport, setWanted, download,
  };
}
