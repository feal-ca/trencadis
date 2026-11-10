// Copy for the simple controls and the lists of the "Más ajustes" drawer.
// Plain on purpose.

export const MACRO_INFO = {
  size: { label: 'Tamaño de los trozos', help: 'Más alto: trozos grandes y menos piezas; más bajo: trozos pequeños y más detalle.' },
  fidelity: { label: 'Contornos', help: 'Cuántas formas de la foto quedan separadas por una junta. Más alto: también las sutiles; más bajo: solo las principales.' },
  gloss: { label: 'Brillo del esmalte', help: 'Más alto: reflejos más fuertes en los cantos; más bajo: acabado mate.' },
};

export const ALGORITHM_INFO = {
  trencadis: { line: 'Azulejo roto: piezas con cortes rectos' },
  vitral: { line: 'Pocos vidrios grandes y plomo oscuro' },
  romano: { line: 'Teselas pequeñas en fila por los contornos' },
  cracks: { line: 'Una losa agrietada de lado a lado' },
};

// What "Más ajustes" shows, by group. A parameter only appears when it
// applies to the current method (params.js).
export const MORE = [
  { title: 'Trozos', params: ['algorithm', 'pieceCuts', 'sizeRatio', 'simplify', 'crackFollow', 'crackAngleNoise', 'crackCurl', 'crackGap', 'minWidth', 'workLong'] },
  { title: 'Colores', params: ['colorMode', 'lightness', 'paletteK', 'paletteMix', 'paletteDither', 'colorJitter'] },
  { title: 'Acabado', params: ['grout', 'groutRel', 'place', 'bevel', 'bevelStrength', 'lightAz', 'lightEl', 'ambient', 'sheen', 'glazeNoise', 'groutShadow'] },
];
