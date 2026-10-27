import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { inside as onRegion, regionAt, regionBox } from './shapeMask.js';
import { clamp, pointerToUV } from './geometry.js';

// Whether the normalised point (u, v) falls on a shape's pixels.
const inside = (z, u, v) => !!z.region && onRegion(z.region, u, v);

// The size in canvas pixels for an overlay of an iw x ih image drawn with
// object-fit: contain in `ref`'s box: the size it shows at, in device
// pixels, so outlines stay thin and sharp.
function useFitSize(ref, iw, ih) {
  const [size, setSize] = useState(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !iw || !ih) return undefined;
    const measure = () => {
      const s = Math.min(cv.offsetWidth / iw, cv.offsetHeight / ih) * (window.devicePixelRatio || 1);
      const long = clamp(Math.round(Math.max(iw, ih) * s), 256, 2048);
      const W = Math.round(long * (iw >= ih ? 1 : iw / ih)), H = Math.round(long * (iw >= ih ? ih / iw : 1));
      setSize((old) => (old && old[0] === W && old[1] === H ? old : [W, H]));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [ref, iw, ih]);
  return size;
}

// Paints a labelled mask into `img` (ImageData). `at(x, y)` is the label at
// a pixel, -1 for none. A pixel of a label lies on its outline when a pixel
// `r` away (inside the image) has another label. With `dash`, the outline
// goes on and off in squares of that many pixels, so it reads as dashed in
// any direction. `fill` paints the inside; `box` limits the scan.
function paint(img, at, { line, fill = null, r = 1, dash = 0, box = null }) {
  const { width: W, height: H, data } = img;
  const [x0, y0, x1, y1] = box ?? [0, 0, W, H];
  for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      const l = at(x, y);
      if (l < 0) continue;
      const edge = (x >= r && at(x - r, y) !== l) || (x + r < W && at(x + r, y) !== l)
        || (y >= r && at(x, y - r) !== l) || (y + r < H && at(x, y + r) !== l);
      const c = edge ? (!dash || ((Math.floor(x / dash) + Math.floor(y / dash)) & 1) ? line : null) : fill;
      if (c) data.set(c, (y * W + x) * 4);
    }
  }
}

const OCHRE = [227, 163, 59];
const WHITE = [255, 255, 255, 255];

// The outline of the objects the segmentation found, dashed, while it
// searches and for two seconds after; then it fades.
export function SegOutline({ engine }) {
  const ref = useRef(null);
  const { seg, segments, bitmap } = engine;
  const size = useFitSize(ref, bitmap?.width, bitmap?.height);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (seg.phase === 'decode') { setOn(true); return undefined; }
    if (seg.phase !== 'done' || !segments) { setOn(false); return undefined; }
    setOn(true);
    const t = setTimeout(() => setOn(false), 2000);
    return () => clearTimeout(t);
  }, [seg.phase, segments]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !size) return;
    [cv.width, cv.height] = size;
    if (!segments) return;
    const [W, H] = size;
    const img = new ImageData(W, H);
    const { w, h, labels } = segments;
    paint(img, (x, y) => labels[Math.floor(((y + 0.5) * h) / H) * w + Math.floor(((x + 0.5) * w) / W)], {
      line: WHITE, r: Math.max(1, Math.round(Math.max(W, H) / 900)), dash: Math.max(4, Math.round(Math.max(W, H) / 150)),
    });
    cv.getContext('2d').putImageData(img, 0, 0);
  }, [segments, size]);
  return <canvas ref={ref} className={`viewer-canvas seg-outline${on && segments ? '' : ' is-gone'}`} aria-hidden="true" />;
}

