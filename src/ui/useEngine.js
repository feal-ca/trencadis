import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoGroutColor } from '../core/color.js';
import { createHistory } from '../core/history.js';
import { applyMacro, applyMacroDefaults, applyStyle, MACRO_DEFAULTS, MACROS, readStyle } from '../core/macros.js';
import { DEFAULTS, keysForStage } from '../core/params.js';
import { createRenderer } from '../gl/renderer.js';

const STORE = 'trencadis.params.v2';
const MACRO_STORE = 'trencadis.macros.v1';
// With ?debug in the URL, run timings are collected in window.__runs.
const DEBUG = typeof location !== 'undefined' && location.search.includes('debug');
const RENDER_KEYS = new Set(keysForStage('render'));

export const SAMPLES = [
  { src: './samples/vermeer.webp', label: 'Vermeer' },
  { src: './samples/vangogh.webp', label: 'Van Gogh' },
  { src: './samples/barcas.webp', label: 'Barcas' },
];

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

// Simple controls: their values, and which ones are set by hand instead.
function loadMacros() {
  try {
    const saved = JSON.parse(localStorage.getItem(MACRO_STORE) || 'null');
    if (saved) return { values: { ...MACRO_DEFAULTS, ...saved.values }, manual: saved.manual ?? {} };
  } catch { /* storage unavailable */ }
  return { values: { ...MACRO_DEFAULTS }, manual: {} };
}

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
  const [macros, setMacros] = useState(loadMacros);
  // Simple controls not in hand mode decide their parameters from the start.
  const [params, setParams] = useState(() => MACROS.reduce(
    (p, id) => (macros.manual[id] ? p : applyMacro(p, id, macros.values[id])), loadParams()));
  const macrosRef = useRef(macros);
  macrosRef.current = macros;
  useEffect(() => {
    try { localStorage.setItem(MACRO_STORE, JSON.stringify(macros)); } catch { /* ignore */ }
  }, [macros]);
  // Undo/redo of settings: a step is recorded once changes pause for 500 ms,
  // so dragging a slider is one step.
  const history = useRef(null);
  history.current ??= createHistory({ params, macros });
  const [, setHistoryVersion] = useState(0);
  const pending = useRef(null);
  const flushHistory = useCallback(() => {
    clearTimeout(pending.current?.timer);
    if (pending.current) history.current.record(pending.current.state);
    pending.current = null;
  }, []);
  useEffect(() => {
    const state = { params, macros };
    clearTimeout(pending.current?.timer);
    pending.current = { state, timer: setTimeout(() => { flushHistory(); setHistoryVersion((v) => v + 1); }, 500) };
  }, [params, macros, flushHistory]);
  const travel = (dir) => {
    flushHistory();
    const s = dir < 0 ? history.current.undo() : history.current.redo();
    if (s) { setMacros(s.macros); setParams(s.params); }
    setHistoryVersion((v) => v + 1);
  };
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
  const view = useRef([800, 600]);
  const frame = useRef(0);
  // The grout colour 'auto' depends on the photo; everything downstream gets
  // `effective`, with it resolved to a real colour.
  const [autoGrout, setAutoGrout] = useState('#3a3631');
  const effective = useMemo(
    () => (params.groutColor === 'auto' ? { ...params, groutColor: autoGrout } : params),
    [params, autoGrout],
  );
  const paramsRef = useRef(effective);
  paramsRef.current = effective;
  const rawParams = useRef(params);
  rawParams.current = params;

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
      renderer.render(paramsRef.current, Math.max(1, Math.round(W * s)), Math.max(1, Math.round(H * s)));
    });
  }, [renderer]);

  useEffect(() => {
    const w = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
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
          renderer.setShards(data.shards.map((poly, i) => ({ poly, row: data.rows?.[i] })), data.w, data.h, paramsRef.current.seed);
        }
        if (renderer.ok && data.colors) {
          renderer.setColors(data.colors, paramsRef.current.seed);
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
    const s = params.workLong / Math.max(bitmap.width, bitmap.height);
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
  }, [bitmap, params.workLong, readable]);

  // The settings of the run in flight, so its result can be read against them.
  const posted = useRef(null);
  const post = useCallback((p) => {
    posted.current = p;
    const id = ++runId.current;
    setError(null);
    setBusy('analysis');
    sentAt.current = performance.now();
    worker.current.postMessage({ type: 'run', id, params: p, views: wanted.current, cpuRender: !renderer.ok });
  }, [renderer]);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(params)); } catch { /* ignore */ }
    if (!bitmap || !readable) return;
    const kind = changeKind(sent.current, effective);
    if (kind === 'none') return;
    if (kind === 'render' && renderer.ok) {
      sent.current = effective;
      requestRender();
      return;
    }
    const t = setTimeout(() => { sent.current = effective; post(effective); }, 40);
    return () => clearTimeout(t);
  }, [effective, bitmap, readable, renderer, post, requestRender]);

  // Detail brush: values in [-1, 1] on a grid with a 256 px long side, so it
  // survives changes of working resolution.
  const mask = useRef(null);
  const [maskVersion, setMaskVersion] = useState(0);
  const resetMask = useCallback((bmp) => {
    const s = 256 / Math.max(bmp.width, bmp.height);
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    mask.current = { w, h, data: new Float32Array(w * h), empty: true };
    maskHistory.current = [];
    setCanUndoMask(false);
    worker.current?.postMessage({ type: 'mask', mask: null });
    setMaskVersion((v) => v + 1);
  }, []);
  // One soft dab at normalised (u, v); radius as a fraction of the long side.
  const paint = useCallback((u, v, radius, target) => {
    const m = mask.current;
    if (!m) return;
    const L = Math.max(m.w, m.h), r = radius * L;
    const cx = u * m.w, cy = v * m.h;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(m.h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(m.w - 1, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d >= 1) continue;
        // Gaussian falloff: strong in the middle, nothing at the rim.
        const k = 0.3 * Math.exp(-4 * d * d) * (1 - d);
        const i = y * m.w + x;
        m.data[i] += (target - m.data[i]) * k;
      }
    }
    m.empty = false;
    setMaskVersion((x) => x + 1);
  }, []);
  // Undo: a copy of the mask before each stroke (it is small, 256 px).
  const maskHistory = useRef([]);
  const [canUndoMask, setCanUndoMask] = useState(false);
  const beginStroke = useCallback(() => {
    const m = mask.current;
    if (!m) return;
    maskHistory.current = [...maskHistory.current.slice(-19), { data: Float32Array.from(m.data), empty: m.empty }];
    setCanUndoMask(true);
  }, []);
  const commitMask = useCallback(() => {
    const m = mask.current;
    if (!m || !worker.current) return;
    worker.current.postMessage({ type: 'mask', mask: m.empty ? null : { w: m.w, h: m.h, data: Float32Array.from(m.data) } });
    sent.current = paramsRef.current;
    post(paramsRef.current);
  }, [post]);
  const clearMask = useCallback(() => {
    const m = mask.current;
    if (!m) return;
    beginStroke();
    m.data.fill(0);
    m.empty = true;
    setMaskVersion((x) => x + 1);
    commitMask();
  }, [commitMask, beginStroke]);
  // Puts back the mask from before the last stroke. With `commit` false it
  // only restores the pixels (a stroke cancelled before it was sent).
  const undoMask = useCallback((commit = true) => {
    const m = mask.current, prev = maskHistory.current.pop();
    setCanUndoMask(maskHistory.current.length > 0);
    if (!m || !prev) return;
    m.data.set(prev.data);
    m.empty = prev.empty;
    setMaskVersion((x) => x + 1);
    if (commit) commitMask();
  }, [commitMask]);

  // Hand-drawn guide lines, polylines in normalised image coordinates.
  const [guides, setGuides] = useState([]);
  // Guide lines actually used for rows (drawn ones first), from the worker.
  const [lines, setLines] = useState({ drawn: 0, lines: [] });
  const commitGuides = useCallback((list) => {
    setGuides(list);
    if (!worker.current) return;
    worker.current.postMessage({ type: 'guides', guides: list });
    sent.current = paramsRef.current;
    post(paramsRef.current);
  }, [post]);

  const loadBlob = useCallback(async (blob) => {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      setImages({});
      setInfo(null);
      setMosaicReady(false);
      resetMask(bmp);
      setGuides([]);
      worker.current?.postMessage({ type: 'guides', guides: [] });
      setBitmap(bmp);
    } catch {
      // HEIC (iPhone photos) only opens in Safari; elsewhere it fails here.
      const heic = /hei[cf]$/i.test(blob.type) || /\.hei[cf]$/i.test(blob.name ?? '');
      setError(heic
        ? 'Este navegador no abre fotos HEIC, el formato del iPhone. Ábrela en Safari o guárdala como JPG (en el iPhone: Ajustes › Cámara › Formatos › Más compatible).'
        : 'No se ha podido leer esa imagen. Prueba con un JPG o un PNG.');
    }
  }, [resetMask]);

  const loadSample = useCallback(async (src) => {
    const res = await fetch(src);
    await loadBlob(await res.blob());
  }, [loadBlob]);

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

  // The mosaic at export size, as PNG or JPG.
  const exportFile = useCallback(async (format = 'png') => {
    const p = paramsRef.current;
    const type = format === 'jpg' ? 'image/jpeg' : 'image/png';
    let blob;
    if (renderer.ok) {
      blob = await renderer.toBlob(p, p.outLong, type, 0.9);
      requestRender();
    } else if (images.final) {
      const cv = document.createElement('canvas');
      cv.width = images.final.width;
      cv.height = images.final.height;
      cv.getContext('2d').putImageData(images.final, 0, 0);
      blob = await new Promise((r) => cv.toBlob(r, type, 0.9));
    }
    return blob && new File([blob], `trencadis-${p.algorithm}-${p.seed}.${format}`, { type });
  }, [renderer, images.final, requestRender]);

  const download = useCallback(async (format) => {
    const file = await exportFile(format);
    if (!file) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, [exportFile]);

  // Web Share with the image as a file (phones: save to Photos, send, post).
  // Falls back to a download if the browser refuses, e.g. when encoding took
  // long enough for the tap to stop counting as a user gesture.
  const share = useCallback(async (format) => {
    const file = await exportFile(format);
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: 'Trencadís' });
    } catch (e) {
      if (e.name !== 'AbortError') download(format);
    }
  }, [exportFile, download]);

  return {
    params, setParams, images, labels, busy, info, error, gpu, glCanvas, mosaicReady, autoGrout,
    hasImage: !!bitmap, bitmap,
    setParam: (key, value) => setParams((p) => {
      let next = { ...p, [key]: value };
      if (key === 'sMin' && value > next.sMax) next.sMax = value;
      if (key === 'sMax' && value < next.sMin) next.sMin = value;
      // A new method gets the same "Parecido a la foto" in its own terms.
      const m = macrosRef.current;
      if (key === 'algorithm' && !m.manual.fidelity) next = applyMacro(next, 'fidelity', m.values.fidelity);
      // The size ratio is read by the size control, which then sets sMin.
      if (key === 'sizeRatio' && !m.manual.size) next = applyMacro(next, 'size', m.values.size);
      return next;
    }),
    style: readStyle(params, DEFAULTS),
    // Pieces expected at the current size: with a fixed size ratio every piece
    // scales with sMax, so the count goes as 1 / sMax² from the last run.
    estimate: info?.sMax ? info.shards * (info.sMax / params.sMax) ** 2 : null,
    // A one-click look replaces every setting; returns what restore() needs to undo it.
    setStyle: (id) => {
      const before = { params: rawParams.current, macros: macrosRef.current };
      const next = applyStyle(DEFAULTS, id);
      setMacros(next.macros);
      setParams({ ...next.params, seed: rawParams.current.seed });
      return before;
    },
    macros,
    setMacro: (id, value) => {
      setMacros((m) => ({ ...m, values: { ...m.values, [id]: value } }));
      setParams((p) => applyMacro(p, id, value));
    },
    // Hand mode shows the underlying parameters; leaving it re-applies the macro.
    setManual: (id, on) => {
      setMacros((m) => ({ ...m, manual: { ...m.manual, [id]: on } }));
      if (!on) setParams((p) => applyMacro(p, id, macrosRef.current.values[id]));
    },
    // Every setting back to its default; returns what to pass to restore() to undo it.
    resetAll: () => {
      const before = { params: rawParams.current, macros: macrosRef.current };
      setMacros({ values: { ...MACRO_DEFAULTS }, manual: {} });
      setParams(applyMacroDefaults(DEFAULTS));
      return before;
    },
    restore: ({ params: p, macros: m }) => { setMacros(m); setParams(p); },
    undo: () => travel(-1),
    redo: () => travel(1),
    // A change not recorded yet can be undone too.
    canUndo: history.current.canUndo || !history.current.matches({ params, macros }),
    canRedo: history.current.canRedo,
    isDefault: Object.entries(applyMacroDefaults(DEFAULTS)).every(([k, v]) => params[k] === v)
      && !Object.values(macros.manual).some(Boolean),
    loadBlob, loadSample, setViewport, setWanted, download, share,
    mask, maskVersion, paint, beginStroke, commitMask, clearMask, undoMask, canUndoMask,
    guides, lines, addGuide: (g) => commitGuides([...guides, g]), clearGuides: () => commitGuides([]),
    undoGuide: () => commitGuides(guides.slice(0, -1)),
  };
}
