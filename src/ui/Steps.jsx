import { useState } from 'react';
import { ALGORITHMS, isVisible, PARAM } from '../core/params.js';
import { Samples, UploadBox } from './Home.jsx';
import { Macro, Param } from './Param.jsx';
import { ALGORITHM_INFO, STEPS } from './steps.js';
import Viewer from './Viewer.jsx';

function Explanation({ title, text, formula, folded }) {
  if (folded) {
    return (
      <details className="panel chamfer explain-folded">
        <summary className="panel-title">{title}</summary>
        <p className="explain">{text}</p>
        {formula && <pre className="formula-pre">{formula}</pre>}
      </details>
    );
  }
  return (
    <div className="panel chamfer">
      <h2 className="panel-title">{title}</h2>
      <p className="explain">{text}</p>
      {formula && (
        <details className="formula">
          <summary>Ver la fórmula</summary>
          <pre>{formula}</pre>
        </details>
      )}
    </div>
  );
}

function AlgorithmPicker({ engine }) {
  const [open, setOpen] = useState(false);
  const current = engine.params.algorithm;
  const primary = ['fracture', 'cracks'];
  const shown = open ? ALGORITHMS : ALGORITHMS.filter((a) => primary.includes(a.value) || a.value === current);
  return (
    <div className="algos">
      {shown.map((a) => (
        <button
          key={a.value}
          type="button"
          className={`algo${current === a.value ? ' on' : ''}`}
          aria-pressed={current === a.value}
          onClick={() => engine.setParam('algorithm', a.value)}
        >
          <span className="algo-img chamfer-s"><img src={`./styles/algo-${a.value}.jpg`} alt="" /></span>
          <span><b>{a.label}</b><small>{ALGORITHM_INFO[a.value].line}</small></span>
        </button>
      ))}
      <button type="button" className="link algos-more" onClick={() => setOpen(!open)}>
        {open ? 'Menos métodos' : `${ALGORITHMS.length - shown.length} métodos más`}
      </button>
    </div>
  );
}

function SimpleControls({ step, engine }) {
  return (
    <div className="panel chamfer fields">
      {step.simple.map((c, i) => {
        if (c.macro) return <Macro key={i} id={c.macro} engine={engine} />;
        if (c.param) return <Param key={i} k={c.param} engine={engine} />;
        if (c.kind === 'upload') return <div key={i}><UploadBox engine={engine} compact /><Samples engine={engine} /></div>;
        if (c.kind === 'algorithm') return <AlgorithmPicker key={i} engine={engine} />;
        if (c.kind === 'reseed') {
          return (
            <button key={i} type="button" className="btn chamfer-s reseed" onClick={() => engine.setParam('seed', (engine.params.seed % 999) + 1)}>
              Otra versión ↻
            </button>
          );
        }
        return null;
      })}
    </div>
  );
}

function AdvancedControls({ step, engine }) {
  const [tab, setTab] = useState(0);
  const groups = step.advanced;
  const keys = groups[Math.min(tab, groups.length - 1)].filter((k) => isVisible(PARAM[k], engine.params));
  return (
    <div className="panel chamfer panel-grow">
      {step.advancedTabs && (
        <div className="seg" role="tablist">
          {step.advancedTabs.map((t, i) => (
            <button key={t} type="button" role="tab" aria-selected={tab === i} className={tab === i ? 'on' : ''} onClick={() => setTab(i)}>{t}</button>
          ))}
        </div>
      )}
      <div className="fields fields-scroll">
        {step.id === 'foto' && <><UploadBox engine={engine} compact /><Samples engine={engine} /></>}
        {keys.map((k) => <Param key={k} k={k} engine={engine} />)}
      </div>
    </div>
  );
}

export default function Steps({ engine, stepId, mode }) {
  const index = Math.max(0, STEPS.findIndex((s) => s.id === stepId));
  const step = STEPS[index];
  const [viewByStep, setViewByStep] = useState({});
  const view = viewByStep[step.id] ?? step.views[0].key;
  const algoInfo = ALGORITHM_INFO[engine.params.algorithm];
  const text = step.id === 'trozos' ? algoInfo.explanation : step.explanation;
  const formula = step.id === 'trozos' ? algoInfo.formula : step.formula;
  const title = step.id === 'trozos' ? `Romper la imagen: ${ALGORITHMS.find((a) => a.value === engine.params.algorithm).label.toLowerCase()}` : step.title;
  const prev = STEPS[index - 1], next = STEPS[index + 1];

  return (
    <main className="work">
      <div className="work-main">
        <Viewer engine={engine} view={view} />
        {step.views.length > 1 && (
          <div className="views" role="tablist" aria-label="Vista">
            {step.views.map((v) => (
              <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={view === v.key ? 'on' : ''} onClick={() => setViewByStep({ ...viewByStep, [step.id]: v.key })}>
                {v.key === 'structure' ? engine.labels.structure ?? v.label : v.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <aside className="side">
        <Explanation title={title} text={text} formula={formula} folded={mode === 'avanzado'} />
        {mode === 'avanzado' ? <AdvancedControls key={step.id} step={step} engine={engine} /> : <SimpleControls step={step} engine={engine} />}
        <div className="actions actions-split">
          {prev ? <a className="btn chamfer-s" href={`#/pasos/${prev.id}`}>← {prev.title}</a> : <span />}
          {next
            ? <a className="btn btn-dark chamfer-s" href={`#/pasos/${next.id}`}>{next.title} →</a>
            : <button type="button" className="btn btn-dark chamfer-s" onClick={engine.download} disabled={!engine.mosaicReady}>Descargar PNG</button>}
        </div>
      </aside>
    </main>
  );
}
