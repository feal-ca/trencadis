import { useId } from 'react';
import { macroKeys } from '../core/macros.js';
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

// An ⓘ next to a control's name; the explanation opens on hover, focus or tap.
export function InfoTip({ text, label }) {
  const id = useId();
  if (!text) return null;
  return (
    <span className="tip">
      <button type="button" className="tip-btn" aria-label={`Qué hace «${label}»`} aria-describedby={id}>i</button>
      <span role="tooltip" id={id} className="tip-text">{text}</span>
    </span>
  );
}

function Range({ id, value, onChange, disabled }) {
  return (
    <input id={id} type="range" min={0} max={1000} value={Math.round(value * 1000)} disabled={disabled}
      onChange={(e) => onChange(e.target.value / 1000)} />
  );
}

function Label({ htmlFor, label, help, children }) {
  return (
    <div className="field-row">
      <label htmlFor={htmlFor}>{label}</label>
      <InfoTip text={help} label={label} />
      <span className="field-value">{children}</span>
    </div>
  );
}

export function Param({ k, engine }) {
  const q = PARAM[k];
  const value = engine.params[k];
  const set = (v) => engine.setParam(k, v);
  const id = `p-${k}`;
  if (q.type === 'select') {
    return (
      <div className="field">
        <Label htmlFor={id} label={q.label} help={q.help} />
        <select id={id} value={value} onChange={(e) => set(e.target.value)}>
          {q.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    );
  }
  if (q.type === 'checkbox') {
    return (
      <div className="field field-inline">
        <input id={id} type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
        <Label htmlFor={id} label={q.label} help={q.help} />
      </div>
    );
  }
  if (q.type === 'color') {
    return (
      <div className="field">
        <Label htmlFor={id} label={q.label} help={q.help}>
          <input id={id} type="color" value={value} onChange={(e) => set(e.target.value)} />
        </Label>
      </div>
    );
  }
  return (
    <div className="field">
      <Label htmlFor={id} label={q.label} help={q.help}><output htmlFor={id}>{format(q, value)}</output></Label>
      <Range id={id} value={toPos(q, value)} onChange={(t) => set(fromPos(q, t))} />
    </div>
  );
}

// A simple control that moves several parameters at once. "Ajustar a mano"
// turns it off and shows those parameters instead, so the two never fight.
export function Macro({ id, engine }) {
  const info = MACRO_INFO[id];
  const keys = macroKeys(id, engine.params);
  if (!keys.length) return null;
  const manual = !!engine.macros.manual[id];
  const value = engine.macros.values[id];
  const fid = `m-${id}`;
  return (
    <div className={`field macro${manual ? ' is-manual' : ''}`}>
      <Label htmlFor={fid} label={info.label} help={info.help}>
        <output htmlFor={fid}>{manual ? 'a mano' : word(value)}</output>
      </Label>
      <Range id={fid} value={value} disabled={manual} onChange={(v) => engine.setMacro(id, v)} />
      <button type="button" className="link macro-switch" onClick={() => engine.setManual(id, !manual)}>
        {manual ? 'Volver al control simple' : 'Ajustar a mano'}
      </button>
      {manual && (
        <div className="macro-params">
          {keys.map((k) => <Param key={k} k={k} engine={engine} />)}
        </div>
      )}
    </div>
  );
}
