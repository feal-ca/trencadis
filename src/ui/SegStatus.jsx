import { useEffect, useState } from 'react';

const percent = (seg) => (seg.total ? Math.round((100 * seg.done) / seg.total) : 0);

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

  let text = null;
  let bar = null;
  let actions = null;
  if (seg.phase === 'download') { text = `Descargando el modelo… ${percent(seg)} %`; bar = percent(seg); }
  else if (seg.phase === 'encode') text = 'Preparando la foto…';
  else if (seg.phase === 'decode') { text = `Buscando las formas de la foto… ${seg.found ?? 0} encontradas`; bar = percent(seg); }
  else if (seg.phase === 'ask') {
    text = 'Buscar las formas de la foto: descarga de unos 10 MB la primera vez';
    actions = (
      <>
        <button type="button" className="btn btn-dark chamfer-s" onClick={engine.segAccept}>Buscar</button>
        <button type="button" className="link" onClick={engine.segDecline}>Ahora no</button>
      </>
    );
  } else if (seg.phase === 'error') {
    text = 'No se han podido buscar las formas';
    actions = <button type="button" className="link" onClick={engine.segRetry}>Reintentar</button>;
  } else if (seg.phase === 'done' && shown) {
    const { found } = seg;
    text = found === 1 ? '1 forma' : found ? `${found} formas` : 'No se han encontrado formas';
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
