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
// longest border with. Labels in opts.protect never merge or absorb others;
// with opts.only, only those labels are candidates; with opts.group (a group
// id per label), a region only joins a neighbour of its own group.
// Returns a new label map.
export function mergeSlivers(labels, w, h, size, minWidth, opts = {}) {
  const protect = opts.protect ?? new Set();
  const group = opts.group ?? null;
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
  for (const [l, width] of widths) {
    if (protect.has(l) || (opts.only && !opts.only.has(l))) continue;
    if (width < minWidth * (sizeSum.get(l) / count.get(l))) thin.add(l);
  }
  if (!thin.size) return labels;

  // Shared border length between each thin region and its neighbours.
  const shared = new Map();
  const touch = (a, b) => {
    if (a === b || a < 0 || b < 0 || !thin.has(a) || protect.has(b) || (group && group[a] !== group[b])) return;
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

// Give every 4-connected part of a label its own label. Returns the new map
// and origin[newLabel] = old label. -1 stays -1.
export function splitComponents(labels, w, h) {
  const N = w * h;
  const out = new Int32Array(N).fill(-1);
  const origin = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (out[s] >= 0 || labels[s] < 0) continue;
    const l = labels[s], id = origin.length;
    origin.push(l);
    let top = 0;
    stack[top++] = s;
    out[s] = id;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && out[i - 1] < 0 && labels[i - 1] === l) { out[i - 1] = id; stack[top++] = i - 1; }
      if (x < w - 1 && out[i + 1] < 0 && labels[i + 1] === l) { out[i + 1] = id; stack[top++] = i + 1; }
      if (y > 0 && out[i - w] < 0 && labels[i - w] === l) { out[i - w] = id; stack[top++] = i - w; }
      if (y < h - 1 && out[i + w] < 0 && labels[i + w] === l) { out[i + w] = id; stack[top++] = i + w; }
    }
  }
  return { labels: out, origin: Int32Array.from(origin) };
}
