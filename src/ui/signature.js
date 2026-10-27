export const SIGNATURE_TEXT = 'trencadís · feal-ca.github.io/trencadis';
const FONT = '"Figtree Variable", system-ui, sans-serif';

// Where the signature goes on a w x h image: its bottom-right anchor and font size.
export function signatureBox(w, h) {
  const long = Math.max(w, h);
  const margin = Math.round(0.012 * long);
  return { x: w - margin, y: h - margin, size: Math.max(11, Math.round(0.014 * long)) };
}

// Draws the signature in the bottom-right corner of a 2D context. The font is
// loaded first, or the first export would fall back to a system one.
export async function drawSignature(ctx, w, h) {
  const { x, y, size } = signatureBox(w, h);
  const font = `600 ${size}px ${FONT}`;
  try { await document.fonts.load(font, SIGNATURE_TEXT); } catch { /* the fallback font will do */ }
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = size / 6;
  ctx.fillText(SIGNATURE_TEXT, x, y);
  ctx.restore();
}
