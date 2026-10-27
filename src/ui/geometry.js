// Geometry shared by the canvases in the UI.

// v limited to the range [a, b].
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// The normalised point [u, v] under a pointer on `canvas`, which is drawn with
// object-fit: contain in its box. Not clamped: a point in the empty bands
// around the image has a coordinate below 0 or above 1.
export function pointerToUV(canvas, { clientX, clientY }) {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / canvas.width, r.height / canvas.height);
  const ox = (r.width - canvas.width * s) / 2, oy = (r.height - canvas.height * s) / 2;
  return [(clientX - r.left - ox) / (canvas.width * s), (clientY - r.top - oy) / (canvas.height * s)];
}
