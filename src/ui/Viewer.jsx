import { useEffect, useRef, useState } from 'react';
import { createLongPress, nearestLine } from './longPress.js';
import { clamp, pointerToUV } from './geometry.js';
import SegStatus from './SegStatus.jsx';
import ShapeLayer, { SegOutline } from './ShapeLayer.jsx';

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

// The photo with the guide lines. "free" mode: a stroke adds a line.
// "points" mode: each click adds a vertex; double-click or Enter finishes,
// Backspace removes the last vertex, Escape cancels. On touch the viewer bar
// shows buttons for the same (`onPending` reports the vertex count).
// In both, holding still on a line (drawn or automatic) turns it red, and
// letting go removes it.
function DrawLayer({ engine, tool, api, onPending }) {
  const ref = useRef(null);
  const stroke = useRef(null);
  const hover = useRef(null);
  const original = engine.images.original;
  const mode = tool?.mode ?? 'free';
  const radius = tool?.radius ?? 0.02;
  // Whether the last pointer down added a vertex, so a pinch can take it back.
  const added = useRef(false);
  // The line a long press is about to remove: { index, dist, uv }.
  const target = useRef(null);
  const timer = useRef(0);
  const finish = () => {
    const g = stroke.current;
    stroke.current = null;
    hover.current = null;
    onPending(0);
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
    // Removals are not drawn, nor the strokes they removed. A stroke may
    // have moved by up to its snap radius, so that much more counts.
    const aspect = cv.width / cv.height;
    const erased = (g, i) => engine.guides.slice(i + 1).some((e) => e.erase && e.erase.some(([eu, ev]) => nearestLine(
      [g.points ?? g], eu, ev, aspect, e.radius + (g.snap !== false && g.snapRadius ? g.snapRadius : 0))));
    engine.guides.forEach((g, i) => { if (!g.erase && !erased(g, i)) draw(g.points ?? g); });
    ctx.lineWidth = Math.max(3, cv.width / 160);
    ctx.strokeStyle = '#25221e';
    used.slice(0, engine.lines.drawn).forEach(draw);
    if (target.current && used[target.current.index]) {
      ctx.lineWidth = Math.max(5, cv.width / 110);
      ctx.strokeStyle = '#d64028';
      draw(used[target.current.index]);
    }
    if (stroke.current) {
      ctx.lineWidth = Math.max(3, cv.width / 160);
      ctx.strokeStyle = '#25221e';
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
  const cancel = () => { stroke.current = null; hover.current = null; onPending(0); redraw(); };
  const back = () => {
    if (!stroke.current) return;
    stroke.current.pop();
    if (!stroke.current.length) stroke.current = null;
    onPending(stroke.current?.length ?? 0);
    redraw();
  };
  // Presses in the bands around the image count as its nearest edge.
  const toUV = (e) => pointerToUV(ref.current, e).map((v) => clamp(v, 0, 1));
  // Holding still: the nearest line within the snap circle turns red, and
  // the stroke (or the vertex) the press began is dropped.
  const fire = useRef(null);
  fire.current = (x, y) => {
    const cv = ref.current;
    if (!cv) return;
    const uv = toUV({ clientX: x, clientY: y });
    const hit = nearestLine(engine.lines.lines, uv[0], uv[1], cv.width / cv.height, radius);
    // With no line near, the press was only a pause: the stroke goes on.
    if (!hit) return;
    if (mode === 'points') { if (added.current) { added.current = false; back(); } } else stroke.current = null;
    target.current = { ...hit, uv };
    redraw();
  };
  const press = useRef(null);
  press.current ??= createLongPress({ onFire: (x, y) => fire.current(x, y) });
  const pressDown = (e) => {
    press.current.down(e.pointerId, e.clientX, e.clientY, performance.now());
    clearTimeout(timer.current);
    timer.current = setTimeout(() => press.current.tick(performance.now()), 460);
  };
  // Letting go after a long press removes the red line; true if it did, so
  // the pointer up does nothing else.
  const pressUp = (e) => {
    clearTimeout(timer.current);
    const t = target.current;
    target.current = null;
    if (press.current.up(e.pointerId) !== 'fired' || !t) return false;
    engine.addGuide({ erase: [t.uv], radius: t.dist + 0.002 });
    return true;
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const ring = useRing(ref);
  api.current = {
    finish, back,
    cancel: () => {
      ring.hide();
      clearTimeout(timer.current);
      press.current.cancel();
      if (target.current) { target.current = null; redraw(); }
      if (mode !== 'points') cancel();
      else if (added.current) { added.current = false; back(); }
    },
  };
  useEffect(() => () => onPending(0), [mode]);
  useEffect(() => {
    if (mode !== 'points') return;
    const onKey = (e) => {
      if (!stroke.current) return;
      if (e.key === 'Enter') finish();
      else if (e.key === 'Escape') cancel();
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const handlers = mode === 'points'
    ? {
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        (stroke.current ??= []).push(toUV(e));
        added.current = true;
        pressDown(e);
        onPending(stroke.current.length);
        redraw();
      },
      onPointerMove: (e) => {
        ring.track(e);
        press.current.move(e.pointerId, e.clientX, e.clientY);
        if (stroke.current && !target.current) { hover.current = toUV(e); redraw(); }
      },
      onPointerUp: (e) => { pressUp(e); added.current = false; },
      onDoubleClick: () => { if (stroke.current) { stroke.current.pop(); finish(); } },
    }
    : {
      onPointerDown: (e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        stroke.current = [toUV(e)];
        pressDown(e);
        ring.track(e);
        redraw();
      },
      onPointerMove: (e) => {
        ring.track(e);
        press.current.move(e.pointerId, e.clientX, e.clientY);
        if (stroke.current) { stroke.current.push(toUV(e)); redraw(); }
      },
      onPointerUp: (e) => {
        if (e.pointerType === 'touch') ring.hide();
        if (pressUp(e)) return;
        if (stroke.current && stroke.current.length > 2) finish(); else { stroke.current = null; redraw(); }
      },
    };
  return (
    <>
      <canvas ref={ref} className="viewer-canvas brush-canvas" onPointerLeave={ring.hide} onPointerCancel={() => api.current.cancel()} onContextMenu={(e) => e.preventDefault()} {...handlers} />
      {tool?.snap !== false && ring.view(radius)}
    </>
  );
}

// The big image: the WebGL mosaic, a stage image, or the line drawing layer,
// with the outline of the shapes found and the touched shapes over it, and
// the shape search's progress at the bottom. A faint Eixample grid sits
// behind it; a file dragged over the window shows the panot.
export default function Viewer({ engine, dropping, view, brush, setTool, onShapeTool }) {
  const box = useRef(null);
  const host = useRef(null);
  const [compare, setCompare] = useState(false);
  // Zoom: scale k and translation (x, y) of the image inside the box.
  const [zoom, setZoom] = useState({ k: 1, x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const toolRef = useRef(brush);
  toolRef.current = brush;
  const pan = useRef(null);
  // Pointers down on the image, and the pinch they make when there are two.
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  // The active tool layer: cancel (a pinch started), and in points mode finish/back.
  const toolApi = useRef(null);
  const [pending, setPending] = useState(0);
  useEffect(() => { setZoom({ k: 1, x: 0, y: 0 }); }, [engine.bitmap]);
  const showDraw = view === 'draw' && !compare;
  const useGl = view === 'final' && engine.gpu && !compare;
  const showShapes = view === 'final' && brush?.kind === 'shape' && !compare && engine.hasImage;

  useEffect(() => {
    if (!useGl || !host.current) return;
    host.current.appendChild(engine.glCanvas);
    return () => engine.glCanvas.remove();
  }, [useGl, engine.glCanvas]);

  useEffect(() => { engine.setWanted(view === 'draw' ? 'original' : view); }, [view, engine.setWanted]);

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
        setTool({ ...tool, radius: clamp((tool.radius ?? 0.02) * f, 0.004, 0.1) });
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

  // Dragging pans when zoomed in: left button or one finger without a tool,
  // middle button always. Two fingers pinch to zoom and pan, tool or not; the
  // second finger cancels whatever stroke the first one started.
  const onDown = (e) => {
    const r = box.current.getBoundingClientRect();
    pointers.current.set(e.pointerId, [e.clientX - r.left, e.clientY - r.top]);
    if (pointers.current.size === 2) {
      e.stopPropagation();
      toolApi.current?.cancel();
      pan.current = null;
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ...zoomRef.current };
      return;
    }
    if (pointers.current.size > 2 || pinch.current) { e.stopPropagation(); return; }
    if (zoomRef.current.k === 1 || !(e.button === 1 || (e.button === 0 && !toolRef.current))) return;
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

  const image = compare ? engine.images.original : engine.images[view];
  const ready = useGl ? engine.mosaicReady : showDraw ? !!engine.images.original : !!image;

  return (
    <div
      className={`viewer chamfer${engine.busy && !showDraw ? ' is-busy' : ''}${brush ? ` tool-${brush.kind}` : ''}`}
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
        onPointerDownCapture={onDown}
        onPointerMoveCapture={onMove}
        onPointerUpCapture={onUp}
        onPointerCancelCapture={onUp}
      >
        <div className="viewer-zoom" style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.k})` }}>
          {showDraw ? <DrawLayer engine={engine} tool={brush} api={toolApi} onPending={setPending} />
            : useGl ? <div className="viewer-host" ref={host} />
            : image && <ImageCanvas image={image} className="viewer-canvas" />}
          {engine.hasImage && <SegOutline engine={engine} />}
          {showShapes && <ShapeLayer engine={engine} api={toolApi} zoom={zoom} />}
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
        <SegStatus engine={engine} onShapeTool={onShapeTool} />
        <span className="status" aria-live="polite">
          {engine.error ? <span className="err">{engine.error}</span>
            : engine.busy ? 'Calculando…'
            : engine.info ? `${engine.info.shards.toLocaleString('es')} trozos` : ''}
        </span>
        {showDraw && pending > 0 && (
          <span className="point-actions">
            <button type="button" className="link" onClick={() => toolApi.current?.back()}>Quitar punto</button>
            <button type="button" className="btn btn-dark chamfer-s" onClick={() => toolApi.current?.finish()} disabled={pending < 2}>Terminar línea</button>
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
          disabled={!engine.images.original}
        >
          Mantén para ver la original
        </button>
      </div>
    </div>
  );
}
