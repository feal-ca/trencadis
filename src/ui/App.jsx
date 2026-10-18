import { useEffect, useState } from 'react';
import Home from './Home.jsx';
import Quick from './Quick.jsx';
import { STEPS } from './steps.js';
import Steps from './Steps.jsx';
import { SAMPLES, useEngine } from './useEngine.js';

const MODE_STORE = 'trencadis.mode';

function parseRoute(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/');
  if (parts[0] === 'rapido') return { page: 'quick' };
  if (parts[0] === 'pasos') return { page: 'steps', step: STEPS.some((s) => s.id === parts[1]) ? parts[1] : 'foto' };
  return { page: 'home' };
}

function loadMode() {
  try { return localStorage.getItem(MODE_STORE) === 'avanzado' ? 'avanzado' : 'simple'; } catch { return 'simple'; }
}

export default function App() {
  const engine = useEngine();
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  const [mode, setMode] = useState(loadMode);

  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(MODE_STORE, mode); } catch { /* ignore */ }
  }, [mode]);

  // Arriving at a working view without a photo: load the first sample.
  useEffect(() => {
    if (route.page !== 'home' && !engine.hasImage) engine.loadSample(SAMPLES[0].src);
  }, [route.page, engine.hasImage]);

  return (
    <div className="app">
      <div className="strip" aria-hidden="true" />
      <header className="top">
        <a className="brand" href="#/">Trencadís</a>
        {route.page === 'steps' && (
          <nav className="tabs" aria-label="Pasos">
            {STEPS.map((s, i) => (
              <a key={s.id} href={`#/pasos/${s.id}`} className={`tab chamfer-s${route.step === s.id ? ' on' : ''}`} aria-current={route.step === s.id ? 'step' : undefined}>
                {i + 1} {s.title}
              </a>
            ))}
          </nav>
        )}
        {route.page === 'quick' && <span className="muted">Hazlo ya</span>}
        {route.page !== 'home' && (
          <div className="seg mode" role="group" aria-label="Modo">
            {['simple', 'avanzado'].map((m) => (
              <button key={m} type="button" className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === 'simple' ? 'Simple' : 'Avanzado'}
              </button>
            ))}
          </div>
        )}
      </header>
      {route.page === 'home' && <Home engine={engine} />}
      {route.page === 'quick' && <Quick engine={engine} mode={mode} />}
      {route.page === 'steps' && <Steps engine={engine} stepId={route.step} mode={mode} />}
    </div>
  );
}
