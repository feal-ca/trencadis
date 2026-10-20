import { useEffect, useRef, useState } from 'react';
import Panel, { Export } from './Panel.jsx';
import Sheet from './Sheet.jsx';
import { STEPS } from './steps.js';
import { SAMPLES, useEngine } from './useEngine.js';
import { MOBILE, useMedia } from './useMedia.js';
import Viewer from './Viewer.jsx';

export default function App() {
  const engine = useEngine();
  const [open, setOpen] = useState('detalle');
  // Which step's partial result is on screen instead of the mosaic.
  const [peek, setPeek] = useState(null);
  const [brush, setBrush] = useState(null);
  const input = useRef(null);
  // Phones: the steps live in a bottom sheet and the image fills the rest.
  const mobile = useMedia(MOBILE);
  const [snap, setSnap] = useState('half');
  const [sheetH, setSheetH] = useState(0);

  useEffect(() => {
    if (!engine.hasImage) engine.loadSample(SAMPLES[0].src);
  }, []);

  // `brush` is the active tool: the detail brush or guide drawing.
  const view = brush ? brush.kind : peek?.view ?? 'final';
  const peekStep = peek && STEPS.find((s) => s.id === peek.step);

  const panel = (
    <Panel
      engine={engine}
      open={open}
      setOpen={(id) => { setOpen(id); if (id && snap === 'peek') setSnap('half'); }}
      peek={peek}
      setPeek={setPeek}
      brush={brush}
      setBrush={setBrush}
      withExport={!mobile}
    />
  );

  return (
    <div className={`app${mobile ? ' is-mobile' : ''}`} style={mobile ? { '--sheet-h': `${sheetH}px` } : undefined}>
      <div className="strip" aria-hidden="true" />
      <header className="top">
        <span className="brand">Trencadís</span>
        <button type="button" className="btn btn-dark chamfer-s" onClick={() => input.current.click()}>Subir foto</button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && engine.loadBlob(e.target.files[0])} />
        <span className="samples muted">
          o prueba con{' '}
          {SAMPLES.map((s, i) => (
            <span key={s.src}>
              {i > 0 && ', '}
              <button type="button" className="link" onClick={() => engine.loadSample(s.src)}>{s.label}</button>
            </span>
          ))}
        </span>
      </header>
      <main className="work">
        <div className="work-main">
          <Viewer engine={engine} view={view} brush={brush} setTool={setBrush} />
          {peekStep && peekStep.views.length > 1 && (
            <div className="views" role="tablist" aria-label="Vista">
              {peekStep.views.map((v) => (
                <button key={v.key} type="button" role="tab" aria-selected={peek.view === v.key} className={peek.view === v.key ? 'on' : ''} onClick={() => setPeek({ ...peek, view: v.key })}>
                  {v.key === 'structure' ? engine.labels.structure ?? v.label : v.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {mobile
          ? <Sheet snap={snap} setSnap={setSnap} onHeight={setSheetH} footer={<Export engine={engine} />}>{panel}</Sheet>
          : <aside className="side">{panel}</aside>}
      </main>
    </div>
  );
}
