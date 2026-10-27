// Label maps as pixels, so they can be stored as a small PNG: R = G = B =
// label + 1, 0 where there is no object, opaque. The PNG's own compression
// does the rest, since the map is made of large flat areas.

// `labels` is an Int32Array(w * h) with -1 for no object. Returns RGBA bytes.
export function encodeLabels({ w, h, labels }) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (labels[i] > 254) throw new Error(`label ${labels[i]} does not fit in a byte`);
    const v = labels[i] + 1;
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

// The inverse: { w, h, labels, count }, `count` being the highest label + 1.
export function decodeLabels(rgba, w, h) {
  const labels = new Int32Array(w * h);
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    labels[i] = rgba[i * 4] - 1;
    if (labels[i] >= count) count = labels[i] + 1;
  }
  return { w, h, labels, count };
}
