import { useEffect, useRef, useState } from 'react';

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

// A circle under the pointer showing a radius given as a fraction of the
// image's long side (the brush size, or how far a line snaps to contours).
function useRing(ref) {
  const [ring, setRing] = useState(null);
  const track = (e) => {
    const cv = ref.current;
    if (!cv) return;
    const s = Math.min(cv.clientWidth / cv.width, cv.clientHeight / cv.height);
    setRing({ x: cv.offsetLeft + e.nativeEvent.offsetX, y: cv.offsetTop + e.nativeEvent.offsetY, long: Math.max(cv.width, cv.height) * s });
  };
  const view = (fraction) => ring && fraction > 0 && (
    <span className="cursor-ring" aria-hidden="true"
      style={{ left: ring.x, top: ring.y, width: 2 * fraction * ring.long, height: 2 * fraction * ring.long }} />
  );
  return { track, hide: () => setRing(null), view };
}

// The photo with the detail mask tinted on top; pointer strokes paint it.
function BrushLayer({ engine, brush }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const original = engine.images.original;

  useEffect(() => {
    const cv = ref.current, m = engine.mask.current;
    if (!cv || !original || !m) return;
    cv.width = original.width;
    cv.height = original.height;
    const ctx = cv.getContext('2d');
    ctx.putImageData(original, 0, 0);
    const tint = new OffscreenCanvas(m.w, m.h);
    const data = new ImageData(m.w, m.h);
    for (let i = 0; i < m.data.length; i++) {
      const v = m.data[i];
      // Ochre where detail is removed, cobalt where it is added.
      const [r, g, b] = v < 0 ? [216, 160, 50] : [40, 86, 165];
      data.data.set([r, g, b, Math.min(255, Math.abs(v) * 170)], i * 4);
    }
    tint.getContext('2d').putImageData(data, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tint, 0, 0, cv.width, cv.height);
  }, [original, engine.maskVersion, engine.mask]);

  // Map a pointer to normalised image coordinates through object-fit: contain.
  const toUV = (e) => {
    const cv = ref.current, r = cv.getBoundingClientRect();
    const s = Math.min(r.width / cv.width, r.height / cv.height);
    const ox = (r.width - cv.width * s) / 2, oy = (r.height - cv.height * s) / 2;
    return [(e.clientX - r.left - ox) / (cv.width * s), (e.clientY - r.top - oy) / (cv.height * s)];
  };
  const dab = (e) => {
    const [u, v] = toUV(e);
    engine.paint(u, v, brush.size, brush.mode === 'remove' ? -1 : 1);
  };
  const ring = useRing(ref);
  return (
    <>
      <canvas
        ref={ref}
        className="viewer-canvas brush-canvas"
        onPointerDown={(e) => { if (e.button !== 0) return; drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); dab(e); }}
        onPointerMove={(e) => { ring.track(e); if (drawing.current) dab(e); }}
        onPointerLeave={ring.hide}
        onPointerUp={() => { if (drawing.current) { drawing.current = false; engine.commitMask(); } }}
      />
      {ring.view(brush.size)}
    </>
  );
}

