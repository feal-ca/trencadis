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
  return (
    <canvas
      ref={ref}
      className="viewer-canvas brush-canvas"
      onPointerDown={(e) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); dab(e); }}
      onPointerMove={(e) => drawing.current && dab(e)}
      onPointerUp={() => { if (drawing.current) { drawing.current = false; engine.commitMask(); } }}
    />
  );
}

// The photo with the guide lines; a stroke adds a new line.
function DrawLayer({ engine }) {
  const ref = useRef(null);
  const stroke = useRef(null);
  const original = engine.images.original;
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
    ctx.lineWidth = Math.max(3, cv.width / 160);
    ctx.strokeStyle = '#25221e';
    for (const g of [...engine.guides, ...(stroke.current ? [stroke.current] : [])]) {
      ctx.beginPath();
      g.forEach(([u, v], i) => (i ? ctx.lineTo(u * cv.width, v * cv.height) : ctx.moveTo(u * cv.width, v * cv.height)));
      ctx.stroke();
    }
  };
  useEffect(redraw, [original, engine.guides]);
  const toUV = (e) => {
    const cv = ref.current, r = cv.getBoundingClientRect();
    const s = Math.min(r.width / cv.width, r.height / cv.height);
    const ox = (r.width - cv.width * s) / 2, oy = (r.height - cv.height * s) / 2;
    return [Math.min(1, Math.max(0, (e.clientX - r.left - ox) / (cv.width * s))), Math.min(1, Math.max(0, (e.clientY - r.top - oy) / (cv.height * s)))];
  };
  return (
    <canvas
      ref={ref}
      className="viewer-canvas brush-canvas"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); stroke.current = [toUV(e)]; redraw(); }}
      onPointerMove={(e) => { if (stroke.current) { stroke.current.push(toUV(e)); redraw(); } }}
      onPointerUp={() => {
        const g = stroke.current;
        stroke.current = null;
        if (g && g.length > 2) engine.addGuide(g);
        else redraw();
      }}
    />
  );
}

// The big image: the WebGL mosaic, a stage image, or the brush layer. A faint
// Eixample grid sits behind it; dropping a file shows the panot.
export default function Viewer({ engine, view, brush }) {
  const box = useRef(null);
  const host = useRef(null);
  const [compare, setCompare] = useState(false);
  const [dropping, setDropping] = useState(false);
  const showBrush = view === 'brush' && !compare;
  const showDraw = view === 'draw' && !compare;
  const useGl = view === 'final' && engine.gpu && !compare;

  useEffect(() => {
    if (!useGl || !host.current) return;
    host.current.appendChild(engine.glCanvas);
    return () => engine.glCanvas.remove();
  }, [useGl, engine.glCanvas]);

  useEffect(() => { engine.setWanted(view === 'brush' || view === 'draw' ? 'original' : view); }, [view, engine.setWanted]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => engine.setViewport(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [engine.setViewport]);

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
      className="viewer chamfer"
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
      <div className="viewer-box" ref={box}>
        {showBrush ? <BrushLayer engine={engine} brush={brush} />
          : showDraw ? <DrawLayer engine={engine} />
          : useGl ? <div className="viewer-host" ref={host} />
          : image && <ImageCanvas image={image} className="viewer-canvas" />}
        {!ready && <p className="viewer-empty">{engine.hasImage ? 'Calculando…' : 'Todavía no hay foto.'}</p>}
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
