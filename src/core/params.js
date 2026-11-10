// Parameter schema. The UI is generated from it and the worker uses `stage`
// to know which cached results a change invalidates.
//   stage: analysis < tessellation < color < render
// `help` is the one line shown under each control.

export const ALGORITHMS = [
  { value: 'trencadis', label: 'Trencadís' },
  { value: 'vitral', label: 'Vitral' },
  { value: 'romano', label: 'Romano' },
  { value: 'cracks', label: 'Grietas' },
];

const any = () => true;
const algo = (...names) => (p) => names.includes(p.algorithm);

export const GROUPS = [
  {
    id: 'analysis',
    params: [
      { key: 'workLong', label: 'Resolución de trabajo', min: 300, max: 1400, step: 20, def: 640, unit: ' px', stage: 'analysis',
        help: 'Más alto: bordes más precisos y cálculo más lento; más bajo: más rápido y más tosco. No cambia el tamaño de los trozos.' },
      // Fixed settings of the edge maps the cracks follow (analysis.js).
      { key: 'detailSigma', hidden: true, def: 2, unit: ' px', stage: 'analysis' },
      { key: 'detailSmooth', hidden: true, def: 5, unit: ' px', stage: 'analysis' },
      { key: 'tensorSigma', hidden: true, def: 4, unit: ' px', stage: 'analysis' },
      { key: 'ignoreTexture', hidden: true, def: 0, stage: 'analysis' },
    ],
  },
  {
    id: 'tessellation',
    params: [
      { key: 'algorithm', label: 'Método', type: 'select', options: ALGORITHMS, def: 'trencadis', stage: 'tessellation' },
      { key: 'contours', label: 'Contornos', min: 3, max: 16, step: 0.5, def: 8, stage: 'tessellation',
        help: 'Cuánto tienen que diferenciarse dos zonas de la foto para que una junta las separe. Más bajo: más contornos; más alto: solo las formas principales.' },
      { key: 'pieceCuts', label: 'Trozos partidos', min: 0, max: 1, step: 0.01, def: 0.5, stage: 'tessellation', show: algo('trencadis'),
        help: 'Cuántas piezas reciben un corte recto de más. Más alto: más triángulos y cuadriláteros, como azulejo roto; 0: piezas redondeadas.' },
      { key: 'seed', hidden: true, label: 'Semilla', min: 1, max: 999, step: 1, def: 7, stage: 'tessellation',
        help: 'Cambia el azar: misma configuración, otra versión del mosaico.' },
      { key: 'sMin', label: 'Trozo mínimo', min: 3, max: 40, step: 0.5, def: 7, unit: ' px', stage: 'tessellation',
        help: 'Tamaño de los trozos en las zonas con más detalle. Más alto: los detalles finos se pierden.' },
      { key: 'sMax', label: 'Trozo máximo', min: 8, max: 140, step: 1, def: 36, unit: ' px', stage: 'tessellation',
        help: 'Tamaño de los trozos en las zonas lisas. Más alto: fondos con pocas piezas grandes.' },
      // Read by the size control: sMin = sMax / sizeRatio.
      { key: 'sizeRatio', label: 'Variedad de tamaños', min: 1.5, max: 8, step: 0.1, def: 36 / 7, unit: '×', stage: 'tessellation',
        help: 'Cuántas veces es mayor el trozo más grande que el más pequeño. Más bajo: trozos parecidos, como el trencadís de verdad, y el detalle se ve por el color; más alto: trozos finos en el detalle.' },
      // Cracks
      { key: 'crackDensity', hidden: true, label: 'Densidad de grietas', min: 0.2, max: 3, step: 0.05, def: 1.1, stage: 'tessellation', show: algo('cracks'),
        help: 'Más alto: más grietas y trozos más pequeños.' },
      { key: 'crackActive', hidden: true, label: 'Grietas a la vez', min: 1, max: 64, step: 1, def: 10, stage: 'tessellation', show: algo('cracks'),
        help: 'Cuántas crecen simultáneamente. Más alto: grietas más cortas y repartidas.' },
      { key: 'crackAngleNoise', label: 'Ruido de ángulo', min: 0, max: 45, step: 1, def: 8, unit: '°', stage: 'tessellation', show: algo('cracks'),
        help: 'Más alto: direcciones de grieta más variadas.' },
      { key: 'crackCurl', label: 'Curvatura', min: 0, max: 0.15, step: 0.002, def: 0.015, stage: 'tessellation', show: algo('cracks'),
        help: 'Más alto: grietas que serpentean; 0: rectas.' },
      { key: 'crackGap', label: 'Separación mínima', min: 0, max: 0.8, step: 0.01, def: 0.35, stage: 'tessellation', show: algo('cracks'),
        help: 'Una grieta no nace tan cerca de otra (en tamaños de trozo). Más alto: menos trozos finos.' },
      { key: 'crackFollow', label: 'Seguir los bordes', min: 0, max: 1, step: 0.01, def: 0.4, stage: 'tessellation', show: algo('cracks'),
        help: 'Más alto: las grietas se doblan para seguir los contornos de la foto.' },
      // Shared by raster-based methods
      { key: 'minWidth', label: 'Grosor mínimo', min: 0, max: 0.8, step: 0.01, def: 0.3, stage: 'tessellation', show: algo('cracks'),
        help: 'Los trozos más estrechos que esto (en tamaños de trozo) se unen a su vecino. 0: se dejan todos.' },
      { key: 'simplify', label: 'Rectitud de aristas', min: 0, max: 5, step: 0.1, def: 1.4, unit: ' px', stage: 'tessellation',
        help: 'Más alto: aristas rectas y trozos angulosos; 0: bordes pixelados.' },
    ],
  },
  {
    id: 'color',
    params: [
      {
        key: 'colorMode', label: 'Color de cada trozo', type: 'select', def: 'vivid', stage: 'color',
        options: [
          { value: 'mean', label: 'Media' },
          { value: 'vivid', label: 'Más vivo' },
          { value: 'dominant', label: 'El más frecuente' },
          { value: 'median', label: 'Mediana' },
          { value: 'center', label: 'El del centro' },
        ],
        help: 'Media: fiel pero apagado en los bordes; más vivo: media del 30 % más saturado.',
      },
      { key: 'saturation', label: 'Saturación', min: 0, max: 2.5, step: 0.01, def: 1.15, stage: 'color',
        help: 'Más alto: colores más intensos; 0: blanco y negro.' },
      { key: 'lightness', label: 'Luminosidad', min: -0.3, max: 0.3, step: 0.01, def: 0, stage: 'color',
        help: 'Más alto: todo más claro; más bajo: más oscuro.' },
      {
        key: 'palette', label: 'Paleta', type: 'select', def: 'none', stage: 'color',
        options: [
          { value: 'none', label: 'Ninguna' },
          { value: 'kmeans', label: 'Colores de la foto' },
          { value: 'gaudi', label: 'Azulejos de taller' },
        ],
        help: 'Ajusta cada trozo al color más parecido de un juego limitado, como azulejos reales.',
      },
      { key: 'paletteK', label: 'Número de colores', min: 2, max: 48, step: 1, def: 14, stage: 'color', show: (p) => p.palette === 'kmeans',
        help: 'Más bajo: pocos colores, aspecto más gráfico.' },
      { key: 'paletteMix', label: 'Fuerza de la paleta', min: 0, max: 1, step: 0.01, def: 1, stage: 'color', show: (p) => p.palette !== 'none',
        help: '1: solo colores de la paleta; más bajo: mezcla con el color original.' },
      { key: 'paletteDither', label: 'Degradados con la paleta', min: 0, max: 1, step: 0.01, def: 0.6, stage: 'color', show: (p) => p.palette !== 'none',
        help: 'Cada trozo pasa a sus vecinos la diferencia entre el color de la foto y el de la paleta, y los degradados de un cielo o una cara se hacen mezclando dos o tres colores. 0: cada trozo toma el color más cercano.' },
      { key: 'colorJitter', label: 'Variación entre trozos', min: 0, max: 0.15, step: 0.002, def: 0.025, stage: 'color',
        help: 'Más alto: trozos vecinos con tonos algo distintos, como azulejos de lotes diferentes.' },
    ],
  },
  {
    id: 'render',
    params: [
      { key: 'grout', label: 'Ancho de la junta', min: 0, max: 6, step: 0.1, def: 2, unit: ' px', stage: 'render',
        help: 'La junta más ancha, la de los trozos grandes. Más alto: más mortero; 0: sin junta.' },
      { key: 'groutRel', label: 'Junta según el trozo', min: 0.02, max: 0.4, step: 0.01, def: 0.11, stage: 'render',
        help: 'La junta de cada trozo en proporción a su tamaño, hasta el ancho de arriba: los trozos pequeños llevan juntas finas y el detalle no se llena de mortero.' },
      // 'auto' or a hex colour; 'auto' is resolved per photo (autoGroutColor).
      { key: 'groutColor', label: 'Mortero', type: 'grout', def: 'auto', stage: 'render',
        help: 'Automático: un gris más oscuro que la foto, para que los trozos destaquen. El cemento claro es el clásico, pero sobre fotos oscuras llena la imagen de líneas blancas.' },
      { key: 'groutShadow', label: 'Sombra en la junta', min: 0, max: 1, step: 0.01, def: 0.45, stage: 'render',
        help: 'Más alto: la junta parece más hundida.' },
      { key: 'bevel', label: 'Ancho del bisel', min: 0, max: 6, step: 0.1, def: 2, unit: ' px', stage: 'render',
        help: 'Zona del borde de cada trozo que se curva. Más alto: bordes más redondeados.' },
      { key: 'bevelStrength', label: 'Fuerza del bisel', min: 0, max: 2.5, step: 0.05, def: 1.1, stage: 'render',
        help: 'Más alto: los bordes captan más luz y sombra.' },
      { key: 'place', label: 'Colocación a mano', min: 0, max: 1, step: 0.01, def: 0.15, stage: 'render',
        help: 'Cada trozo gira y se mueve un poco, como si se hubiera puesto a mano. Rompe las líneas rectas que cruzan varios trozos.' },
      { key: 'tilt', label: 'Inclinación de los trozos', min: 0, max: 0.6, step: 0.01, def: 0.04, stage: 'render',
        help: 'Más alto: cada trozo refleja la luz de forma distinta; 0: superficie plana.' },
      { key: 'lightAz', label: 'Dirección de la luz', min: 0, max: 360, step: 1, def: 135, unit: '°', stage: 'render',
        help: 'De dónde viene la luz: 0° derecha, 90° arriba, 180° izquierda.' },
      { key: 'lightEl', label: 'Altura de la luz', min: 10, max: 90, step: 1, def: 50, unit: '°', stage: 'render',
        help: 'Más bajo: luz rasante y relieve marcado; 90°: luz desde arriba.' },
      { key: 'ambient', label: 'Luz ambiente', min: 0, max: 1, step: 0.01, def: 0.4, stage: 'render',
        help: 'Más alto: menos contraste entre trozos iluminados y en sombra.' },
      { key: 'specular', label: 'Brillo', min: 0, max: 2, step: 0.01, def: 0.5, stage: 'render',
        help: 'Intensidad del reflejo fino en el canto de cada trozo.' },
      { key: 'sheen', label: 'Reflejo suave', min: 0, max: 0.5, step: 0.01, def: 0.1, stage: 'render',
        help: 'Un reflejo amplio y tenue en los trozos inclinados hacia la luz, como el de una ventana en un azulejo.' },
      { key: 'shininess', label: 'Dureza del brillo', min: 4, max: 300, step: 1, def: 90, log: true, stage: 'render',
        help: 'Más alto: reflejos pequeños y nítidos; más bajo: reflejos amplios y suaves.' },
      { key: 'glazeNoise', label: 'Textura del esmalte', min: 0, max: 0.2, step: 0.005, def: 0.0125, stage: 'render',
        help: 'Más alto: superficie con más grano.' },
      { key: 'outLong', label: 'Tamaño de la descarga', min: 600, max: 4000, step: 100, def: 2000, unit: ' px', stage: 'render',
        help: 'Lado largo del PNG descargado.' },
      { key: 'supersample', label: 'Antialiasing (sin GPU)', min: 1, max: 3, step: 1, def: 2, unit: '×', stage: 'render',
        help: 'Solo se usa si el navegador no tiene WebGL2.' },
    ],
  },
];

