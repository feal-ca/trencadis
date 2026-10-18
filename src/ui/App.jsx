import { useEffect, useRef, useState } from 'react';
import Panel from './Panel.jsx';
import { STEPS } from './steps.js';
import { SAMPLES, useEngine } from './useEngine.js';
import Viewer from './Viewer.jsx';

export default function App() {
  const engine = useEngine();
  const [open, setOpen] = useState('detalle');
  // Which step's partial result is on screen instead of the mosaic.
  const [peek, setPeek] = useState(null);
  const [brush, setBrush] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    if (!engine.hasImage) engine.loadSample(SAMPLES[0].src);
  }, []);

  const view = brush ? 'brush' : peek?.view ?? 'final';
  const peekStep = peek && STEPS.find((s) => s.id === peek.step);

  return (
    <div className="app">
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
          <Viewer engine={engine} view={view} brush={brush} />
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
        <Panel engine={engine} open={open} setOpen={setOpen} peek={peek} setPeek={setPeek} brush={brush} setBrush={setBrush} />
      </main>
    </div>
  );
}
