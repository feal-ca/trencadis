// Parameter schema. The UI is generated from it and the worker uses `stage`
// to know which cached results a change invalidates.
//   stage: analysis < tessellation < color < render
// `help` is the one line shown under each control in advanced mode.

export const ALGORITHMS = [
  { value: 'fracture', label: 'Cortes rectos' },
  { value: 'cracks', label: 'Grietas' },
  { value: 'voronoi', label: 'Teselas redondeadas' },
  { value: 'voronoi-aniso', label: 'Teselas alargadas' },
  { value: 'hybrid', label: 'Teselas partidas' },
  { value: 'slic', label: 'Manchas de color' },
];

const any = () => true;
const algo = (...names) => (p) => names.includes(p.algorithm);

export const GROUPS = [
  {
    id: 'analysis',
    params: [
      { key: 'workLong', label: 'Resolución de trabajo', min: 300, max: 1400, step: 50, def: 800, unit: ' px', stage: 'analysis',
        help: 'Más alto: bordes más precisos y cálculo más lento; más bajo: más rápido y más tosco. No cambia el tamaño de los trozos.' },
      { key: 'sMin', label: 'Trozo mínimo', min: 3, max: 40, step: 0.5, def: 7, unit: ' px', stage: 'analysis',
        help: 'Tamaño de los trozos en las zonas con más detalle. Más alto: los detalles finos se pierden.' },
      { key: 'sMax', label: 'Trozo máximo', min: 8, max: 140, step: 1, def: 36, unit: ' px', stage: 'analysis',
        help: 'Tamaño de los trozos en las zonas lisas. Más alto: fondos con pocas piezas grandes.' },
      // Read by the size control: sMin = sMax / sizeRatio.
      { key: 'sizeRatio', label: 'Variedad de tamaños', min: 1.5, max: 8, step: 0.1, def: 36 / 7, unit: '×', stage: 'analysis',
        help: 'Cuántas veces es mayor el trozo más grande que el más pequeño. Más bajo: trozos parecidos, como el trencadís de verdad, y el detalle se ve por el color; más alto: trozos finos en el detalle.' },
      { key: 'gamma', label: 'Sensibilidad al detalle', min: 0.15, max: 3, step: 0.05, def: 0.7, stage: 'analysis',
        help: 'Más bajo: casi cualquier detalle encoge los trozos; más alto: solo los bordes fuertes.' },
      { key: 'ignoreTexture', label: 'Ignorar texturas', min: 0, max: 1, step: 0.01, def: 0, stage: 'analysis',
        help: 'Más alto: el detalle hecho de puntos (brillos en el agua, hojas, césped) cuenta menos y se cubre con trozos grandes; los contornos se mantienen.' },
      { key: 'detailSigma', label: 'Escala del detalle', min: 0.5, max: 8, step: 0.1, def: 2, unit: ' px', stage: 'analysis',
        help: 'Qué se considera detalle. Más alto: formas más grandes; más bajo: textura fina y ruido.' },
      { key: 'detailSmooth', label: 'Suavizado del mapa', min: 0.5, max: 20, step: 0.5, def: 5, unit: ' px', stage: 'analysis',
        help: 'Más alto: el tamaño de trozo cambia de forma gradual; más bajo: cambios bruscos.' },
      { key: 'tensorSigma', label: 'Escala de los bordes', min: 1, max: 16, step: 0.5, def: 4, unit: ' px', stage: 'analysis',
        help: 'Más alto: direcciones de borde suaves y largas; más bajo: siguen cada curva pequeña.' },
    ],
  },
  {
    id: 'tessellation',
    params: [
      { key: 'algorithm', label: 'Método', type: 'select', options: ALGORITHMS, def: 'fracture', stage: 'tessellation' },
      { key: 'seed', hidden: true, label: 'Semilla', min: 1, max: 999, step: 1, def: 7, stage: 'tessellation',
        help: 'Cambia el azar: misma configuración, otra versión del mosaico.' },
      // Seeds
      { key: 'spacing', hidden: true, label: 'Separación de semillas', min: 0.4, max: 2.5, step: 0.05, def: 1, stage: 'tessellation', show: algo('voronoi', 'voronoi-aniso', 'hybrid', 'slic'),
        help: 'Más alto: menos teselas y más grandes; más bajo: más teselas.' },
      { key: 'lloydIters', label: 'Regularidad', min: 0, max: 20, step: 1, def: 3, stage: 'tessellation', show: algo('voronoi', 'voronoi-aniso', 'hybrid'),
        help: 'Iteraciones de Lloyd. Más alto: teselas parecidas entre sí, tipo panal; 0: formas al azar.' },
      { key: 'lloydWeighted', hidden: true, label: 'Regularidad según el detalle', type: 'checkbox', def: true, stage: 'tessellation', show: algo('voronoi', 'voronoi-aniso', 'hybrid'),
        help: 'Mantiene teselas pequeñas en las zonas con detalle al regularizar.' },
      { key: 'anisotropy', label: 'Alargamiento', min: 0, max: 8, step: 0.1, def: 2.5, stage: 'tessellation', show: algo('voronoi-aniso'),
        help: 'Más alto: teselas estiradas a lo largo de los bordes; 0: redondas.' },
      // Fracture
      { key: 'tileSize', label: 'Tamaño de los azulejos base', min: 0, max: 8, step: 0.1, def: 3.5, stage: 'tessellation', show: algo('fracture'),
        help: 'Antes de romper, la imagen se divide en azulejos de este tamaño (en trozos). Más bajo: costuras más cortas; 0: se rompe la imagen entera.' },
      { key: 'kappa', hidden: true, label: 'Área por trozo', min: 0.3, max: 3, step: 0.05, def: 1, stage: 'tessellation', show: algo('fracture'),
        help: 'Cuándo se deja de cortar. Más alto: trozos más grandes que el tamaño pedido.' },
      { key: 'temperature', label: 'Temperatura', min: 0.001, max: 3, step: 0.001, def: 0.08, log: true, stage: 'tessellation', show: algo('fracture', 'hybrid'),
        help: 'Más bajo: siempre el corte que mejor separa colores; más alto: cortes al azar.' },
      { key: 'candidates', hidden: true, label: 'Cortes probados', min: 1, max: 48, step: 1, def: 14, stage: 'tessellation', show: algo('fracture', 'hybrid'),
        help: 'Rectas que se prueban en cada corte. Más alto: más fiel y más lento.' },
      { key: 'edgeAlign', label: 'Seguir los bordes', min: 0, max: 1, step: 0.01, def: 0.5, stage: 'tessellation', show: algo('fracture', 'hybrid'),
        help: 'Más alto: más cortes paralelos a los bordes de la foto; más bajo: cortes por el lado corto del trozo.' },
      { key: 'cutJitter', label: 'Descentrado del corte', min: 0, max: 0.5, step: 0.01, def: 0.22, stage: 'tessellation', show: algo('fracture', 'hybrid'),
        help: 'Más alto: los cortes pasan lejos del centro y los trozos salen desiguales.' },
      { key: 'angleNoise', label: 'Ruido de ángulo', min: 0, max: 90, step: 1, def: 25, unit: '°', stage: 'tessellation', show: algo('fracture', 'hybrid'),
        help: 'Más alto: ángulos de corte más variados; 0: cortes muy ordenados.' },
      { key: 'sliver', label: 'Castigo a las astillas', min: 0, max: 3, step: 0.05, def: 0.8, stage: 'tessellation', show: algo('fracture', 'hybrid'),
        help: 'Más alto: evita trozos muy finos o con ángulos muy agudos; 0: permite astillas.' },
      // Hybrid
      { key: 'hybridSpacing', label: 'Tamaño de tesela base', min: 1, max: 4, step: 0.1, def: 1.8, stage: 'tessellation', show: algo('hybrid'),
        help: 'Tamaño de las teselas antes de partirlas. Más alto: menos teselas, más cortes por cada una.' },
      { key: 'hybridCuts', label: 'Cortes por tesela', min: 0, max: 4, step: 1, def: 2, stage: 'tessellation', show: algo('hybrid'),
        help: 'Cuántas veces como mucho se parte cada tesela.' },
      { key: 'hybridCutProb', label: 'Probabilidad de cada corte', min: 0, max: 1, step: 0.01, def: 0.7, stage: 'tessellation', show: algo('hybrid'),
        help: 'Más bajo: más teselas se quedan enteras.' },
      // SLIC
      { key: 'compactness', label: 'Compacidad', min: 1, max: 60, step: 0.5, def: 12, stage: 'tessellation', show: algo('slic'),
        help: 'Más bajo: las manchas se pegan a los bordes de la foto; más alto: manchas redondas y regulares.' },
      { key: 'slicIters', hidden: true, label: 'Iteraciones', min: 1, max: 20, step: 1, def: 8, stage: 'tessellation', show: algo('slic'),
        help: 'Más alto: manchas mejor ajustadas y cálculo más lento.' },
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
      // Rows along guide lines, over any method
      { key: 'rowScale', label: 'Ancho de las piezas de hilera', min: 0.15, max: 1.5, step: 0.01, def: 0.45, unit: '×', stage: 'tessellation',
        help: 'En proporción al tamaño de trozo de cada zona: las hileras crecen y menguan con los trozos que las rodean.' },
      { key: 'rowLength', label: 'Largo de las piezas de hilera', min: 1, max: 4, step: 0.1, def: 1.8, unit: '×', stage: 'tessellation',
        help: 'Largo en múltiplos del ancho. 1: piezas cuadradas; más alto: rectángulos alargados.' },
      { key: 'rowCount', label: 'Filas por hilera', min: 1, max: 4, step: 1, def: 2, stage: 'tessellation',
        help: 'Con 2, el contorno queda justo en la junta entre las dos filas y cada fila toma el color de su lado.' },
      // Shared by raster-based methods
      { key: 'minWidth', label: 'Grosor mínimo', min: 0, max: 0.8, step: 0.01, def: 0.3, stage: 'tessellation', show: algo('voronoi-aniso', 'slic', 'cracks'),
        help: 'Los trozos más estrechos que esto (en tamaños de trozo) se unen a su vecino. 0: se dejan todos.' },
      { key: 'simplify', label: 'Rectitud de aristas', min: 0, max: 5, step: 0.1, def: 1.4, unit: ' px', stage: 'tessellation', show: algo('voronoi-aniso', 'slic', 'cracks'),
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
      {
        key: 'rowColor', label: 'Color de las hileras', type: 'select', def: 'photo', stage: 'color',
        options: [
          { value: 'photo', label: 'El de la foto' },
          { value: 'dark', label: 'Más oscuro' },
          { value: 'light', label: 'Más claro' },
        ],
        help: 'Más oscuro: las hileras dibujan el contorno como una línea, como en los bancos del Park Güell.',
      },
      { key: 'rowContrast', label: 'Intensidad del color de las hileras', min: 0, max: 1, step: 0.01, def: 0.6, stage: 'color', show: (p) => p.rowColor !== 'photo',
        help: 'Cuánto más oscuras o más claras que la foto salen las hileras. Más alto: se distinguen más del fondo.' },
      { key: 'colorJitter', label: 'Variación entre trozos', min: 0, max: 0.15, step: 0.002, def: 0.025, stage: 'color',
        help: 'Más alto: trozos vecinos con tonos algo distintos, como azulejos de lotes diferentes.' },
    ],
  },
  {
    id: 'render',
    params: [
      { key: 'grout', label: 'Ancho de la junta', min: 0, max: 6, step: 0.1, def: 1.3, unit: ' px', stage: 'render',
        help: 'Más alto: más mortero entre trozos; 0: sin junta.' },
      { key: 'rowGrout', label: 'Junta de las hileras', min: 1, max: 3, step: 0.05, def: 1.6, unit: '×', stage: 'render',
        help: 'Junta más ancha alrededor de las piezas de hilera, para que la fila se lea como una banda aunque las piezas sean grandes.' },
      // 'auto' or a hex colour; 'auto' is resolved per photo (autoGroutColor).
      { key: 'groutColor', label: 'Mortero', type: 'grout', def: 'auto', stage: 'render',
        help: 'Automático: un gris más oscuro que la foto, para que los trozos destaquen. El cemento claro es el clásico, pero sobre fotos oscuras llena la imagen de líneas blancas.' },
      { key: 'groutShadow', label: 'Sombra en la junta', min: 0, max: 1, step: 0.01, def: 0.45, stage: 'render',
        help: 'Más alto: la junta parece más hundida.' },
      { key: 'bevel', label: 'Ancho del bisel', min: 0, max: 6, step: 0.1, def: 1.4, unit: ' px', stage: 'render',
        help: 'Zona del borde de cada trozo que se curva. Más alto: bordes más redondeados.' },
      { key: 'bevelStrength', label: 'Fuerza del bisel', min: 0, max: 2.5, step: 0.05, def: 0.9, stage: 'render',
        help: 'Más alto: los bordes captan más luz y sombra.' },
      { key: 'place', label: 'Colocación a mano', min: 0, max: 1, step: 0.01, def: 0.35, stage: 'render',
        help: 'Cada trozo gira y se mueve un poco, como si se hubiera puesto a mano. Rompe las líneas rectas que cruzan varios trozos.' },
      { key: 'tilt', label: 'Inclinación de los trozos', min: 0, max: 0.6, step: 0.01, def: 0.16, stage: 'render',
        help: 'Más alto: cada trozo refleja la luz de forma distinta; 0: superficie plana.' },
      { key: 'lightAz', label: 'Dirección de la luz', min: 0, max: 360, step: 1, def: 135, unit: '°', stage: 'render',
        help: 'De dónde viene la luz: 0° derecha, 90° arriba, 180° izquierda.' },
      { key: 'lightEl', label: 'Altura de la luz', min: 10, max: 90, step: 1, def: 50, unit: '°', stage: 'render',
        help: 'Más bajo: luz rasante y relieve marcado; 90°: luz desde arriba.' },
      { key: 'ambient', label: 'Luz ambiente', min: 0, max: 1, step: 0.01, def: 0.45, stage: 'render',
        help: 'Más alto: menos contraste entre trozos iluminados y en sombra.' },
      { key: 'specular', label: 'Brillo', min: 0, max: 2, step: 0.01, def: 0.55, stage: 'render',
        help: 'Intensidad de los reflejos del esmalte.' },
      { key: 'shininess', label: 'Dureza del brillo', min: 4, max: 300, step: 1, def: 70, log: true, stage: 'render',
        help: 'Más alto: reflejos pequeños y nítidos; más bajo: reflejos amplios y suaves.' },
      { key: 'glazeNoise', label: 'Textura del esmalte', min: 0, max: 0.2, step: 0.005, def: 0.03, stage: 'render',
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
export const LAB = typeof location !== 'undefined' && new URLSearchParams(location.search).has('lab');
export const isVisible = (q, p) => !q.hidden && (q.show ?? any)(p);

export const STAGE_ORDER = ['analysis', 'tessellation', 'color', 'render'];
export const keysForStage = (stage) => ALL_PARAMS.filter((q) => q.stage === stage).map((q) => q.key);

// Pixel lengths in the settings are pixels of an 800 px wide photo, so the
// working resolution changes how fine the mosaic is computed, not how it looks.
// This turns them into pixels of the photo the pipeline actually gets.
export const REFERENCE_LONG = 800;
const SCALED = ALL_PARAMS.filter((q) => q.unit === ' px' && q.key !== 'workLong' && q.key !== 'outLong').map((q) => q.key);
export function toWorkPx(p) {
  const k = (p.workLong ?? REFERENCE_LONG) / REFERENCE_LONG;
  if (k === 1) return p;
  const out = { ...p };
  for (const key of SCALED) out[key] = p[key] * k;
  return out;
}