// The photo with the guide lines. "free" mode: a stroke adds a line.
// "points" mode: each click adds a vertex; double-click or Enter finishes,
// Backspace removes the last vertex, Escape cancels.
function DrawLayer({ engine, tool }) {
  const ref = useRef(null);
  const stroke = useRef(null);
  const hover = useRef(null);
  const original = engine.images.original;
  const mode = tool?.mode ?? 'free';
  const finish = () => {
    const g = stroke.current;
    stroke.current = null;
    hover.current = null;
    if (g && g.length >= 2) engine.addGuide({ points: g, mode, snap: tool?.snap ?? true, snapRadius: tool?.radius ?? 0.02 });
    else redraw();
  };
  const redraw = () => {
    const cv = ref.current;
    if (!cv || !original) return;
    cv.width = original.width;
    cv.height = original.height;
    const ctx = cv.getContext('2d');
    ctx.putImageData(original, 0, 0);
    ctx.fillStyle = 'rgba(247, 246, 242, 0.35)';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const draw = (g) => {
      ctx.beginPath();
      g.forEach(([u, v], i) => (i ? ctx.lineTo(u * cv.width, v * cv.height) : ctx.moveTo(u * cv.width, v * cv.height)));
      ctx.stroke();
    };
    const used = engine.lines.lines;
    // Lines found in the photo, in blue.
    ctx.lineWidth = Math.max(2, cv.width / 260);
    ctx.strokeStyle = '#2856a5';
    used.slice(engine.lines.drawn).forEach(draw);
    // Your strokes as drawn, faint; the lines actually used (snapped, joined), in black.
    ctx.strokeStyle = 'rgba(37, 34, 30, 0.3)';
    engine.guides.forEach((g) => draw(g.points ?? g));
    ctx.lineWidth = Math.max(3, cv.width / 160);
    ctx.strokeStyle = '#25221e';
    used.slice(0, engine.lines.drawn).forEach(draw);
    if (stroke.current) {
      draw(hover.current ? [...stroke.current, hover.current] : stroke.current);
      ctx.fillStyle = '#25221e';
      for (const [u, v] of mode === 'points' ? stroke.current : []) {
        ctx.beginPath();
        ctx.arc(u * cv.width, v * cv.height, ctx.lineWidth * 1.2, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  };
  useEffect(redraw, [original, engine.guides, engine.lines]);
  useEffect(() => {
    if (mode !== 'points') return;
    const onKey = (e) => {
      if (!stroke.current) return;
      if (e.key === 'Enter') finish();
      else if (e.key === 'Escape') { stroke.current = null; hover.current = null; redraw(); }
      else if (e.key === 'Backspace') { stroke.current.pop(); if (!stroke.current.length) stroke.current = null; redraw(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const toUV = (e) => {
    const cv = ref.current, r = cv.getBoundingClientRect();
    const s = Math.min(r.width / cv.width, r.height / cv.height);
    const ox = (r.width - cv.width * s) / 2, oy = (r.height - cv.height * s) / 2;
    return [Math.min(1, Math.max(0, (e.clientX - r.left - ox) / (cv.width * s))), Math.min(1, Math.max(0, (e.clientY - r.top - oy) / (cv.height * s)))];
  };
  const ring = useRing(ref);
  const handlers = mode === 'points'
    ? {
      onPointerDown: (e) => { if (e.button !== 0) return; (stroke.current ??= []).push(toUV(e)); redraw(); },
      onPointerMove: (e) => { ring.track(e); if (stroke.current) { hover.current = toUV(e); redraw(); } },
      onDoubleClick: () => { if (stroke.current) { stroke.current.pop(); finish(); } },
    }
    : {
      onPointerDown: (e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); stroke.current = [toUV(e)]; redraw(); },
      onPointerMove: (e) => { ring.track(e); if (stroke.current) { stroke.current.push(toUV(e)); redraw(); } },
      onPointerUp: () => { if (stroke.current && stroke.current.length > 2) finish(); else { stroke.current = null; redraw(); } },
    };
  return (
    <>
      <canvas ref={ref} className="viewer-canvas brush-canvas" onPointerLeave={ring.hide} {...handlers} />
      {tool?.snap !== false && ring.view(tool?.radius ?? 0.02)}
    </>
  );
}

// The big image: the WebGL mosaic, a stage image, or the brush layer. A faint
// Eixample grid sits behind it; dropping a file shows the panot.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export default function Viewer({ engine, view, brush, setTool }) {
  const box = useRef(null);
  const host = useRef(null);
  const [compare, setCompare] = useState(false);
  const [dropping, setDropping] = useState(false);
  // Zoom: scale k and translation (x, y) of the image inside the box.
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const toolRef = useRef(brush);
  toolRef.current = brush;
  const pan = useRef(null);
  useEffect(() => { setZoom({ k: 1, x: 0, y: 0 }); }, [engine.bitmap]);
  const showBrush = view === 'brush' && !compare;
  const showDraw = view === 'draw' && !compare;
  const useGl = view === 'final' && engine.gpu && !compare;

  useEffect(() => {
    if (!useGl || !host.current) return;
    host.current.appendChild(engine.glCanvas);
    return () => engine.glCanvas.remove();
  }, [useGl, engine.glCanvas]);

  useEffect(() => { engine.setWanted(view === 'brush' || view === 'draw' ? 'original' : view); }, [view, engine.setWanted]);

  // The mosaic is redrawn at the zoomed size, so zooming in stays sharp.
  const size = useRef([0, 0]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      size.current = [e.contentRect.width, e.contentRect.height];
      engine.setViewport(e.contentRect.width * zoomRef.current.k, e.contentRect.height * zoomRef.current.k);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [engine.setViewport]);
  useEffect(() => { engine.setViewport(size.current[0] * zoom.k, size.current[1] * zoom.k); }, [zoom.k, engine.setViewport]);

  // Wheel: with a tool, resizes its circle (brush size or snap radius);
  // otherwise, or with Ctrl, zooms towards the pointer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * 0.0015);
      const tool = toolRef.current;
      if (tool && !e.ctrlKey) {
        if (tool.kind === 'brush') setTool({ ...tool, size: clamp(tool.size * f, 0.005, 0.3) });
        else setTool({ ...tool, radius: clamp((tool.radius ?? 0.02) * f, 0.004, 0.1) });
        return;
      }
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const { k, x, y } = zoomRef.current;
      const k2 = clamp(k * f, 1, 8);
      // Keep the point under the pointer where it is.
      const nx = px - ((px - x) * k2) / k, ny = py - ((py - y) * k2) / k;
      setZoom({ k: k2, x: clamp(nx, r.width * (1 - k2), 0), y: clamp(ny, r.height * (1 - k2), 0) });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setTool]);

  // Dragging pans when zoomed in: left button without a tool, middle button always.
  const onPanStart = (e) => {
    if (zoomRef.current.k === 1 || !(e.button === 1 || (e.button === 0 && !toolRef.current))) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pan.current = { sx: e.clientX, sy: e.clientY, ...zoomRef.current };
  };
  const onPanMove = (e) => {
    const p0 = pan.current;
    if (!p0) return;
    const r = box.current.getBoundingClientRect();
    setZoom({ k: p0.k, x: clamp(p0.x + e.clientX - p0.sx, r.width * (1 - p0.k), 0), y: clamp(p0.y + e.clientY - p0.sy, r.height * (1 - p0.k), 0) });
  };

  const image = compare ? engine.images.original : engine.images[view];
  const ready = useGl ? engine.mosaicReady : showBrush || showDraw ? !!engine.images.original : !!image;
  const onDrop = (e) => {
    e.preventDefault();
    setDropping(false);
    const f = e.dataTransfer.files?.[0];
    if (f) engine.loadBlob(f);
  };

  return (
    <div
      className={`viewer chamfer${engine.busy && !showBrush && !showDraw ? ' is-busy' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); }}
      onDrop={onDrop}
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
        className={`viewer-box${zoom.k > 1 && !brush ? ' can-pan' : ''}`}
        ref={box}
        onPointerDownCapture={onPanStart}
        onPointerMove={onPanMove}
        onPointerUp={() => { pan.current = null; }}
      >
        <div className="viewer-zoom" style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})` }}>
          {showBrush ? <BrushLayer engine={engine} brush={brush} />
            : showDraw ? <DrawLayer engine={engine} tool={brush} />
            : useGl ? <div className="viewer-host" ref={host} />
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
        {zoom.k > 1 && (
          <button type="button" className="link" onClick={() => setZoom({ k: 1, x: 0, y: 0 })}>
            Ajustar ({Math.round(zoom.k * 100)} %)
          </button>
        )}
        <button
          type="button"
          className="link"
          onPointerDown={() => setCompare(true)}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
          onKeyDown={(e) => e.key === ' ' && setCompare(true)}
          onKeyUp={() => setCompare(false)}
          disabled={!engine.images.original}
        >
          Mantén para ver la original
        </button>
      </div>
    </div>
  );
}
