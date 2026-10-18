// Simple-mode sliders. Each macro maps one value in [0, 1] onto several real
// parameters; readMacro inverts that, returning null ("personalizado") when
// the parameters were edited by hand and no single value explains them.

const lin = (key, a, b) => ({ key, map: (t) => a + b * t, inv: (v) => (v - a) / b });
const exp10 = (key, a, b) => ({ key, map: (t) => 10 ** (a + b * t), inv: (v) => (Math.log10(v) - a) / b });

const FIDELITY_BY_ALGORITHM = {
  fracture: [lin('edgeAlign', 0, 0.8), lin('angleNoise', 60, -50), exp10('temperature', 0.3, -2.3)],
  hybrid: [lin('edgeAlign', 0, 0.8), lin('angleNoise', 60, -50), exp10('temperature', 0.3, -2.3)],
  slic: [lin('compactness', 40, -34)],
  'voronoi-aniso': [lin('anisotropy', 0, 5)],
  cracks: [lin('crackFollow', 0, 0.8), lin('crackAngleNoise', 30, -26)],
  voronoi: [],
};

// The first term of each macro is the one readMacro inverts.
const TERMS = {
  size: () => [lin('sMin', 4, 7.5), lin('sMax', 16, 50)],
  fidelity: (p) => FIDELITY_BY_ALGORITHM[p.algorithm] ?? [],
  gloss: () => [lin('specular', 0, 1.2), lin('tilt', 0.02, 0.28), exp10('shininess', 1.2, 1)],
};

export const MACROS = Object.keys(TERMS);

// The parameters a macro sets for the current algorithm.
export const macroKeys = (id, params) => TERMS[id](params).map((t) => t.key);

export const MACRO_DEFAULTS = { size: 0.4, fidelity: 0.75, gloss: 0.45 };

export function applyMacro(params, id, value) {
  const next = { ...params };
  for (const term of TERMS[id](params)) next[term.key] = term.map(value);
  return next;
}

export function readMacro(params, id) {
  const terms = TERMS[id](params);
  if (!terms.length) return null;
  const [first, ...rest] = terms;
  const t = first.inv(params[first.key]);
  if (!Number.isFinite(t) || t < -1e-6 || t > 1 + 1e-6) return null;
  for (const term of rest) {
    const want = term.map(t), have = params[term.key];
    if (Math.abs(want - have) > 1e-3 * Math.max(1, Math.abs(want))) return null;
  }
  return Math.min(1, Math.max(0, t));
}

export const applyMacroDefaults = (params) =>
  MACROS.reduce((p, id) => applyMacro(p, id, MACRO_DEFAULTS[id]), params);

const PLAIN_COLOR = { palette: 'none', colorMode: 'mean', saturation: 1.15 };

export const STYLES = [
  { id: 'rectos', label: 'Cortes rectos', params: { algorithm: 'fracture', ...PLAIN_COLOR } },
  { id: 'taller', label: 'Azulejos de taller', params: { algorithm: 'fracture', palette: 'gaudi', paletteMix: 0.85, colorMode: 'vivid', saturation: 1.25 } },
  { id: 'grietas', label: 'Grietas', params: { algorithm: 'cracks', ...PLAIN_COLOR } },
  { id: 'teselas', label: 'Teselas redondeadas', params: { algorithm: 'voronoi', ...PLAIN_COLOR } },
];

// Switching style changes the algorithm, so the fidelity macro is re-applied
// to keep "Parecido a la foto" meaning the same thing.
export function applyStyle(params, id) {
  const style = STYLES.find((s) => s.id === id);
  const f = readMacro(params, 'fidelity');
  const next = { ...params, ...style.params };
  return f === null ? next : applyMacro(next, 'fidelity', f);
}

export function readStyle(params) {
  const style = STYLES.find((s) => Object.entries(s.params).every(([k, v]) => params[k] === v));
  return style ? style.id : null;
}
