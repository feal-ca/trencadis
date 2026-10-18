import { useState } from 'react';
import { ALGORITHMS, isVisible, PARAM } from '../core/params.js';
import { Macro, Param } from './Param.jsx';
import { ALGORITHM_INFO, STEPS } from './steps.js';

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

function BrushTools({ engine, brush, setBrush }) {
  const tool = (mode, label) => (
    <button type="button" className={brush?.mode === mode ? 'on' : ''} aria-pressed={brush?.mode === mode}
      onClick={() => setBrush(brush?.mode === mode ? null : { mode, size: brush?.size ?? 0.06 })}>
      {label}
    </button>
  );
  return (
    <div className="field">
      <span className="field-row"><span>Pincel de detalle</span></span>
      <div className="brush-row">
        <div className="seg" role="group" aria-label="Pincel">
          {tool('remove', 'Quitar detalle')}
          {tool('add', 'Añadir detalle')}
        </div>
        <button type="button" className="link" onClick={engine.clearMask} disabled={engine.mask.current?.empty ?? true}>Borrar</button>
      </div>
      {brush && (
        <label className="field-row brush-size">
          <span>Tamaño del pincel</span>
          <input type="range" min={10} max={200} value={Math.round(brush.size * 1000)} onChange={(e) => setBrush({ ...brush, size: e.target.value / 1000 })} />
        </label>
      )}
      <span className="help">
        {brush ? 'Pinta sobre la foto. Al soltar se recalcula el detalle.' : 'Para zonas con mucho detalle que no te interesa, o para pedir más trozos en una zona.'}
      </span>
    </div>
  );
}

function RowTools({ engine, tool, setTool }) {
  const drawing = tool?.kind === 'draw';
  return (
    <div className="field rows-block">
      <span className="field-row"><span>Hileras</span></span>
      <span className="help">Piezas rectangulares en fila a lo largo de una línea, como la espiral negra de los bancos de Gaudí. Ayudan a que se lean contornos, barandillas o letras.</span>
      <Param k="autoGuides" engine={engine} help={false} />
      <div className="brush-row">
        <button type="button" className={`btn chamfer-s${drawing ? ' btn-dark' : ''}`} aria-pressed={drawing} onClick={() => setTool(drawing ? null : { kind: 'draw' })}>
          {drawing ? 'Terminar' : 'Dibujar línea'}
        </button>
        <button type="button" className="link" onClick={engine.clearGuides} disabled={!engine.guides.length}>
          Borrar líneas{engine.guides.length ? ` (${engine.guides.length})` : ''}
        </button>
      </div>
      {drawing && <span className="help">Dibuja sobre la foto; cada trazo es una línea. Al soltar se recalcula.</span>}
    </div>
  );
}

function Controls({ step, engine, brush, setBrush }) {
  return step.simple.map((c, i) => {
    if (c.macro) return <Macro key={i} id={c.macro} engine={engine} />;
    if (c.param) return <Param key={i} k={c.param} engine={engine} />;
    if (c.kind === 'algorithm') return <AlgorithmPicker key={i} engine={engine} />;
    if (c.kind === 'brush') return <BrushTools key={i} engine={engine} brush={brush?.kind === 'brush' ? brush : null} setBrush={(b) => setBrush(b && { ...b, kind: 'brush' })} />;
    if (c.kind === 'rows') return <RowTools key={i} engine={engine} tool={brush} setTool={setBrush} />;
    if (c.kind === 'reseed') {
      return (
        <button key={i} type="button" className="btn chamfer-s reseed" onClick={() => engine.setParam('seed', (engine.params.seed % 999) + 1)}>
          Otra versión ↻
        </button>
      );
    }
    return null;
  });
}

function Section({ step, index, engine, open, onOpen, peek, onPeek, brush, setBrush }) {
  const algo = engine.params.algorithm;
  const text = step.id === 'trozos' ? ALGORITHM_INFO[algo].explanation : step.explanation;
  const formula = step.id === 'trozos' ? ALGORITHM_INFO[algo].formula : step.formula;
  const summary = step.id === 'trozos' ? ALGORITHMS.find((a) => a.value === algo).label : step.summary?.(engine.params);
  const advanced = step.advanced.filter((k) => isVisible(PARAM[k], engine.params));
  const canPeek = step.views.length > 0;
  return (
    <section className={`section chamfer${open ? ' open' : ''}`}>
      <div className="section-head">
        <button type="button" className="section-title" aria-expanded={open} onClick={onOpen}>
          <span className="section-num">{index + 1}</span>
          <span>
            <b>{step.title}</b>
            {!open && summary && <small>{summary}</small>}
          </span>
        </button>
        {canPeek && (
          <button type="button" className={`peek${peek ? ' on' : ''}`} aria-pressed={peek} onClick={onPeek}>
            {peek ? 'Ver el mosaico' : 'Ver este paso'}
          </button>
        )}
      </div>
      {open && (
        <div className="section-body">
          <details className="what">
            <summary>¿Qué hace?</summary>
            <p className="explain">{text}</p>
            {formula && <pre className="formula-pre">{formula}</pre>}
          </details>
          <div className="fields">
            <Controls step={step} engine={engine} brush={brush} setBrush={setBrush} />
          </div>
          {advanced.length > 0 && (
            <details className="more">
              <summary>Más ajustes</summary>
              <div className="fields">
                {advanced.map((k) => <Param key={k} k={k} engine={engine} />)}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

export default function Panel({ engine, open, setOpen, peek, setPeek, brush, setBrush }) {
  return (
    <aside className="side">
      {STEPS.map((step, i) => (
        <Section
          key={step.id}
          step={step}
          index={i}
          engine={engine}
          open={open === step.id}
          onOpen={() => { setOpen(open === step.id ? null : step.id); setBrush(null); }}
          peek={peek?.step === step.id}
          onPeek={() => setPeek(peek?.step === step.id ? null : { step: step.id, view: step.views[0].key })}
          brush={brush}
          setBrush={(b) => { setBrush(b); if (b) setPeek(null); }}
        />
      ))}
      <button type="button" className="btn btn-dark chamfer-s download" onClick={engine.download} disabled={!engine.mosaicReady}>
        Descargar PNG
      </button>
    </aside>
  );
}
