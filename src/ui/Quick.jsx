import { useState } from 'react';
import { applyStyle, readStyle, STYLES } from '../core/macros.js';
import { isVisible, PARAM } from '../core/params.js';
import { Macro, Param } from './Param.jsx';
import { STEPS } from './steps.js';
import Viewer from './Viewer.jsx';

const ADVANCED_TABS = STEPS.filter((s) => s.id !== 'foto');

function Advanced({ engine }) {
  const [tab, setTab] = useState('trozos');
  const step = ADVANCED_TABS.find((s) => s.id === tab);
  const keys = step.advanced.flat().filter((k) => isVisible(PARAM[k], engine.params));
  return (
    <div className="panel chamfer panel-grow">
      <div className="seg" role="tablist">
        {ADVANCED_TABS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={tab === s.id} className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)}>
            {s.title}
          </button>
        ))}
      </div>
      <div className="fields fields-scroll">
        {keys.map((k) => <Param key={k} k={k} engine={engine} />)}
      </div>
    </div>
  );
}

export default function Quick({ engine, mode }) {
  const current = readStyle(engine.params);
  return (
    <main className="work">
      <Viewer engine={engine} view="final" />
      <aside className="side">
        <div className="panel chamfer">
          <h2 className="panel-title">Estilo</h2>
          <div className="styles">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`style${current === s.id ? ' on' : ''}`}
                aria-pressed={current === s.id}
                onClick={() => engine.setParams((p) => applyStyle(p, s.id))}
              >
                <span className="style-img chamfer-s"><img src={`./styles/${s.id}.jpg`} alt="" /></span>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {mode === 'avanzado' ? <Advanced engine={engine} /> : (
          <div className="panel chamfer fields">
            <Macro id="size" engine={engine} help={false} />
            <Macro id="fidelity" engine={engine} help={false} />
            <Macro id="gloss" engine={engine} help={false} />
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn btn-dark chamfer-s" onClick={engine.download} disabled={!engine.mosaicReady}>Descargar PNG</button>
          <a className="btn chamfer-s" href="#/pasos/foto">Ver paso a paso</a>
        </div>
      </aside>
    </main>
  );
}
