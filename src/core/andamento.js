import { blur, luminance, sobel } from './image.js';
import { labelsToPolygons } from './polygonize.js';
import { area, rasterize } from './polygon.js';
import { hash2 } from './rng.js';
import { fillUnlabeled } from './slic.js';
import { mergeSlivers, splitComponents } from './slivers.js';

// Rows of rectangular pieces laid along guide lines (what mosaicists call
// andamento), on top of the background mosaic. A guide is a polyline in
// working pixels.

// --- automatic guides ----------------------------------------------------

// Strong, long contours of the photo: gradient magnitude, non-maximum
// suppression, hysteresis, then 8-connected chains, smoothed and resampled.
// `autoGuides` in [0, 1]: 0 finds nothing, 1 many short contours.
export function extractGuides(img, an, p) {
  const amount = p.autoGuides ?? 0;
  if (amount <= 0) return [];
  const { w, h } = img;
  const { gx, gy } = sobel(blur(luminance(img), w, h, Math.max(1, p.detailSigma)), w, h);
  const mag = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) mag[i] = Math.hypot(gx[i], gy[i]);

  const thin = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, m = mag[i];
      if (m === 0) continue;
      // Quantise the gradient direction to compare against the two neighbours across the edge.
      const a = Math.atan2(gy[i], gx[i]);
      const q = ((Math.round(a / (Math.PI / 4)) % 4) + 4) % 4;
      const [dx, dy] = [[1, 0], [1, 1], [0, 1], [-1, 1]][q];
      if (m >= mag[i + dy * w + dx] && m > mag[i - dy * w - dx]) thin[i] = m;
    }
  }

  // Thresholds relative to the strongest edges of the image, so smooth
  // gradients and noise never qualify however many ridges they produce.
  const sample = new Float32Array(Math.ceil(mag.length / 7));
  for (let i = 0, k = 0; i < mag.length; i += 7) sample[k++] = mag[i];
  const strong = sample.sort()[Math.floor(0.995 * (sample.length - 1))];
  if (!(strong > 0)) return [];
  const hi = strong * (0.7 - 0.45 * amount);
  const lo = hi * 0.5;
  const edge = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < w * h; i++) if (thin[i] >= hi) { edge[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx;
      if (!edge[j] && thin[j] >= lo) { edge[j] = 1; stack.push(j); }
    }
  }

  // Longest first, up to a total length of a few times the image perimeter.
  const minLen = p.sMax * (5 - 3.5 * amount);
  const budget = (1 + 3 * amount) * (w + h);
  const chains = traceChains(edge, w, h)
    .map(smoothChain)
    .map((c) => [c, chainLength(c)])
    .filter(([c, len]) => c.length > 1 && len >= minLen)
    .sort((a, b) => b[1] - a[1]);
  const out = [];
  let used = 0;
  for (const [c, len] of chains) {
    if (used + len > budget) continue;
    out.push(c);
    used += len;
  }
  return out;
}

const NB = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function traceChains(edge, w, h) {
  const seen = new Uint8Array(w * h);
  const degree = (i) => {
    const x = i % w, y = (i / w) | 0;
    let n = 0;
    for (const [dx, dy] of NB) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && edge[yy * w + xx]) n++;
    }
    return n;
  };
  const walk = (s) => {
    const chain = [];
    let i = s;
    while (i >= 0) {
      seen[i] = 1;
      chain.push([(i % w) + 0.5, ((i / w) | 0) + 0.5]);
      const x = i % w, y = (i / w) | 0;
      let next = -1;
      for (const [dx, dy] of NB) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (edge[j] && !seen[j]) { next = j; break; }
      }
      i = next;
    }
    return chain;
  };
  const chains = [];
  // Open chains first (start at endpoints), then whatever is left (loops).
  for (let i = 0; i < w * h; i++) if (edge[i] && !seen[i] && degree(i) === 1) chains.push(walk(i));
  for (let i = 0; i < w * h; i++) if (edge[i] && !seen[i]) chains.push(walk(i));
  return chains;
}

