// Parameter schema. The UI is generated from it and the worker uses `stage`
// to know which cached results a change invalidates.
//   stage: analysis < tessellation < color < render

export const ALGORITHMS = [
  { value: 'fracture', label: 'Fractura recursiva' },
  { value: 'hybrid', label: 'Híbrido: Voronoi + cortes' },
  { value: 'voronoi', label: 'Voronoi centroidal' },
  { value: 'voronoi-aniso', label: 'Voronoi anisótropo' },
  { value: 'slic', label: 'Superpíxeles SLIC' },
  { value: 'cracks', label: 'Grietas (Substrate)' },
];

const any = () => true;
const algo = (...names) => (p) => names.includes(p.algorithm);

export const GROUPS = [
  {
    id: 'analysis',
    title: 'Foto y detalle',
    hint: 'Cómo se mide el detalle y qué tamaño de trozo pide cada zona.',
    params: [
      { key: 'workLong', label: 'Resolución de trabajo', min: 300, max: 1400, step: 50, def: 800, unit: 'px', stage: 'analysis' },
      { key: 'sMin', label: 'Trozo mínimo', min: 3, max: 40, step: 0.5, def: 7, unit: 'px', stage: 'analysis' },
      { key: 'sMax', label: 'Trozo máximo', min: 8, max: 140, step: 1, def: 36, unit: 'px', stage: 'analysis' },
      { key: 'gamma', label: 'Sensibilidad al detalle (γ)', min: 0.15, max: 3, step: 0.05, def: 0.7, stage: 'analysis' },
      { key: 'detailSigma', label: 'Escala del detalle (σ)', min: 0.5, max: 8, step: 0.1, def: 2, stage: 'analysis' },
      { key: 'detailSmooth', label: 'Suavizado del mapa', min: 0.5, max: 20, step: 0.5, def: 5, stage: 'analysis' },
      { key: 'tensorSigma', label: 'Escala de orientación', min: 1, max: 16, step: 0.5, def: 4, stage: 'analysis' },
    ],
  },
  {
    id: 'algorithm',
    title: 'Teselación',
    hint: 'Cómo se rompe la imagen en trozos.',
    params: [
      { key: 'algorithm', label: 'Algoritmo', type: 'select', options: ALGORITHMS, def: 'fracture', stage: 'tessellation' },
      { key: 'seed', label: 'Semilla aleatoria', min: 1, max: 999, step: 1, def: 7, stage: 'tessellation' },
      // Seeds
      { key: 'spacing', label: 'Separación de semillas', min: 0.4, max: 2.5, step: 0.05, def: 1, stage: 'tessellation', show: algo('voronoi', 'voronoi-aniso', 'hybrid', 'slic') },
      { key: 'lloydIters', label: 'Iteraciones de Lloyd', min: 0, max: 20, step: 1, def: 3, stage: 'tessellation', show: algo('voronoi', 'voronoi-aniso', 'hybrid') },
      { key: 'lloydWeighted', label: 'Lloyd ponderado por detalle', type: 'checkbox', def: true, stage: 'tessellation', show: algo('voronoi', 'voronoi-aniso', 'hybrid') },
      { key: 'anisotropy', label: 'Anisotropía', min: 0, max: 8, step: 0.1, def: 2.5, stage: 'tessellation', show: algo('voronoi-aniso') },
      // Fracture
      { key: 'kappa', label: 'Área por trozo (κ)', min: 0.3, max: 3, step: 0.05, def: 1, stage: 'tessellation', show: algo('fracture') },
      { key: 'temperature', label: 'Temperatura', min: 0.001, max: 3, step: 0.001, def: 0.08, log: true, stage: 'tessellation', show: algo('fracture', 'hybrid') },
      { key: 'candidates', label: 'Cortes candidatos', min: 1, max: 48, step: 1, def: 14, stage: 'tessellation', show: algo('fracture', 'hybrid') },
      { key: 'edgeAlign', label: 'Seguir contornos', min: 0, max: 1, step: 0.01, def: 0.5, stage: 'tessellation', show: algo('fracture', 'hybrid') },
      { key: 'cutJitter', label: 'Descentrado del corte', min: 0, max: 0.5, step: 0.01, def: 0.22, stage: 'tessellation', show: algo('fracture', 'hybrid') },
      { key: 'angleNoise', label: 'Ruido de ángulo', min: 0, max: 90, step: 1, def: 25, unit: '°', stage: 'tessellation', show: algo('fracture', 'hybrid') },
      { key: 'sliver', label: 'Castigo a astillas (λ)', min: 0, max: 3, step: 0.05, def: 0.8, stage: 'tessellation', show: algo('fracture', 'hybrid') },
      // Hybrid
      { key: 'hybridSpacing', label: 'Tamaño de celda base', min: 1, max: 4, step: 0.1, def: 1.8, stage: 'tessellation', show: algo('hybrid') },
      { key: 'hybridCuts', label: 'Cortes por celda', min: 0, max: 4, step: 1, def: 2, stage: 'tessellation', show: algo('hybrid') },
      { key: 'hybridCutProb', label: 'Probabilidad de cada corte', min: 0, max: 1, step: 0.01, def: 0.7, stage: 'tessellation', show: algo('hybrid') },
      // SLIC
      { key: 'compactness', label: 'Compacidad (m)', min: 1, max: 60, step: 0.5, def: 12, stage: 'tessellation', show: algo('slic') },
      { key: 'slicIters', label: 'Iteraciones', min: 1, max: 20, step: 1, def: 8, stage: 'tessellation', show: algo('slic') },
      // Cracks
      { key: 'crackDensity', label: 'Densidad de grietas', min: 0.2, max: 3, step: 0.05, def: 1.1, stage: 'tessellation', show: algo('cracks') },
      { key: 'crackActive', label: 'Grietas simultáneas', min: 1, max: 64, step: 1, def: 10, stage: 'tessellation', show: algo('cracks') },
      { key: 'crackAngleNoise', label: 'Ruido de ángulo', min: 0, max: 45, step: 1, def: 8, unit: '°', stage: 'tessellation', show: algo('cracks') },
      { key: 'crackCurl', label: 'Curvatura', min: 0, max: 0.15, step: 0.002, def: 0.015, stage: 'tessellation', show: algo('cracks') },
      { key: 'crackFollow', label: 'Seguir contornos', min: 0, max: 1, step: 0.01, def: 0.4, stage: 'tessellation', show: algo('cracks') },
      // Shared by raster-based methods
      { key: 'simplify', label: 'Rectitud de aristas', min: 0, max: 5, step: 0.1, def: 1.4, unit: 'px', stage: 'tessellation', show: algo('voronoi-aniso', 'slic', 'cracks') },
    ],
  },
  {
    id: 'color',
    title: 'Color',
    hint: 'Qué color recibe cada trozo.',
    params: [
      {
        key: 'colorMode', label: 'Estadístico', type: 'select', def: 'mean', stage: 'color',
        options: [
          { value: 'mean', label: 'Media' },
          { value: 'median', label: 'Mediana' },
          { value: 'dominant', label: 'Dominante (moda)' },
          { value: 'vivid', label: 'Más saturado (30%)' },
          { value: 'center', label: 'Píxel central' },
        ],
      },
      { key: 'saturation', label: 'Saturación', min: 0, max: 2.5, step: 0.01, def: 1.15, stage: 'color' },
      { key: 'lightness', label: 'Luminosidad', min: -0.3, max: 0.3, step: 0.01, def: 0, stage: 'color' },
      {
        key: 'palette', label: 'Paleta', type: 'select', def: 'none', stage: 'color',
        options: [
          { value: 'none', label: 'Sin paleta' },
          { value: 'kmeans', label: 'K colores de la foto' },
          { value: 'gaudi', label: 'Azulejos de taller' },
        ],
      },
      { key: 'paletteK', label: 'Colores (K)', min: 2, max: 48, step: 1, def: 14, stage: 'color', show: (p) => p.palette === 'kmeans' },
      { key: 'paletteMix', label: 'Fuerza de la paleta', min: 0, max: 1, step: 0.01, def: 1, stage: 'color', show: (p) => p.palette !== 'none' },
      { key: 'colorJitter', label: 'Variación entre trozos', min: 0, max: 0.15, step: 0.002, def: 0.025, stage: 'color' },
    ],
  },
  {
    id: 'render',
    title: 'Junta y vidriado',
    hint: 'Mortero, relieve y reflejos de la cerámica.',
    params: [
      { key: 'grout', label: 'Ancho de junta', min: 0, max: 6, step: 0.1, def: 1.3, unit: 'px', stage: 'render' },
      { key: 'groutColor', label: 'Color del mortero', type: 'color', def: '#d9d5cb', stage: 'render' },
      { key: 'groutShadow', label: 'Sombra en la junta', min: 0, max: 1, step: 0.01, def: 0.45, stage: 'render' },
      { key: 'bevel', label: 'Ancho del bisel', min: 0, max: 6, step: 0.1, def: 1.4, unit: 'px', stage: 'render' },
      { key: 'bevelStrength', label: 'Fuerza del bisel', min: 0, max: 2.5, step: 0.05, def: 0.9, stage: 'render' },
      { key: 'tilt', label: 'Inclinación de cada trozo', min: 0, max: 0.6, step: 0.01, def: 0.16, stage: 'render' },
      { key: 'lightAz', label: 'Dirección de la luz', min: 0, max: 360, step: 1, def: 135, unit: '°', stage: 'render' },
      { key: 'lightEl', label: 'Altura de la luz', min: 10, max: 90, step: 1, def: 50, unit: '°', stage: 'render' },
      { key: 'ambient', label: 'Luz ambiente', min: 0, max: 1, step: 0.01, def: 0.45, stage: 'render' },
      { key: 'specular', label: 'Brillo', min: 0, max: 2, step: 0.01, def: 0.55, stage: 'render' },
      { key: 'shininess', label: 'Dureza del brillo', min: 4, max: 300, step: 1, def: 70, log: true, stage: 'render' },
      { key: 'glazeNoise', label: 'Textura del esmalte', min: 0, max: 0.2, step: 0.005, def: 0.03, stage: 'render' },
      { key: 'outLong', label: 'Tamaño de salida', min: 600, max: 3200, step: 100, def: 1400, unit: 'px', stage: 'render' },
      { key: 'supersample', label: 'Antialiasing', min: 1, max: 3, step: 1, def: 2, unit: '×', stage: 'render' },
    ],
  },
];

