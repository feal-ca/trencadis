import { useEffect, useRef, useState } from 'react';
import { HINT_MS, HINT_STORE, SHAPE_HINT, statusOf } from './segStatusText.js';

const hintSeen = () => { try { return localStorage.getItem(HINT_STORE) != null; } catch { return true; } };

// How the search for the photo's shapes is going, in the viewer's bar. The
// "done" line shows for two seconds and goes; "off" has its own link in the panel.
// The first time a photo of the user's ends with shapes, a hint to the shape
// tool follows for a few seconds (the samples' and restored shapes are `preset`).
export default function SegStatus({ engine, onShapeTool }) {
  const { seg } = engine;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (seg.phase !== 'done') { setShown(false); return undefined; }
    setShown(true);
    const t = setTimeout(() => setShown(false), 2000);
    return () => clearTimeout(t);
  }, [seg.phase, seg.found]);

  const [hint, setHint] = useState(false);
  // Set while this photo's hint is the one being shown, so a re-run of the
  // effect does not take it for a hint already seen.
  const hinting = useRef(false);
  useEffect(() => {
    if (seg.phase !== 'done' || seg.preset || !(seg.found > 0)) { hinting.current = false; setHint(false); return undefined; }
    if (!hinting.current) {
      if (hintSeen()) return undefined;
      try { localStorage.setItem(HINT_STORE, 'shown'); } catch { /* ignore */ }
      hinting.current = true;
    }
    setHint(true);
    const t = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(t);
  }, [seg.phase, seg.preset, seg.found]);

  const { bar } = statusOf(seg);
  let { text, actions } = statusOf(seg);
  if (seg.phase === 'done' && shown) {
    const { found } = seg;
    text = found === 1 ? '1 forma' : found ? `${found} formas` : 'No se han encontrado formas';
  }
  if (hint) {
    text = SHAPE_HINT;
    actions = (
      <button type="button" className="link" onClick={() => { setHint(false); onShapeTool(); }}>Probar</button>
    );
  } else if (actions === 'ask') {
    actions = (
      <>
        <button type="button" className="btn btn-dark chamfer-s" onClick={engine.segAccept}>Buscar</button>
        <button type="button" className="link" onClick={engine.segDecline}>Ahora no</button>
      </>
    );
  } else if (actions === 'retry') {
    actions = <button type="button" className="link" onClick={engine.segRetry}>Reintentar</button>;
  }
  if (!text) return null;
  return (
    <div className="seg-status" role="status">
      <div className="seg-line">
        <span>{text}</span>
        {actions && <span className="seg-actions">{actions}</span>}
      </div>
      {bar != null && <div className="seg-bar"><div style={{ width: `${bar}%` }} /></div>}
    </div>
  );
}
