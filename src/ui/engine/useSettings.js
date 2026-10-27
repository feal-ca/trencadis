import { useEffect, useMemo, useRef, useState } from 'react';
import { applyMacro, applyMacroDefaults, applyStyle, MACRO_DEFAULTS, MACROS, readStyle } from '../../core/macros.js';
import { DEFAULTS } from '../../core/params.js';

const STORE = 'trencadis.params.v2';
const MACRO_STORE = 'trencadis.macros.v1';

// Simple controls: their values, and which ones are set by hand instead.
function loadMacros() {
  try {
    const saved = JSON.parse(localStorage.getItem(MACRO_STORE) || 'null');
    if (saved) return { values: { ...MACRO_DEFAULTS, ...saved.values }, manual: saved.manual ?? {} };
  } catch { /* storage unavailable */ }
  return { values: { ...MACRO_DEFAULTS }, manual: {} };
}

function loadParams() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved) return { ...applyMacroDefaults(DEFAULTS), ...saved };
  } catch { /* storage unavailable */ }
  return applyMacroDefaults(DEFAULTS);
}

// The parameters, the simple controls over them, and their persistence.
// The zones are part of what a style or a reset replaces, but they belong to
// useZones: the caller adds them to what these return.
export function useSettings() {
  const [macros, setMacros] = useState(loadMacros);
  // Simple controls not in hand mode decide their parameters from the start.
  const [params, setParams] = useState(() => MACROS.reduce(
    (p, id) => (macros.manual[id] ? p : applyMacro(p, id, macros.values[id])), loadParams()));
  const macrosRef = useRef(macros);
  macrosRef.current = macros;
  useEffect(() => {
    try { localStorage.setItem(MACRO_STORE, JSON.stringify(macros)); } catch { /* ignore */ }
  }, [macros]);
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(params)); } catch { /* ignore */ }
  }, [params]);
  // The grout colour 'auto' depends on the photo; everything downstream gets
  // `effective`, with it resolved to a real colour.
  const [autoGrout, setAutoGrout] = useState('#3a3631');
  const effective = useMemo(
    () => (params.groutColor === 'auto' ? { ...params, groutColor: autoGrout } : params),
    [params, autoGrout],
  );
  const rawParams = useRef(params);
  rawParams.current = params;

  return {
    params, setParams, macros, effective, autoGrout, setAutoGrout,
    setParam: (key, value) => setParams((p) => {
      let next = { ...p, [key]: value };
      if (key === 'sMin' && value > next.sMax) next.sMax = value;
      if (key === 'sMax' && value < next.sMin) next.sMin = value;
      // A new method gets the same "Parecido a la foto" in its own terms.
      const m = macrosRef.current;
      if (key === 'algorithm' && !m.manual.fidelity) next = applyMacro(next, 'fidelity', m.values.fidelity);
      // The size ratio is read by the size control, which then sets sMin.
      if (key === 'sizeRatio' && !m.manual.size) next = applyMacro(next, 'size', m.values.size);
      return next;
    }),
    style: readStyle(params, DEFAULTS),
    // A one-click look replaces every setting; returns what restore() needs to undo it.
    setStyle: (id) => {
      const before = { params: rawParams.current, macros: macrosRef.current };
      const next = applyStyle(DEFAULTS, id);
      setMacros(next.macros);
      setParams({ ...next.params, seed: rawParams.current.seed, outLong: rawParams.current.outLong });
      return before;
    },
    setMacro: (id, value) => {
      setMacros((m) => ({ ...m, values: { ...m.values, [id]: value } }));
      setParams((p) => applyMacro(p, id, value));
    },
    // Hand mode shows the underlying parameters; leaving it re-applies the macro.
    setManual: (id, on) => {
      setMacros((m) => ({ ...m, manual: { ...m.manual, [id]: on } }));
      if (!on) setParams((p) => applyMacro(p, id, macrosRef.current.values[id]));
    },
    // Every setting back to its default; returns what to pass to restore() to undo it.
    resetAll: () => {
      const before = { params: rawParams.current, macros: macrosRef.current };
      setMacros({ values: { ...MACRO_DEFAULTS }, manual: {} });
      setParams({ ...applyMacroDefaults(DEFAULTS), outLong: rawParams.current.outLong });
      return before;
    },
    restore: ({ params: p, macros: m }) => { setMacros(m); setParams(p); },
    isDefault: Object.entries(applyMacroDefaults(DEFAULTS)).every(([k, v]) => params[k] === v)
      && !Object.values(macros.manual).some(Boolean),
  };
}