export const ALL_PARAMS = GROUPS.flatMap((g) => g.params);
export const DEFAULTS = Object.fromEntries(ALL_PARAMS.map((q) => [q.key, q.def]));
export const isVisible = (q, p) => (q.show ?? any)(p);

export const STAGE_ORDER = ['analysis', 'tessellation', 'color', 'render'];
export const keysForStage = (stage) => ALL_PARAMS.filter((q) => q.stage === stage).map((q) => q.key);

export const PRESETS = [
  { id: 'faithful', label: 'Reconocible', params: { algorithm: 'fracture', temperature: 0.02, edgeAlign: 0.7, sMin: 5, sMax: 28, gamma: 0.6, palette: 'none', colorMode: 'mean' } },
  { id: 'gaudi', label: 'Park Güell', params: { algorithm: 'fracture', temperature: 0.12, edgeAlign: 0.45, sMin: 8, sMax: 44, gamma: 0.8, palette: 'gaudi', paletteMix: 0.85, colorMode: 'vivid', saturation: 1.25, specular: 0.8 } },
  { id: 'abstract', label: 'Abstracto', params: { algorithm: 'fracture', temperature: 1.5, edgeAlign: 0.1, sMin: 14, sMax: 70, gamma: 1.4, palette: 'kmeans', paletteK: 7, colorMode: 'dominant' } },
  { id: 'cracked', label: 'Grietas', params: { algorithm: 'cracks', crackDensity: 1.2, crackFollow: 0.5, sMin: 6, sMax: 40, palette: 'none' } },
];