export const ALL_PARAMS = GROUPS.flatMap((g) => g.params);
export const PARAM = Object.fromEntries(ALL_PARAMS.map((q) => [q.key, q]));
export const DEFAULTS = Object.fromEntries(ALL_PARAMS.map((q) => [q.key, q.def]));
// Hidden parameters keep their default: they duplicate another control
// ("Tamaño de los trozos", "Otra versión") or have no clear visible effect.
export const isVisible = (q, p) => !q.hidden && (q.show ?? any)(p);

export const STAGE_ORDER = ['analysis', 'tessellation', 'color', 'render'];
export const keysForStage = (stage) => ALL_PARAMS.filter((q) => q.stage === stage).map((q) => q.key);

// Pixel lengths in the settings are pixels of an 800 px wide photo, so the
// working resolution changes how fine the mosaic is computed, not how it looks.
// This turns them into pixels of the photo the pipeline actually gets.
export const REFERENCE_LONG = 800;
// Working resolution of the draft shown while a control is being dragged.
export const DRAFT_LONG = 400;
const SCALED = ALL_PARAMS.filter((q) => q.unit === ' px' && q.key !== 'workLong' && q.key !== 'outLong').map((q) => q.key);
export function toWorkPx(p) {
  const k = (p.workLong ?? REFERENCE_LONG) / REFERENCE_LONG;
  if (k === 1) return p;
  const out = { ...p };
  for (const key of SCALED) out[key] = p[key] * k;
  return out;
}