// "Tocar una forma" on the mosaic. The first touch picks the shape the
// model finds there, fills it and opens a menu by it (more detail, less
// detail, remove). A touch inside the selected shape grows or corrects it;
// a touch elsewhere picks another (or selects a shape already set). Shapes
// already set show a dashed outline. Two fingers still zoom: the viewer
// calls `api.current.cancel()`. `zoom` is the viewer's { k, x, y }, so the
// menu stays the same size and in sight.
export default function ShapeLayer({ engine, api, zoom }) {
  const ref = useRef(null);
  const menu = useRef(null);
  const { bitmap, zones } = engine;
  const size = useFitSize(ref, bitmap?.width, bitmap?.height);
  const [selected, setSelected] = useState(null);
  // A note at the touched point while the model looks, or when it finds nothing.
  const [note, setNote] = useState(null);
  const [pos, setPos] = useState(null);
  const tap = useRef(null);
  const busy = useRef(false);
  const zonesRef = useRef(zones);
  zonesRef.current = zones;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const sel = zones.find((z) => z.id === selected && z.region) ?? null;

  // A picked shape that never got a mode is dropped when it stops being the
  // selected one, so it doesn't stay in the zones.
  const { removeZone } = engine;
  const forget = (id) => {
    const z = zonesRef.current.find((x) => x.id === id);
    if (z && !z.mode) removeZone(id);
  };
  useEffect(() => () => forget(selectedRef.current), []);
  // Undo, "Quitar todas" or a new photo may take the selected shape away.
  useEffect(() => { if (selected && !zones.some((z) => z.id === selected)) setSelected(null); }, [zones, selected]);
  useEffect(() => {
    if (!note?.miss) return undefined;
    const t = setTimeout(() => setNote(null), 1500);
    return () => clearTimeout(t);
  }, [note]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !size) return;
    const [W, H] = size;
    [cv.width, cv.height] = size;
    const img = new ImageData(W, H);
    const r = Math.max(1, Math.round(Math.max(W, H) / 600));
    for (const z of zones) {
      if (!z.region || !z.mode || z.id === selected) continue;
      paint(img, regionAt(z.region, W, H), { line: WHITE, r, dash: Math.max(4, Math.round(Math.max(W, H) / 150)), box: regionBox(z.region, W, H, r) });
    }
    if (sel) paint(img, regionAt(sel.region, W, H), { line: [...OCHRE, 255], fill: [...OCHRE, 90], r: 2 * r, box: regionBox(sel.region, W, H, r) });
    cv.getContext('2d').putImageData(img, 0, 0);
  }, [zones, selected, size]);

  // The overlay's image rectangle in the zoom layer's own coordinates.
  const frame = () => {
    const cv = ref.current;
    const s = Math.min(cv.offsetWidth / cv.width, cv.offsetHeight / cv.height);
    return { x: cv.offsetLeft + (cv.offsetWidth - cv.width * s) / 2, y: cv.offsetTop + (cv.offsetHeight - cv.height * s) / 2, w: cv.width * s, h: cv.height * s };
  };
  // The menu goes under the shape's box, or over it if there is no room,
  // inside the part of the image in sight.
  useLayoutEffect(() => {
    const cv = ref.current, m = menu.current;
    if (!sel || !cv || !m || !size) { setPos(null); return; }
    const f = frame();
    const [u0, v0, u1, v1] = sel.region.box;
    const { k, x, y } = zoom;
    const host = cv.parentElement;
    const vx0 = -x / k, vy0 = -y / k, vx1 = vx0 + host.offsetWidth / k, vy1 = vy0 + host.offsetHeight / k;
    const mw = m.offsetWidth / k, mh = m.offsetHeight / k, gap = 8 / k;
    let top = f.y + v1 * f.h + gap;
    if (top + mh > vy1 - gap) top = f.y + v0 * f.h - gap - mh;
    top = clamp(top, vy0 + gap, vy1 - mh - gap);
    const left = clamp(f.x + ((u0 + u1) / 2) * f.w - mw / 2, vx0 + gap, Math.max(vx0 + gap, vx1 - mw - gap));
    setPos((old) => (old && old.left === left && old.top === top ? old : { left, top }));
  }, [sel?.region, zoom, size]);

  // Not clamped: a touch outside the image is dropped by touch().
  const toUV = (e) => pointerToUV(ref.current, e);
  const touch = async (u, v) => {
    if (busy.current || u < 0 || v < 0 || u > 1 || v > 1) return;
    const current = zonesRef.current.find((z) => z.id === selectedRef.current);
    const f = frame();
    const at = { left: f.x + u * f.w, top: f.y + v * f.h };
    busy.current = true;
    try {
      if (current && inside(current, u, v)) {
        setNote({ ...at, text: 'Ajustando la forma…' });
        await engine.refineShape(current.id, u, v);
        return;
      }
      // A shape already set, touched again, is selected to change it.
      const set = [...zonesRef.current].reverse().find((z) => z.mode && inside(z, u, v));
      if (set) { forget(selectedRef.current); setSelected(set.id); return; }
      setNote({ ...at, text: 'Buscando la forma…' });
      const id = await engine.pickShape(u, v);
      if (id?.error) { setNote({ ...at, text: 'No se ha podido buscar la forma', miss: true }); return; }
      if (!id) { setNote({ ...at, text: 'Aquí no hay ninguna forma', miss: true }); return; }
      forget(selectedRef.current);
      setSelected(id);
    } finally {
      busy.current = false;
      // The "looking" note goes even if the engine threw; "nothing here" and
      // "could not search" stay their 1.5 s.
      setNote((n) => (n?.miss ? n : null));
    }
  };
  api.current = { cancel: () => { tap.current = null; } };

  const k = zoom.k;
  const unscale = { transform: `scale(${1 / k})`, transformOrigin: '0 0' };
  const mode = sel?.mode ?? null;
  return (
    <>
      <canvas
        ref={ref}
        className="viewer-canvas shape-canvas"
        onPointerDown={(e) => { if (e.button === 0) tap.current = { x: e.clientX, y: e.clientY }; }}
        onPointerMove={(e) => { if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 8) tap.current = null; }}
        onPointerUp={(e) => { if (!tap.current) return; tap.current = null; touch(...toUV(e)); }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {sel && (
        <div
          ref={menu}
          className="shape-menu chamfer-s"
          role="group"
          aria-label="Forma tocada"
          style={{ ...unscale, left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
        >
          <button type="button" className={mode === 'more' ? 'on' : ''} aria-pressed={mode === 'more'} onClick={() => engine.setZoneMode(sel.id, 'more')}>Más detalle</button>
          <button type="button" className={mode === 'less' ? 'on' : ''} aria-pressed={mode === 'less'} onClick={() => engine.setZoneMode(sel.id, 'less')}>Menos detalle</button>
          <button type="button" onClick={() => { engine.removeZone(sel.id); setSelected(null); }}>Quitar</button>
        </div>
      )}
      {note && (
        <span className="shape-note" role="status" style={{ ...unscale, transform: `scale(${1 / k}) translate(-50%, calc(-100% - 12px))`, left: note.left, top: note.top }}>
          {note.text}
        </span>
      )}
    </>
  );
}
