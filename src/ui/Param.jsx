import { applyMacro, readMacro } from '../core/macros.js';
import { PARAM } from '../core/params.js';
import { MACRO_INFO } from './steps.js';

const toPos = (q, v) => (q.log ? Math.log(v / q.min) / Math.log(q.max / q.min) : (v - q.min) / (q.max - q.min));
const fromPos = (q, t) => {
  const raw = q.log ? q.min * (q.max / q.min) ** t : q.min + t * (q.max - q.min);
  const snapped = Math.round(raw / q.step) * q.step;
  return Number(Math.min(q.max, Math.max(q.min, snapped)).toFixed(4));
};

function format(q, v) {
  const digits = q.step >= 1 ? 0 : q.step >= 0.1 ? 1 : q.step >= 0.01 ? 2 : 3;
  return `${Number(v).toFixed(digits).replace('.', ',')}${q.unit ?? ''}`;
}

const word = (t) => (t < 0.2 ? 'muy bajo' : t < 0.4 ? 'bajo' : t < 0.6 ? 'medio' : t < 0.8 ? 'alto' : 'muy alto');

// A range input that tells the engine when a drag starts and ends, so the
// worker can compute a half-size preview while the thumb moves.
function Range({ id, value, onChange, engine }) {
  return (
    <input
      id={id}
      type="range"
      min={0}
      max={1000}
      value={Math.round(value * 1000)}
      onPointerDown={engine.beginDrag}
      onPointerCancel={engine.endDrag}
      onChange={(e) => onChange(e.target.value / 1000)}
    />
  );
}

export function Param({ k, engine, help = true }) {
  const q = PARAM[k];
  const value = engine.params[k];
  const set = (v) => engine.setParam(k, v);
  const id = `p-${k}`;
  const helpLine = help && q.help ? <span className="help">{q.help}</span> : null;
  if (q.type === 'select') {
    return (
      <div className="field">
        <label className="field-row" htmlFor={id}><span>{q.label}</span></label>
        <select id={id} value={value} onChange={(e) => set(e.target.value)}>
          {q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {helpLine}
      </div>
    );
  }
  if (q.type === 'checkbox') {
    return (
      <div className="field">
        <label className="field-check" htmlFor={id}>
          <input id={id} type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
          <span>{q.label}</span>
        </label>
        {helpLine}
      </div>
    );
  }
  if (q.type === 'color') {
    return (
      <div className="field">
        <label className="field-row" htmlFor={id}>
          <span>{q.label}</span>
          <input id={id} type="color" value={value} onChange={(e) => set(e.target.value)} />
        </label>
      </div>
    );
  }
  return (
    <div className="field">
      <label className="field-row" htmlFor={id}><span>{q.label}</span><output>{format(q, value)}</output></label>
      <Range id={id} value={toPos(q, value)} onChange={(t) => set(fromPos(q, t))} engine={engine} />
      {helpLine}
    </div>
  );
}

export function Macro({ id, engine, help = true }) {
  const t = readMacro(engine.params, id);
  const info = MACRO_INFO[id];
  const fid = `m-${id}`;
  return (
    <div className="field">
      <label className="field-row" htmlFor={fid}><span>{info.label}</span><output>{t === null ? 'personalizado' : word(t)}</output></label>
      <Range id={fid} value={t ?? 0.5} onChange={(v) => engine.setParams((p) => applyMacro(p, id, v))} engine={engine} />
      {help && <span className="help">{info.help}</span>}
    </div>
  );
}
