import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoGroutColor } from '../core/color.js';
import { createHistory } from '../core/history.js';
import { applyMacro, applyMacroDefaults, applyStyle, MACRO_DEFAULTS, MACROS, readStyle } from '../core/macros.js';
import { DEFAULTS, keysForStage } from '../core/params.js';
import { createRenderer } from '../gl/renderer.js';
import { createSegSession, startPolicy } from './segSession.js';
import { TOUCH } from './useMedia.js';

const STORE = 'trencadis.params.v2';
const MACRO_STORE = 'trencadis.macros.v1';
// The answer to "Buscar las formas de la foto": 'yes' or 'no'.
const SEG_STORE = 'trencadis.seg.v1';
// With ?debug in the URL, run timings are collected in window.__runs and the
// engine is reachable as window.__trencadis (for scripts).
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
  // Touched shapes: [{ id, mode: null | 'more' | 'less', points: [[u, v, 1]] }].
  // A shape just touched has no mode until one is chosen. Their pixels live
  // in `zonePixels`, outside the history.
  const [zones, setZones] = useState([]);
  // Undo/redo of settings and zones: a step is recorded once changes pause
  // for 500 ms, so dragging a slider is one step.
  const history = useRef(null);
  history.current ??= createHistory({ params, macros, zones });
  const [, setHistoryVersion] = useState(0);
  const pending = useRef(null);
  const flushHistory = useCallback(() => {
    clearTimeout(pending.current?.timer);
    if (pending.current) history.current.record(pending.current.state);
    pending.current = null;
  }, []);
  useEffect(() => {
    const state = { params, macros, zones };
    clearTimeout(pending.current?.timer);
    pending.current = { state, timer: setTimeout(() => { flushHistory(); setHistoryVersion((v) => v + 1); }, 500) };
  }, [params, macros, zones, flushHistory]);
  // Zones of an earlier photo have no pixels any more and are left out.
  const ownZones = (list) => list.filter((z) => zonePixels.current.has(z.id));
  const travel = (dir) => {
    flushHistory();
    const s = dir < 0 ? history.current.undo() : history.current.redo();
    if (s) { setMacros(s.macros); setParams(s.params); setZones(ownZones(s.zones)); }
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

  const rerun = useCallback(() => {
    sent.current = paramsRef.current;
    post(paramsRef.current);
  }, [post]);

  // Segmentation (segSession.js): the objects of the photo, found by a model
  // in its own worker, give rows along their outlines and cuts; touched
  // shapes come from the same model. The worker is created on first use, so
  // nothing is downloaded until segmentation starts.
  const segWorker = useRef(null);
  const [seg, setSeg] = useState({ phase: 'idle' });
  // A copy of the objects found, for the viewer to draw them.
  const [segments, setSegments] = useState(null);
  const session = useRef(null);
  session.current ??= createSegSession({
    policy: startPolicy({
      touch: typeof matchMedia !== 'undefined' && matchMedia(TOUCH).matches,
      webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
      stored: (() => { try { return localStorage.getItem(SEG_STORE); } catch { return null; } })(),
    }),
    onState: setSeg,
    post: (msg) => {
      if (!segWorker.current) {
        segWorker.current = new Worker(new URL('../seg/worker.js', import.meta.url), { type: 'module' });
        segWorker.current.onmessage = ({ data }) => {
          if (data.type === 'log') { if (DEBUG) console.log('[sam]', data.text); return; }
          if (!session.current.receive(data) || data.type !== 'segments') return;
          setSegments({ ...data.segments, count: data.count, labels: data.segments.labels.slice() });
          worker.current?.postMessage({ type: 'segments', segments: data.segments }, [data.segments.labels.buffer]);
          rerun();
        };
        // The worker's code failed to load (or it crashed): drop it, so a
        // retry starts a new one.
        segWorker.current.onerror = (e) => {
          e.preventDefault();
          segWorker.current?.terminate();
          segWorker.current = null;
          session.current.fail('No se ha podido cargar el buscador de formas');
        };
      }
      // ?samDevice=wasm forces the CPU (headless browsers only have a software GPU).
      const device = new URLSearchParams(location.search).get('samDevice');
      segWorker.current.postMessage(msg.type === 'coarse' && device ? { ...msg, device } : msg);
    },
  });
  useEffect(() => () => { segWorker.current?.terminate(); segWorker.current = null; }, []);
  const remember = (answer) => { try { localStorage.setItem(SEG_STORE, answer); } catch { /* ignore */ } };
  useEffect(() => {
    if (!bitmap || !readable) return;
    worker.current?.postMessage({ type: 'segments', segments: null });
    setSegments(null);
    // The model works at 1024 px anyway; send it the photo at that size.
    const s = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const cv = new OffscreenCanvas(Math.round(bitmap.width * s), Math.round(bitmap.height * s));
    cv.getContext('2d').drawImage(bitmap, 0, 0, cv.width, cv.height);
    let stale = false;
    cv.convertToBlob({ type: 'image/png' }).then((blob) => { if (!stale) session.current.photo(blob); });
    return () => { stale = true; };
  }, [bitmap, readable]);

  // Pixels of the touched shapes, by zone id and then by the points that
  // gave them: { region, parts, partsLoading }. Undo and redo bring back
  // older points, so every version is kept until the photo changes.
  const zonePixels = useRef(new Map());
  const [pixelsVersion, setPixelsVersion] = useState(0);
  const zoneSeq = useRef(0);
  // Bumped on every new photo, so a touch answered late is not kept.
  const photoGen = useRef(0);
  const pointsKey = (points) => JSON.stringify(points);
  const pixelsOf = (z) => zonePixels.current.get(z.id)?.get(pointsKey(z.points));
  const keepPixels = (id, points, region) => {
    if (!zonePixels.current.has(id)) zonePixels.current.set(id, new Map());
    zonePixels.current.get(id).set(pointsKey(points), { region, parts: null });
  };
  // The zones with their pixels, for the viewer.
  const zonesView = useMemo(
    () => zones.map((z) => ({ ...z, region: pixelsOf(z)?.region ?? null, parts: pixelsOf(z)?.parts ?? null })),
    [zones, pixelsVersion],
  );
  // The zones with a mode go to the pipeline worker; "more" zones first get
  // their parts from the segmentation worker. Sent again only on a change.
  const sentZones = useRef('[]');
  useEffect(() => {
    const list = [];
    for (const z of zones) {
      const px = pixelsOf(z);
      if (!z.mode || !px) continue;
      if (z.mode === 'more' && !px.parts && !px.partsLoading) {
        px.partsLoading = true;
        session.current.parts(px.region).then(
          (parts) => { px.parts = parts; setPixelsVersion((v) => v + 1); },
          () => { /* no parts: the zone stays without pieces with intention */ },
        );
      }
      // A "more" zone changes nothing until its parts arrive.
      if (z.mode === 'more' && !px.parts) continue;
      list.push({ id: z.id, mode: z.mode, region: px.region, parts: z.mode === 'more' ? px.parts : null });
    }
    const key = JSON.stringify(list.map((z) => [z.id, z.mode, z.region.box, !!z.parts]));
    if (key === sentZones.current || !worker.current) return;
    sentZones.current = key;
    worker.current.postMessage({ type: 'zones', zones: list });
    rerun();
  }, [zones, pixelsVersion, rerun]);
  // A new shape where the photo was touched at (u, v); resolves to its id,
  // or null if there is none (or segmentation was declined).
  const pickShape = useCallback(async (u, v) => {
    const points = [[u, v, 1]];
    const gen = photoGen.current;
    try {
      const region = await session.current.pick(points);
      if (gen !== photoGen.current) return null;
      const id = `z${++zoneSeq.current}`;
      keepPixels(id, points, region);
      setZones((zs) => [...zs, { id, mode: null, points }]);
      return id;
    } catch { return null; }
  }, []);
  // Another touch inside a shape grows or corrects it.
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const refineShape = useCallback(async (id, u, v) => {
    const z = zonesRef.current.find((x) => x.id === id);
    if (!z) return false;
    const points = [...z.points, [u, v, 1]];
    const gen = photoGen.current;
    try {
      const region = await session.current.pick(points);
      if (gen !== photoGen.current) return false;
      keepPixels(id, points, region);
      setZones((zs) => zs.map((x) => (x.id === id ? { ...x, points } : x)));
      return true;
    } catch { return false; }
  }, []);
  const setZoneMode = useCallback((id, mode) => setZones((zs) => zs.map((z) => (z.id === id ? { ...z, mode } : z))), []);
  const removeZone = useCallback((id) => setZones((zs) => zs.filter((z) => z.id !== id)), []);

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
      setGuides([]);
      worker.current?.postMessage({ type: 'guides', guides: [] });
      // Results of the old photo still on their way are dropped from here on.
      session.current.reset();
      photoGen.current++;
      zonePixels.current = new Map();
      setZones([]);
      sentZones.current = '[]';
      worker.current?.postMessage({ type: 'zones', zones: [] });
      setBitmap(bmp);
    } catch {
      // HEIC (iPhone photos) only opens in Safari; elsewhere it fails here.
      const heic = /hei[cf]$/i.test(blob.type) || /\.hei[cf]$/i.test(blob.name ?? '');
      setError(heic
        ? 'Este navegador no abre fotos HEIC, el formato del iPhone. Ábrela en Safari o guárdala como JPG (en el iPhone: Ajustes › Cámara › Formatos › Más compatible).'
        : 'No se ha podido leer esa imagen. Prueba con un JPG o un PNG.');
    }
  }, []);

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

  const api = {
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
      const before = { params: rawParams.current, macros: macrosRef.current, zones: zonesRef.current };
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
      const before = { params: rawParams.current, macros: macrosRef.current, zones: zonesRef.current };
      setMacros({ values: { ...MACRO_DEFAULTS }, manual: {} });
      setParams(applyMacroDefaults(DEFAULTS));
      return before;
    },
    restore: ({ params: p, macros: m, zones: z }) => { setMacros(m); setParams(p); if (z) setZones(ownZones(z)); },
    undo: () => travel(-1),
    redo: () => travel(1),
    // A change not recorded yet can be undone too.
    canUndo: history.current.canUndo || !history.current.matches({ params, macros, zones }),
    canRedo: history.current.canRedo,
    isDefault: Object.entries(applyMacroDefaults(DEFAULTS)).every(([k, v]) => params[k] === v)
      && !Object.values(macros.manual).some(Boolean),
    loadBlob, loadSample, setViewport, setWanted, download, share,
    seg, segments,
    segAccept: () => { remember('yes'); session.current.accept(); },
    segDecline: () => { remember('no'); session.current.decline(); },
    segRetry: () => session.current.retry(),
    zones: zonesView, pickShape, refineShape, setZoneMode, removeZone,
    guides, lines, addGuide: (g) => commitGuides([...guides, g]), clearGuides: () => commitGuides([]),
    undoGuide: () => commitGuides(guides.slice(0, -1)),
  };
  if (DEBUG) window.__trencadis = api;
  return api;
}
