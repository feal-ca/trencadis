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
  // The size control sets the largest piece; the smallest follows from the
  // style's size ratio (a narrow range looks more like real trencadís).
  size: (p) => [lin('sMax', 16, 50), { key: 'sMin', map: (t) => Math.max(3, (16 + 50 * t) / (p.sizeRatio ?? 36 / 7)) }],
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

// One-click looks. Each is a full set of settings: the defaults, the style's
// own parameters, then its simple controls (so they stay simple, not "a mano").
export const STYLES = [
  { id: 'natural', label: 'Natural', params: {}, macros: {} },
  {
    id: 'parkguell', label: 'Park Güell',
    params: { algorithm: 'fracture', palette: 'gaudi', paletteMix: 0.5, saturation: 1.35, groutColor: '#ece8df', grout: 1.5, sizeRatio: 2.9 },
    macros: { size: 0.44, fidelity: 0.85, gloss: 0.75 },
  },
  {
    id: 'romano', label: 'Romano',
    params: { algorithm: 'voronoi', lloydIters: 10, sizeRatio: 2.8, saturation: 0.85, place: 0.55, grout: 1.1, groutColor: '#9a9286', rowScale: 0.9, rowLength: 1.1, colorJitter: 0.05 },
    macros: { size: 0, gloss: 0.05 },
  },
  {
    id: 'vitral', label: 'Vitral',
    params: { algorithm: 'voronoi-aniso', sizeRatio: 6.2, saturation: 1.6, lightness: 0.06, groutColor: '#141210', grout: 3.4, ambient: 0.75, bevel: 0.6, glazeNoise: 0.06, place: 0.1 },
    macros: { size: 0.8, gloss: 0.15 },
  },
];

// The parameters and simple-control values of a style, from `defaults`.
export function applyStyle(defaults, id) {
  const style = STYLES.find((s) => s.id === id);
  const values = { ...MACRO_DEFAULTS, ...style.macros };
  const params = MACROS.reduce((p, m) => applyMacro(p, m, values[m]), { ...defaults, ...style.params });
  return { params, macros: { values, manual: {} } };
}

// The style whose settings these are, or null once anything but the seed
// ("Otra versión") was changed.
export function readStyle(params, defaults) {
  const style = STYLES.find((s) => {
    const want = applyStyle(defaults, s.id).params;
    return Object.keys(want).every((k) => k === 'seed' || (typeof want[k] === 'number' ? Math.abs(want[k] - params[k]) < 1e-9 : want[k] === params[k]));
  });
  return style ? style.id : null;
}
