import { GROUPS, isVisible, PRESETS } from '../core/params.js';

const toPos = (q, v) => (q.log ? Math.log(v / q.min) / Math.log(q.max / q.min) : (v - q.min) / (q.max - q.min));
const fromPos = (q, t) => {
  const raw = q.log ? q.min * (q.max / q.min) ** t : q.min + t * (q.max - q.min);
  const snapped = Math.round(raw / q.step) * q.step;
  return Number(Math.min(q.max, Math.max(q.min, snapped)).toFixed(4));
};

function format(q, v) {
  const digits = q.step >= 1 ? 0 : q.step >= 0.1 ? 1 : q.step >= 0.01 ? 2 : 3;
  return `${Number(v).toFixed(digits)}${q.unit ?? ''}`;
}

function Field({ q, value, onChange }) {
  const id = `f-${q.key}`;
  if (q.type === 'select') {
    return (
      <label className="field" htmlFor={id}>
        <span className="field-label">{q.label}</span>
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {q.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    );
  }
  if (q.type === 'checkbox') {
    return (
      <label className="field field-check" htmlFor={id}>
        <input id={id} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
        <span className="field-label">{q.label}</span>
      </label>
    );
  }
  if (q.type === 'color') {
    return (
      <label className="field field-color" htmlFor={id}>
        <span className="field-label">{q.label}</span>
        <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">
        {q.label}
        <output>{format(q, value)}</output>
      </span>
      <input
        id={id}
        type="range"
        min={0}
        max={1000}
        value={Math.round(toPos(q, value) * 1000)}
        onChange={(e) => onChange(fromPos(q, e.target.value / 1000))}
      />
    </label>
  );
}

export default function Controls({ params, setParam, applyPreset, reset }) {
  return (
    <div className="controls">
      <div className="presets" role="group" aria-label="Estilos rápidos">
        {PRESETS.map((pr) => (
          <button key={pr.id} type="button" className="chip" onClick={() => applyPreset(pr.params)}>
            {pr.label}
          </button>
        ))}
        <button type="button" className="chip chip-quiet" onClick={reset}>Restablecer</button>
      </div>
      {GROUPS.map((g) => (
        <details key={g.id} className="group" open={g.id === 'algorithm' || g.id === 'analysis'}>
          <summary>
            <span className="group-title">{g.title}</span>
            <span className="group-hint">{g.hint}</span>
          </summary>
          <div className="group-body">
            {g.params.filter((q) => isVisible(q, params)).map((q) => (
              <Field key={q.key} q={q} value={params[q.key]} onChange={(v) => setParam(q.key, v)} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