const chainLength = (c) => c.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - c[i][0], q[1] - c[i][1]), 0);

function smoothChain(c) {
  if (c.length < 5) return c;
  const out = c.map((_, i) => {
    let x = 0, y = 0, n = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(c.length - 1, i + 3); k++) { x += c[k][0]; y += c[k][1]; n++; }
    return [x / n, y / n];
  });
  return resample(out, 3);
}

// Points every `step` px along a polyline.
export function resample(c, step) {
  const out = [c[0]];
  let carry = 0;
  for (let i = 1; i < c.length; i++) {
    const [ax, ay] = c[i - 1], [bx, by] = c[i];
    const len = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  if (c.length > 1) out.push(c[c.length - 1]);
  return out;
}

// --- rows ----------------------------------------------------------------

// Row piece label for every pixel near a guide, -1 elsewhere. The piece
// width a follows the local piece size, a = rowScale · s(x) sampled along
// the guide and smoothed; row k covers signed distances
// [(k − n/2)·a, (k − n/2 + 1)·a). Along the guide pieces are rowLength·a long
// with jittered ends, and odd rows start half a piece later.
export function rowLabels(guides, w, h, p, size) {
  const n = Math.round(p.rowCount);
  const best = new Float32Array(w * h).fill(Infinity);
  const key = new Float64Array(w * h).fill(-1);
  const sizeAt = (x, y) => size[Math.min(h - 1, Math.max(0, y | 0)) * w + Math.min(w - 1, Math.max(0, x | 0))];
  guides.forEach((line, gi) => {
    // Vertices every 4 px, so the piece size is sampled all along the guide.
    const g = resample(line, 4);
    const arc = [0];
    for (let i = 1; i < g.length; i++) arc.push(arc[i - 1] + Math.hypot(g[i][0] - g[i - 1][0], g[i][1] - g[i - 1][1]));
    // Width per vertex, smoothed over ~±10 vertices so it changes gently.
    const raw = g.map(([x, y]) => p.rowScale * sizeAt(x, y));
    const width = raw.map((_, i) => {
      let sum = 0, c = 0;
      for (let k = Math.max(0, i - 10); k <= Math.min(raw.length - 1, i + 10); k++) { sum += raw[k]; c++; }
      return Math.max(2, sum / c);
    });
    const widthAt = (s) => {
      let i = 0;
      while (i + 1 < arc.length && arc[i + 1] < s) i++;
      if (i + 1 >= arc.length) return width[arc.length - 1];
      const t = (s - arc[i]) / Math.max(1e-9, arc[i + 1] - arc[i]);
      return width[i] + (width[i + 1] - width[i]) * Math.min(1, Math.max(0, t));
    };
    // Piece boundaries along the guide for each row, with jittered lengths.
    const total = arc[arc.length - 1];
    const ends = [];
    for (let k = 0; k < n; k++) {
      const list = [];
      let s = -((k % 2) * p.rowLength * widthAt(0)) / 2;
      let j = 0;
      while (s < total) {
        list.push(s);
        s += p.rowLength * widthAt(Math.max(0, s)) * (0.85 + 0.3 * hash2(gi * 131 + k, j++, 7));
      }
      list.push(Infinity);
      ends.push(list);
    }
    const pieceAt = (k, s) => {
      const list = ends[k];
      let lo = 0, hi = list.length - 1;
      while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (list[mid] <= s) lo = mid; else hi = mid; }
      return lo;
    };
    for (let i = 0; i + 1 < g.length; i++) {
      const [ax, ay] = g[i], [bx, by] = g[i + 1];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      const len = Math.sqrt(len2);
      const reach = (n * Math.max(width[i], width[i + 1])) / 2 + 1;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach)), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + reach));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach)), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + reach));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5 - ax, py = y + 0.5 - ay;
          let t = (px * dx + py * dy) / len2;
          // No caps at the ends of the guide; interior joints clamp to the vertex.
          if ((t < 0 && i === 0) || (t > 1 && i === g.length - 2)) continue;
          t = Math.min(1, Math.max(0, t));
          const a = width[i] + (width[i + 1] - width[i]) * t;
          const half = (n * a) / 2;
          const dist = Math.hypot(px - t * dx, py - t * dy);
          if (dist > half || dist >= best[y * w + x]) continue;
          const d = (px * dy - py * dx) / len; // signed distance to the segment line
          const k = Math.floor((Math.sign(d || 1) * dist + half) / a);
          if (k < 0 || k >= n) continue;
          best[y * w + x] = dist;
          key[y * w + x] = (gi * 8 + k) * 1e6 + pieceAt(k, arc[i] + t * len);
        }
      }
    }
  });
  const ids = new Map();
  const labels = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    if (key[i] < 0) continue;
    let id = ids.get(key[i]);
    if (id === undefined) ids.set(key[i], (id = ids.size));
    labels[i] = id;
  }
  return { labels, count: ids.size };
}

