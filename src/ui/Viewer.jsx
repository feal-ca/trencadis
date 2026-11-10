import { useEffect, useRef, useState } from 'react';
import { clamp } from './geometry.js';
import { TOUCH, useMedia } from './useMedia.js';
import { zoomAt } from './zoom.js';

function ImageCanvas({ image, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !image) return;
    cv.width = image.width;
    cv.height = image.height;
    // A stage image is ImageData; the original photo is a decoded bitmap.
    if (image instanceof ImageData) cv.getContext('2d').putImageData(image, 0, 0);
    else cv.getContext('2d').drawImage(image, 0, 0);
  }, [image]);
  return <canvas ref={ref} className={className} />;
}

export function Panot() {
  return (
    <svg className="panot" aria-hidden="true">
      <defs>
        <pattern id="panot-flor" width="40" height="40" patternUnits="userSpaceOnUse">
          <g className="panot-line">
            <circle cx="20" cy="12" r="6" /><circle cx="20" cy="28" r="6" />
            <circle cx="12" cy="20" r="6" /><circle cx="28" cy="20" r="6" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#panot-flor)" />
    </svg>
  );
}

// The big image: the WebGL mosaic or a stage image. A faint Eixample grid
// sits behind it; a file dragged over the window shows the panot.
export default function Viewer({ engine, dropping, view = 'final' }) {
  const box = useRef(null);
  const host = useRef(null);
  const [compare, setCompare] = useState(false);
  // Zoom: scale k and translation (x, y) of the image inside the box.
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const pan = useRef(null);
  // Pointers down on the image, and the pinch they make when there are two.
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  useEffect(() => { setZoom({ k: 1, x: 0, y: 0 }); }, [engine.bitmap]);
  const useGl = view === 'final' && engine.gpu && !compare;

  useEffect(() => {
    if (!useGl || !host.current) return;
    host.current.appendChild(engine.glCanvas);
    return () => engine.glCanvas.remove();
  }, [useGl, engine.glCanvas]);

  const { setWanted, setViewport } = engine;
  useEffect(() => { setWanted(view); }, [view, setWanted]);

  // The mosaic is redrawn at the zoomed size, so zooming in stays sharp.
  const size = useRef([0, 0]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      size.current = [e.contentRect.width, e.contentRect.height];
      setViewport(e.contentRect.width * zoomRef.current.k, e.contentRect.height * zoomRef.current.k);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);
  useEffect(() => { setViewport(size.current[0] * zoom.k, size.current[1] * zoom.k); }, [zoom.k, setViewport]);

  // The wheel zooms towards the pointer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      const r = el.getBoundingClientRect();
      setZoom(zoomAt(zoomRef.current, f, e.clientX - r.left, e.clientY - r.top, r.width, r.height));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // The bar's buttons and the keys zoom on the centre of the box.
  const zoomBy = (factor) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setZoom(zoomAt(zoomRef.current, factor, r.width / 2, r.height / 2, r.width, r.height));
  };
  const touch = useMedia(TOUCH);
  // + / = and - zoom, 0 fits, and holding the space bar shows the original.
  // Not with a modifier, nor while typing or choosing in a control.
  const keys = useRef(null);
  const holding = useRef(false);
  keys.current = (e) => {
    // Letting go always ends a hold, whatever has the focus by then.
    if (e.type === 'keyup' && e.key === ' ' && holding.current) {
      holding.current = false;
      setCompare(false);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea, [contenteditable]')) return;
    if (e.key === ' ') {
      // A focused button takes the space bar for itself.
      if (e.type !== 'keydown' || e.target.closest?.('button, a, summary')) return;
      e.preventDefault();
      holding.current = e.type === 'keydown';
      setCompare(holding.current);
    } else if (e.type === 'keydown') {
      if (e.key === '+' || e.key === '=') zoomBy(1.5);
      else if (e.key === '-') zoomBy(1 / 1.5);
      else if (e.key === '0') setZoom({ k: 1, x: 0, y: 0 });
      else return;
      e.preventDefault();
    }
  };
  useEffect(() => {
    const on = (e) => keys.current(e);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    // The key may come up in another window.
    const off = () => { if (holding.current) { holding.current = false; setCompare(false); } };
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', on);
      window.removeEventListener('keyup', on);
      window.removeEventListener('blur', off);
    };
  }, []);

  // Dragging pans when zoomed in; two fingers pinch to zoom and pan.
  const onDown = (e) => {
    const r = box.current.getBoundingClientRect();
    pointers.current.set(e.pointerId, [e.clientX - r.left, e.clientY - r.top]);
    if (pointers.current.size === 2) {
      e.stopPropagation();
      pan.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ...zoomRef.current };
      return;
    }
    if (pointers.current.size > 2 || pinch.current) { e.stopPropagation(); return; }
    if (zoomRef.current.k === 1 || !(e.button === 1 || e.button === 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { sx: e.clientX, sy: e.clientY, ...zoomRef.current };
  };
  const onMove = (e) => {
    const r = box.current.getBoundingClientRect();
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, [e.clientX - r.left, e.clientY - r.top]);
    const g = pinch.current;
    if (g) {
      e.stopPropagation();
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const k = clamp(g.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / g.d, 1, 8);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // The image point that was under the first midpoint follows the fingers.
      const x = m[0] - ((g.m[0] - g.x) * k) / g.k, y = m[1] - ((g.m[1] - g.y) * k) / g.k;
      setZoom({ k, x: clamp(x, r.width * (1 - k), 0), y: clamp(y, r.height * (1 - k), 0) });
      return;
    }
    const p0 = pan.current;
    if (!p0) return;
    setZoom({ k: p0.k, x: clamp(p0.x + e.clientX - p0.sx, r.width * (1 - p0.k), 0), y: clamp(p0.y + e.clientY - p0.sy, r.height * (1 - p0.k), 0) });
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    pan.current = null;
    // The pinch ends when the last finger lifts, so the one left over doesn't draw.
    if (pinch.current) { e.stopPropagation(); if (!pointers.current.size) pinch.current = null; }
  };

  // The original is the decoded photo, not the working copy of the pipeline.
  const image = compare ? engine.bitmap : engine.images[view];
  const ready = useGl ? engine.mosaicReady : !!image;

  return (
    <div
      className={`viewer chamfer${engine.busy ? ' is-busy' : ''}`}
    >
      <svg className="eixample" aria-hidden="true">
        <defs>
          <pattern id="eixample-grid" width="34" height="34" patternUnits="userSpaceOnUse">
            <path d="M9 3h16l6 6v16l-6 6H9l-6-6V9Z" className="eixample-block" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#eixample-grid)" />
        <line x1="0" y1="100%" x2="100%" y2="8%" className="eixample-diagonal" />
      </svg>
      <div
        className={`viewer-box${zoom.k > 1 ? ' can-pan' : ''}`}
        ref={box}
        onPointerDownCapture={onDown}
        onPointerMoveCapture={onMove}
        onPointerUpCapture={onUp}
        onPointerCancelCapture={onUp}
      >
        <div className="viewer-zoom" style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})` }}>
          {useGl ? <div className="viewer-host" ref={host} />
            : image && <ImageCanvas image={image} className="viewer-canvas" />}
        </div>
        {!ready && <p className="viewer-empty">{engine.hasImage ? 'Calculando…' : 'Todavía no hay foto.'}</p>}
        {engine.busy && ready && <span className="busy-mark" role="status" aria-label="Calculando" />}
      </div>
      {dropping && (
        <div className="drop">
          <Panot />
          <p>Suelta la foto aquí</p>
        </div>
      )}
      <div className="viewer-bar">
        <span className="status" aria-live="polite">
          {engine.error ? <span className="err">{engine.error}</span>
            : engine.busy ? 'Calculando…'
            : engine.info ? `${engine.info.shards.toLocaleString('es')} trozos` : ''}
        </span>
        {engine.hasImage && (
          <button type="button" className="link" onClick={engine.reseed} title="Otra versión (R)">Otra versión ↻</button>
        )}
        {!touch && engine.hasImage && (
          <span className="zoom-buttons">
            <button type="button" className="link" onClick={() => zoomBy(1 / 1.5)} disabled={zoom.k <= 1} aria-label="Alejar" title="Alejar (-)">−</button>
            <button type="button" className="link" onClick={() => zoomBy(1.5)} disabled={zoom.k >= 8} aria-label="Ampliar" title="Ampliar (+)">+</button>
          </span>
        )}
        {zoom.k > 1 && (
          <button type="button" className="link" onClick={() => setZoom({ k: 1, x: 0, y: 0 })}>
            Ajustar ({Math.round(zoom.k * 100)} %)
          </button>
        )}
        <button
          type="button"
          className="link hold"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={() => setCompare(true)}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
          onKeyDown={(e) => e.key === ' ' && setCompare(true)}
          onKeyUp={() => setCompare(false)}
          disabled={!engine.bitmap}
        >
          Mantén para ver la original
        </button>
      </div>
    </div>
  );
}
