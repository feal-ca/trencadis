import { useState } from 'react';
import { macroKeys } from '../core/macros.js';
import { ALGORITHMS, isVisible, PARAM } from '../core/params.js';
import { InfoTip, Macro, Param } from './Param.jsx';
import { ALGORITHM_INFO, ROW_PARAMS, STEPS } from './steps.js';

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
      <div className="field-row">
        <span>Pincel de detalle</span>
        <InfoTip label="Pincel de detalle" text="Pinta sobre la foto para quitar detalle de zonas que no te interesan (se cubren con trozos grandes) o para añadirlo donde quieras trozos pequeños. Al soltar se recalcula." />
      </div>
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
    </div>
  );
}

function RowTools({ engine, tool, setTool, showLines }) {
  const drawing = tool?.kind === 'draw';
  const mode = tool?.mode ?? 'free';
  const snap = tool?.snap ?? true;
  const set = (patch) => setTool({ kind: 'draw', mode, snap, ...patch });
  return (
    <div className="field rows-block">
      <div className="field-row">
        <span className="rows-title">Hileras</span>
        <InfoTip label="Hileras" text="Piezas rectangulares en fila a lo largo de una línea, como la espiral negra de los bancos de Gaudí. Ayudan a que se lean contornos, barandillas o letras sin subir el detalle de toda la imagen." />
      </div>
      <Param k="autoGuides" engine={engine} />
      <div className="brush-row">
        <button type="button" className={`btn chamfer-s${drawing ? ' btn-dark' : ''}`} aria-pressed={drawing} onClick={() => setTool(drawing ? null : { kind: 'draw', mode, snap })}>
          {drawing ? 'Terminar' : 'Dibujar línea'}
        </button>
        <button type="button" className="link" onClick={showLines} disabled={!engine.lines.lines.length}>Ver las líneas</button>
        <button type="button" className="link" onClick={engine.clearGuides} disabled={!engine.guides.length}>
          Borrar mis líneas{engine.guides.length ? ` (${engine.guides.length})` : ''}
        </button>
      </div>
      {drawing && (
        <div className="draw-options">
          <div className="seg" role="group" aria-label="Forma de dibujar">
            <button type="button" className={mode === 'free' ? 'on' : ''} aria-pressed={mode === 'free'} onClick={() => set({ mode: 'free' })}>A mano</button>
            <button type="button" className={mode === 'points' ? 'on' : ''} aria-pressed={mode === 'points'} onClick={() => set({ mode: 'points' })}>Por puntos</button>
          </div>
          <label className="field-check">
            <input type="checkbox" checked={snap} onChange={(e) => set({ snap: e.target.checked })} />
            <span>Pegar al contorno</span>
            <InfoTip label="Pegar al contorno" text="Al terminar, la línea se acerca al borde más marcado de la foto que tenga cerca: basta con pasar cerca del contorno." />
          </label>
          <span className="help">
            {mode === 'free'
              ? 'Arrastra sobre la foto. El temblor del ratón se suaviza.'
              : 'Haz clic en cada vértice; doble clic o Intro para terminar, Retroceso quita el último punto y Esc cancela.'}
            {' '}En azul, las líneas que salen de los contornos de la foto; si acabas cerca de una, tu línea se une a ella.
          </span>
        </div>
      )}
      <details className="more">
        <summary>Ajustes de las hileras</summary>
        <div className="fields">
          {ROW_PARAMS.map((k) => <Param key={k} k={k} engine={engine} />)}
        </div>
      </details>
    </div>
  );
}

function Controls({ step, engine, brush, setBrush, showLines }) {
  return step.simple.map((c, i) => {
    if (c.macro) return <Macro key={i} id={c.macro} engine={engine} />;
    if (c.param) return <Param key={i} k={c.param} engine={engine} />;
    if (c.kind === 'algorithm') return <AlgorithmPicker key={i} engine={engine} />;
    if (c.kind === 'brush') return <BrushTools key={i} engine={engine} brush={brush?.kind === 'brush' ? brush : null} setBrush={(b) => setBrush(b && { ...b, kind: 'brush' })} />;
    if (c.kind === 'rows') return <RowTools key={i} engine={engine} tool={brush} setTool={setBrush} showLines={showLines} />;
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

function Section({ step, index, engine, open, onOpen, peek, onPeek, brush, setBrush, showLines }) {
  const algo = engine.params.algorithm;
  const text = step.id === 'trozos' ? ALGORITHM_INFO[algo].explanation : step.explanation;
  const formula = step.id === 'trozos' ? ALGORITHM_INFO[algo].formula : step.formula;
  const summary = step.id === 'trozos' ? ALGORITHMS.find((a) => a.value === algo).label : step.summary?.(engine.params);
  // Parameters a simple control on screen already moves only appear through
  // its "Ajustar a mano"; the CPU antialiasing only matters without a GPU.
  const covered = new Set(step.simple.filter((c) => c.macro).flatMap((c) => macroKeys(c.macro, engine.params)));
  const advanced = step.advanced.filter((k) => isVisible(PARAM[k], engine.params) && !covered.has(k) && !(k === 'supersample' && engine.gpu));
  const canPeek = step.views.length > 0;
  return (
    <section className={`section${open ? ' open' : ''}`}>
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
            <Controls step={step} engine={engine} brush={brush} setBrush={setBrush} showLines={showLines} />
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
          showLines={() => { setBrush(null); setPeek({ step: 'trozos', view: 'structure' }); }}
        />
      ))}
      <button type="button" className="btn btn-dark chamfer-s download" onClick={engine.download} disabled={!engine.mosaicReady}>
        Descargar PNG
      </button>
    </aside>
  );
}
