// The text, bar and buttons of the segmentation status (SegStatus.jsx) for a
// session state.

// Megabytes of the first download (model and ONNX runtime), as measured by
// scripts/seg-bytes.mjs: the larger of its two totals, rounded up to 5.
export const SEG_DOWNLOAD_MB = 20;

const percent = (seg) => (seg.total ? Math.round((100 * seg.done) / seg.total) : 0);

// `actions` is 'ask' (accept or decline), 'retry' or null. `bar` is a
// percentage, or null for no bar.
export function statusOf(seg) {
  let text = null, bar = null, actions = null;
  if (seg.phase === 'download') {
    // The bar counts the model only; once it is full the runtime may still
    // be downloading, so it gives way to a text without a number.
    if (seg.total > 0 && seg.done < seg.total) { text = `Descargando el buscador de formas… ${percent(seg)} %`; bar = percent(seg); }
    else text = 'Preparando el buscador de formas…';
  } else if (seg.phase === 'encode') text = 'Preparando la foto…';
  else if (seg.phase === 'decode') { text = `Buscando las formas de la foto… ${seg.found ?? 0} encontradas`; bar = percent(seg); }
  else if (seg.phase === 'ask') {
    text = `Buscar las formas de la foto: descarga de unos ${SEG_DOWNLOAD_MB} MB la primera vez`;
    actions = 'ask';
  } else if (seg.phase === 'error') {
    text = 'No se han podido buscar las formas';
    actions = 'retry';
  }
  return { text, bar, actions };
}
