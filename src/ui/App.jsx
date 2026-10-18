import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULTS } from '../core/params.js';
import Controls from './Controls.jsx';

const STAGES = ['original', 'detail', 'size', 'orientation', 'structure', 'tessellation', 'flat', 'palette', 'final'];
const STAGE_OF = {
  analysis: ['original', 'detail', 'size', 'orientation'],
  tessellation: ['structure', 'tessellation'],
  color: ['flat', 'palette'],
  render: ['final'],
};
const STATUS = {
  analysis: 'Midiendo el detalle',
  tessellation: 'Rompiendo los azulejos',
  color: 'Eligiendo colores',
  render: 'Colocando la junta y el vidriado',
};
const SAMPLES = [
  { src: './samples/vermeer.jpg', label: 'Vermeer' },
  { src: './samples/vangogh.jpg', label: 'Van Gogh' },
];
const STORE = 'trencadis.params.v1';

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved) return { ...DEFAULTS, ...saved };
  } catch { /* storage unavailable */ }
  return { ...DEFAULTS };
}

function ImageCanvas({ image, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !image) return;
    cv.width = image.width;
    cv.height = image.height;
    cv.getContext('2d').putImageData(image, 0, 0);
  }, [image]);
  return <canvas ref={ref} className={className} />;
}

export default function App() {
  const [params, setParams] = useState(loadParams);
  const [images, setImages] = useState({});
  const [labels, setLabels] = useState({});
  const [selected, setSelected] = useState('final');
  const [busy, setBusy] = useState(null);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [peek, setPeek] = useState(false);
  const [bitmap, setBitmap] = useState(null);
  const [dragging, setDragging] = useState(false);
  const worker = useRef(null);
  const runId = useRef(0);
  const fileInput = useRef(null);

  useEffect(() => {
    const w = new Worker(new URL('../worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => {
      if (data.id !== runId.current) return;
      if (data.type === 'stage') {
        setImages((prev) => {
          const next = { ...prev };
          for (const v of data.images) next[v.key] = v.image;
          return next;
        });
        setLabels((prev) => {
          const next = { ...prev };
          for (const v of data.images) next[v.key] = v.label;
          return next;
        });
      } else if (data.type === 'progress') {
        setBusy(data.stage);
      } else if (data.type === 'done') {
        setBusy(null);
        const total = Object.values(data.timings).reduce((a, b) => a + b, 0);
        setInfo({ shards: data.shards, ms: total });
      } else if (data.type === 'error') {
        setBusy(null);
        setError(data.message);
      }
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

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
  }, [bitmap, params.workLong]);

  useEffect(() => {
    if (!bitmap) return;
    const t = setTimeout(() => {
      const id = ++runId.current;
      setError(null);
      setBusy('analysis');
      worker.current.postMessage({ type: 'run', id, params });
    }, 120);
    try { localStorage.setItem(STORE, JSON.stringify(params)); } catch { /* ignore */ }
    return () => clearTimeout(t);
  }, [params, bitmap]);

  const loadBlob = useCallback(async (blob) => {
    try {
      setImages({});
      setInfo(null);
      setBitmap(await createImageBitmap(blob, { imageOrientation: 'from-image' }));
    } catch {
      setError('No se ha podido leer esa imagen. Prueba con un JPG o PNG.');
    }
  }, []);

  const loadSample = useCallback(async (src) => {
    const res = await fetch(src);
    loadBlob(await res.blob());
  }, [loadBlob]);

  useEffect(() => { loadSample(SAMPLES[0].src); }, [loadSample]);

  const setParam = (key, value) => setParams((p) => {
    const next = { ...p, [key]: value };
    if (key === 'sMin' && value > next.sMax) next.sMax = value;
    if (key === 'sMax' && value < next.sMin) next.sMin = value;
    return next;
  });

  const download = () => {
    const img = images.final;
    if (!img) return;
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    cv.getContext('2d').putImageData(img, 0, 0);
    cv.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `trencadis-${params.algorithm}-${params.seed}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) loadBlob(f);
  };

  const shown = peek ? images.original : images[selected];
  const order = Object.keys(STAGE_OF);
  // Thumbnails from the stage being computed onward are out of date.
  const stale = (key) => busy && order.findIndex((st) => STAGE_OF[st].includes(key)) >= order.indexOf(busy);

  return (
    <div className="app">
      <header className="top">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i /><i /><i /><i />
          </span>
          Trencadís
        </h1>
        <p className="tagline">Rompe una foto en trozos de azulejo, como en el Park Güell.</p>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => fileInput.current.click()}>Subir foto</button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && loadBlob(e.target.files[0])} />
          {SAMPLES.map((s) => (
            <button key={s.src} type="button" className="btn" onClick={() => loadSample(s.src)}>{s.label}</button>
          ))}
          <button type="button" className="btn" onClick={download} disabled={!images.final}>Descargar PNG</button>
        </div>
      </header>

      <aside className="side">
        <Controls params={params} setParam={setParam} applyPreset={(pr) => setParams((p) => ({ ...p, ...pr }))} reset={() => setParams({ ...DEFAULTS })} />
      </aside>

      <main
        className={`stage${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="viewer">
          {shown ? <ImageCanvas image={shown} className="viewer-canvas" /> : <div className="empty">Arrastra una foto aquí o pulsa «Subir foto».</div>}
        </div>
        <div className="statusbar">
          <span className="status" aria-live="polite">
            {error ? <span className="err">{error}</span>
              : busy ? <><span className="spinner" aria-hidden="true" />{STATUS[busy]}…</>
              : info ? `${info.shards.toLocaleString('es')} trozos · ${(info.ms / 1000).toFixed(1).replace('.', ',')} s` : ''}
          </span>
          <button
            type="button"
            className="btn btn-small"
            onPointerDown={() => setPeek(true)}
            onPointerUp={() => setPeek(false)}
            onPointerLeave={() => setPeek(false)}
            onKeyDown={(e) => e.key === ' ' && setPeek(true)}
            onKeyUp={() => setPeek(false)}
            disabled={!images.original}
          >
            Mantén para ver la original
          </button>
        </div>
        <ol className="strip" aria-label="Etapas del algoritmo">
          {STAGES.map((key, i) => (
            <li key={key}>
              <button
                type="button"
                className={`thumb${selected === key ? ' is-selected' : ''}${stale(key) ? ' is-stale' : ''}`}
                onClick={() => setSelected(key)}
                aria-pressed={selected === key}
              >
                <span className="thumb-img">{images[key] && <ImageCanvas image={images[key]} />}</span>
                <span className="thumb-label"><b>{i + 1}</b> {labels[key] ?? '…'}</span>
              </button>
            </li>
          ))}
        </ol>
      </main>
    </div>
  );
}
