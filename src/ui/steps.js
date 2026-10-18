// The guided flow. Each step names the stage images it can show, the controls
// of simple mode and the parameters of advanced mode. Copy is plain on purpose.

export const MACRO_INFO = {
  size: { label: 'Tamaño de los trozos', help: 'Más alto: trozos grandes; más bajo: trozos pequeños.' },
  fidelity: { label: 'Parecido a la foto', help: 'Más alto: los cortes siguen los contornos de la foto; más bajo: formas más libres.' },
  gloss: { label: 'Brillo del esmalte', help: 'Más alto: reflejos fuertes y trozos más inclinados; más bajo: acabado mate.' },
};

export const ALGORITHM_INFO = {
  fracture: {
    line: 'Uniones en T, como azulejo roto',
    explanation: 'La imagen se parte con cortes rectos, uno tras otro, hasta que cada trozo tiene el tamaño que pidió el paso anterior. En cada corte se prueban varias rectas y se elige una: con temperatura baja, casi siempre la que mejor separa colores; con temperatura alta, cualquiera.',
    formula: 'coste(recta) = varianza de color en las dos mitades + λ · castigo a astillas\nP(recta) ∝ exp(−coste / T)\nse corta mientras área > κ · s(x)²',
  },
  cracks: {
    line: 'Fisuras que se paran al chocar',
    explanation: 'Las grietas nacen en puntos al azar, más a menudo donde hay detalle, y crecen en los dos sentidos hasta tropezar con otra grieta. Cada grieta nueva parte en dos la región donde nace. Pueden doblarse para seguir los bordes de la foto.',
    formula: 'nacimiento aceptado con probabilidad (s_min / s(x))²\nnúmero de grietas ≈ densidad · Σ 1 / s(x)²',
  },
  voronoi: {
    line: 'Piezas parecidas, tipo panal',
    explanation: 'Se reparten semillas, más juntas donde hay detalle, y cada píxel pertenece a la semilla más cercana. Después cada semilla se mueve al centro de su tesela varias veces, lo que hace las piezas más regulares.',
    formula: 'semillas: Poisson-disk con radio s(x)\nLloyd: semilla ← centroide de su celda, ponderado por 1 / s(x)²',
  },
  'voronoi-aniso': {
    line: 'Piezas estiradas a lo largo de los bordes',
    explanation: 'Como las teselas redondeadas, pero la distancia se mide estirada en la dirección de los bordes de la foto. Las piezas se alargan siguiendo los contornos, como en los mosaicos romanos.',
    formula: 'd² = (dt)² / a + (dn)² · a, con t a lo largo del borde\na = 1 + alargamiento · coherencia(x)',
  },
  hybrid: {
    line: 'Teselas redondeadas partidas con cortes',
    explanation: 'Primero se hacen teselas redondeadas más grandes de lo pedido y después cada una recibe unos pocos cortes rectos. Mezcla el reparto regular de las teselas con las uniones en T de los cortes.',
    formula: 'teselas con separación × tamaño base\ncada tesela: hasta N cortes, cada uno con probabilidad p',
  },
  slic: {
    line: 'Piezas que siguen las manchas de color',
    explanation: 'Se agrupan los píxeles por cercanía y por parecido de color, de modo que cada pieza abarca una mancha de color de la foto. Después se simplifican sus bordes para que queden rectos.',
    formula: 'd² = ΔLab² + (Δxy / s)² · m²\nsimplificación de bordes: Douglas-Peucker',
  },
};

export const STEPS = [
  {
    id: 'foto',
    title: 'Foto',
    explanation: 'La imagen se reduce a la resolución de trabajo. Todo el cálculo se hace a ese tamaño; el mosaico final se dibuja más grande.',
    views: [{ key: 'original', label: 'Original' }],
    simple: [{ kind: 'upload' }],
    advanced: [['workLong']],
  },
  {
    id: 'detalle',
    title: 'Detalle',
    explanation: 'Se mide cuánto detalle hay en cada zona: bordes, texturas, cambios bruscos. Con eso se decide el tamaño de los trozos, pequeños donde hay detalle y grandes en las zonas lisas. También se calcula hacia dónde van los bordes, para que los cortes puedan seguirlos.',
    formula: 'D(x) = |L − desenfoque(L, σ)|, suavizado y normalizado a [0, 1]\ns(x) = s_max − (s_max − s_min) · D(x)^γ\nθ(x) = dirección del borde según el tensor de estructura',
    views: [
      { key: 'detail', label: 'Detalle' },
      { key: 'size', label: 'Tamaño de trozo' },
      { key: 'orientation', label: 'Dirección de los bordes' },
    ],
    simple: [{ macro: 'size' }, { param: 'gamma' }],
    advanced: [['sMin', 'sMax', 'gamma', 'detailSigma', 'detailSmooth', 'tensorSigma']],
  },
  {
    id: 'trozos',
    title: 'Trozos',
    views: [
      { key: 'tessellation', label: 'Contornos' },
      { key: 'structure', label: 'Estructura' },
    ],
    simple: [{ kind: 'algorithm' }, { macro: 'fidelity' }, { kind: 'reseed' }],
    advanced: [['algorithm', 'seed', 'spacing', 'lloydIters', 'lloydWeighted', 'anisotropy', 'kappa', 'temperature', 'candidates', 'edgeAlign', 'cutJitter', 'angleNoise', 'sliver', 'hybridSpacing', 'hybridCuts', 'hybridCutProb', 'compactness', 'slicIters', 'crackDensity', 'crackActive', 'crackAngleNoise', 'crackCurl', 'crackFollow', 'simplify']],
  },
  {
    id: 'color',
    title: 'Color',
    explanation: 'Cada trozo recibe un solo color, calculado con los píxeles que cubre. Después se puede ajustar a una paleta: los colores más frecuentes de la foto o un juego fijo de azulejos de taller. Una pequeña variación al azar imita que no hay dos azulejos iguales.',
    formula: 'media: c = (1/N) Σ píxeles del trozo\nmás vivo: media del 30 % más saturado\npaleta: color más cercano en Lab, mezclado según la fuerza',
    views: [
      { key: 'flat', label: 'Color por trozo' },
      { key: 'palette', label: 'Con paleta y variación' },
    ],
    simple: [{ param: 'colorMode' }, { param: 'palette' }, { param: 'saturation' }],
    advanced: [['colorMode', 'saturation', 'lightness', 'palette', 'paletteK', 'paletteMix', 'colorJitter']],
  },
  {
    id: 'acabado',
    title: 'Acabado',
    explanation: 'Se dibuja el mosaico: el mortero entre trozos, un bisel en cada borde y una inclinación distinta en cada trozo, para que la luz brille de forma desigual, como en el esmalte de verdad. Todo esto se calcula en la tarjeta gráfica y responde al momento.',
    formula: 'junta: píxeles a menos de ancho / 2 del borde\nluz = (ambiente + difusa) · color + brillo · (n · h)^dureza   (Blinn-Phong)',
    views: [{ key: 'final', label: 'Mosaico' }],
    simple: [{ param: 'grout' }, { macro: 'gloss' }, { param: 'lightAz' }],
    advanced: [
      ['grout', 'groutColor', 'groutShadow', 'bevel', 'bevelStrength'],
      ['tilt', 'lightAz', 'lightEl', 'ambient', 'specular', 'shininess', 'glazeNoise'],
      ['outLong', 'supersample'],
    ],
    advancedTabs: ['Junta', 'Luz y esmalte', 'Descarga'],
  },
];

export const stepById = (id) => STEPS.find((s) => s.id === id) ?? STEPS[0];
