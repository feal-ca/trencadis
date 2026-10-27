import { useEffect, useState } from 'react';
import { statusOf } from './segStatusText.js';

// How the search for the photo's shapes is going, drawn over the viewer. The
// "done" line shows for two seconds and goes; "off" has its own link in the panel.
export default function SegStatus({ engine }) {
  const { seg } = engine;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (seg.phase !== 'done') { setShown(false); return undefined; }
    setShown(true);
    const t = setTimeout(() => setShown(false), 2000);
    return () => clearTimeout(t);
  }, [seg.phase, seg.found]);

  const { bar } = statusOf(seg);
  let { text, actions } = statusOf(seg);
  if (seg.phase === 'done' && shown) {
    const { found } = seg;
    text = found === 1 ? '1 forma' : found ? `${found} formas` : 'No se han encontrado formas';
  }
  if (actions === 'ask') {
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
      <span>{text}</span>
      {actions && <span className="seg-actions">{actions}</span>}
      {bar != null && <div className="seg-bar"><div style={{ width: `${bar}%` }} /></div>}
    </div>
  );
}
