import { useEffect, useRef, useState } from 'react';

// Heights of the bottom sheet on phones, from the viewport height: a peek with
// only the export row, half the screen (the image stays fully visible above it),
// and nearly the whole screen for long settings.
export function sheetHeights(vh) {
  return { peek: 92, half: Math.round(vh * 0.46), full: vh - 56 };
}

function useViewportHeight() {
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setVh(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vh;
}

// The steps panel as a sheet over the bottom of the screen. Drag the handle to
// resize it (it snaps to the nearest height); tap it to fold or unfold.
export default function Sheet({ snap, setSnap, onHeight, footer, children }) {
  const vh = useViewportHeight();
  const heights = sheetHeights(vh);
  const [drag, setDrag] = useState(null);
  const start = useRef(null);
  const height = drag ?? heights[snap];
  useEffect(() => { onHeight(Math.min(height, heights.half)); }, [height, heights.half, onHeight]);

  const onDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { y: e.clientY, h: heights[snap], moved: false };
  };
  const onMove = (e) => {
    const s = start.current;
    if (!s) return;
    const dy = e.clientY - s.y;
    if (Math.abs(dy) > 6) s.moved = true;
    if (s.moved) setDrag(Math.min(heights.full, Math.max(heights.peek, s.h - dy)));
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    if (!s.moved) { setSnap(snap === 'peek' ? 'half' : 'peek'); return; }
    const h = drag ?? s.h;
    const nearest = Object.entries(heights).reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a));
    setDrag(null);
    setSnap(nearest[0]);
  };

  return (
    <aside className={`side sheet${drag != null ? ' is-dragging' : ''}`} style={{ height }} data-snap={snap}>
      <button
        type="button"
        className="sheet-handle"
        aria-label={snap === 'peek' ? 'Mostrar los ajustes' : 'Plegar los ajustes'}
        aria-expanded={snap !== 'peek'}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => { start.current = null; setDrag(null); }}
        // Keyboard activation (pointer taps are handled in onUp).
        onClick={(e) => { if (e.detail === 0) setSnap(snap === 'peek' ? 'half' : 'peek'); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); setSnap(snap === 'peek' ? 'half' : 'full'); }
          if (e.key === 'ArrowDown') { e.preventDefault(); setSnap(snap === 'full' ? 'half' : 'peek'); }
        }}
      >
        <span aria-hidden="true" />
      </button>
      <div className="sheet-body">{children}</div>
      <div className="sheet-foot">{footer}</div>
    </aside>
  );
}
