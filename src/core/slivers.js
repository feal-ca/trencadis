import { distanceTransform } from './render.js';

// Width of every region: twice its inscribed radius, from a distance
// transform whose features are the region boundaries (and the image edge).
export function regionWidths(labels, w, h) {
  const f = new Float32Array(w * h).fill(Infinity);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, l = labels[i];
      if (l < 0 || x === 0 || y === 0 || x === w - 1 || y === h - 1
        || labels[i - 1] !== l || labels[i + 1] !== l || labels[i - w] !== l || labels[i + w] !== l) f[i] = 0;
    }
  }
  const d = distanceTransform(f, w, h);
  const widths = new Map();
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0) continue;
    const width = 2 * d[i] + 1;
    if (!(widths.get(l) >= width)) widths.set(l, width);
  }
  return widths;
}

// Regions narrower than minWidth × s(x) join the neighbour they share the
// longest border with. Returns a new label map.
export function mergeSlivers(labels, w, h, size, minWidth) {
  if (minWidth <= 0) return labels;
  const widths = regionWidths(labels, w, h);
  const sizeSum = new Map(), count = new Map();
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    if (l < 0) continue;
    sizeSum.set(l, (sizeSum.get(l) ?? 0) + size[i]);
    count.set(l, (count.get(l) ?? 0) + 1);
  }
  const thin = new Set();
  for (const [l, width] of widths) if (width < minWidth * (sizeSum.get(l) / count.get(l))) thin.add(l);
  if (!thin.size) return labels;

  // Shared border length between each thin region and its neighbours.
  const shared = new Map();
  const touch = (a, b) => {
    if (a === b || a < 0 || b < 0 || !thin.has(a)) return;
    const m = shared.get(a) ?? new Map();
    m.set(b, (m.get(b) ?? 0) + 1);
    shared.set(a, m);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x + 1 < w) { touch(labels[i], labels[i + 1]); touch(labels[i + 1], labels[i]); }
      if (y + 1 < h) { touch(labels[i], labels[i + w]); touch(labels[i + w], labels[i]); }
    }
  }
  // Thinnest first; follow earlier merges so chains resolve to a survivor.
  const parent = new Map();
  const find = (l) => { while (parent.has(l)) l = parent.get(l); return l; };
  const order = [...thin].sort((a, b) => widths.get(a) - widths.get(b));
  for (const l of order) {
    const m = shared.get(l);
    if (!m) continue;
    let best = -1, bc = -1;
    for (const [n, c] of m) if (c > bc && find(n) !== l) { bc = c; best = n; }
    if (best >= 0) parent.set(l, find(best));
  }
  const out = new Int32Array(labels.length);
  for (let i = 0; i < labels.length; i++) out[i] = labels[i] < 0 ? -1 : find(labels[i]);
  return out;
}