// Lay the rows over the background shards. The background is rasterised,
// the rows overwrite it, every leftover fragment becomes its own piece and
// background slivers merge into background neighbours.
export function overlayRows(baseShards, guides, w, h, p, an) {
  if (!guides.length) return baseShards;
  const rows = rowLabels(guides, w, h, p, an.size);
  if (!rows.count) return baseShards;
  const labels = new Int32Array(w * h).fill(-1);
  const order = baseShards.map((s, id) => [area(s.poly), id]).sort((a, b) => b[0] - a[0]);
  for (const [, id] of order) rasterize(baseShards[id].poly, w, h, (x, y) => { labels[y * w + x] = id; });
  const ROW = baseShards.length;
  for (let i = 0; i < w * h; i++) if (rows.labels[i] >= 0) labels[i] = ROW + rows.labels[i];

  const { labels: parts, origin } = splitComponents(labels, w, h);
  // Base pieces that ended up in more than one part were cut by a row.
  const partsPerBase = new Map();
  origin.forEach((old) => partsPerBase.set(old, (partsPerBase.get(old) ?? 0) + 1));
  const splitIds = new Set([...partsPerBase].filter(([, n]) => n > 1).map(([old]) => old));
  fillUnlabeled(parts, w, h);
  const protect = new Set();
  origin.forEach((old, id) => { if (old >= ROW) protect.add(id); });
  // Only background fragments that touch a row may merge: the rest of the
  // mosaic stays as the background method made it.
  const touching = new Set();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, l = parts[i];
      if (protect.has(l)) continue;
      if ((x + 1 < w && protect.has(parts[i + 1])) || (x > 0 && protect.has(parts[i - 1]))
        || (y + 1 < h && protect.has(parts[i + w])) || (y > 0 && protect.has(parts[i - w]))) touching.add(l);
    }
  }
  const merged = mergeSlivers(parts, w, h, an.size, 0.25, { protect, only: touching });

  // Background pieces whose pixels are exactly what they were keep their
  // original, crisper polygon. A base piece changed if it lost pixels (to a
  // row or to a neighbour) or gained some (absorbed a fragment).
  const changed = new Set(splitIds);
  for (let i = 0; i < w * h; i++) {
    const now = origin[merged[i]], was = labels[i];
    if (now === was) continue;
    if (now < ROW) changed.add(now);
    if (was >= 0 && was < ROW) changed.add(was);
  }
  const intact = baseShards.filter((_, id) => !changed.has(id)).map(({ poly }) => ({ poly, row: false }));
  const redo = new Set();
  for (let i = 0; i < w * h; i++) if (protect.has(merged[i]) || changed.has(origin[merged[i]])) redo.add(merged[i]);
  const traced = labelsToPolygons(merged, w, h, 0.8, 4, redo).map(({ poly, label }) => ({ poly, row: protect.has(label) }));
  return intact.concat(traced);
}


// Hand-drawn guides arrive in normalised coordinates; scale, smooth and
// resample them like the automatic ones.
export function drawnGuides(list, w, h) {
  return (list ?? [])
    .map((g) => g.map(([u, v]) => [u * w, v * h]))
    .filter((g) => g.length > 1)
    .map((g) => smoothChain(resample(g, 1.5)));
}
