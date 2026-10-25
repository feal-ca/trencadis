import { blur, luminance, sobel } from './image.js';
import { labelsToPolygons } from './polygonize.js';
import { area, rasterize } from './polygon.js';
import { hash2 } from './rng.js';
import { fillUnlabeled } from './slic.js';
import { mergeSlivers, splitComponents } from './slivers.js';

// Rows of rectangular pieces laid along guide lines (what mosaicists call
// andamento), on top of the background mosaic. A guide is a polyline in
// working pixels.

// --- guides ----------------------------------------------------------------

// Gradient of the photo, with its magnitude scaled so 1 is a strong edge
// (the 99.5th percentile). Used for the snapping of drawn guides.
export function edgeMap(img, p) {
  const { w, h } = img;
  const { gx, gy } = sobel(blur(luminance(img), w, h, Math.max(1, p.detailSigma)), w, h);
  const mag = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) mag[i] = Math.hypot(gx[i], gy[i]);
  const sample = new Float32Array(Math.ceil(mag.length / 7));
  for (let i = 0, k = 0; i < mag.length; i += 7) sample[k++] = mag[i];
  const strong = sample.sort()[Math.floor(0.995 * (sample.length - 1))] || 0;
  const norm = new Float32Array(w * h);
  if (strong > 0) for (let i = 0; i < w * h; i++) norm[i] = mag[i] / strong;
  return { w, h, gx, gy, mag: norm, strong };
}

const NB = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

export function traceChains(edge, w, h) {
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

// Join chains whose ends are close and point the same way, so a contour
// broken by a small gap becomes one guide. Chains are undirected: any end may
// meet any end. Ends are bucketed in a grid of cell `gap`, the close pairs
// that line up are linked shortest gap first (each end once, never into a
// loop), and linked chains are concatenated. A busy photo has thousands of
// chains, so this must stay near linear.
export function bridgeGaps(chains, gap) {
  const n = chains.length;
  if (n < 2) return chains;
  const cosMax = Math.cos((35 * Math.PI) / 180);
  // End e of chain c is 2c (start) or 2c + 1 (end): its point and the
  // direction pointing out of the chain there.
  const pt = new Float64Array(8 * n);
  for (let c = 0; c < n; c++) {
    const ch = chains[c], k = Math.min(6, ch.length - 1);
    for (const atEnd of [0, 1]) {
      const [a, b] = atEnd ? [ch[ch.length - 1 - k], ch[ch.length - 1]] : [ch[k], ch[0]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      pt.set([b[0], b[1], (b[0] - a[0]) / l, (b[1] - a[1]) / l], 4 * (2 * c + atEnd));
    }
  }
  const cell = (v) => Math.floor(v / gap);
  const grid = new Map();
  for (let e = 0; e < 2 * n; e++) {
    const key = cell(pt[4 * e]) + ',' + cell(pt[4 * e + 1]);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(e);
  }
  const pairs = [];
  for (let e = 0; e < 2 * n; e++) {
    const [ex, ey, ux, uy] = pt.subarray(4 * e, 4 * e + 4);
    for (let gy = cell(ey) - 1; gy <= cell(ey) + 1; gy++) {
      for (let gx = cell(ex) - 1; gx <= cell(ex) + 1; gx++) {
        for (const f of grid.get(gx + ',' + gy) ?? []) {
          if (f <= e || f >> 1 === e >> 1) continue;
          const [fx, fy, vx, vy] = pt.subarray(4 * f, 4 * f + 4);
          const d = Math.hypot(fx - ex, fy - ey);
          if (d > gap) continue;
          // The two ends must point at each other, and across the gap.
          if (-(ux * vx + uy * vy) < cosMax) continue;
          if (d > 1 && (((fx - ex) * ux + (fy - ey) * uy) / d < 0.5 || ((ex - fx) * vx + (ey - fy) * vy) / d < 0.5)) continue;
          pairs.push([d, e, f]);
        }
      }
    }
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const link = new Int32Array(2 * n).fill(-1);
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const root = (c) => { while (parent[c] !== c) c = parent[c] = parent[parent[c]]; return c; };
  for (const [, e, f] of pairs) {
    if (link[e] >= 0 || link[f] >= 0) continue;
    const a = root(e >> 1), b = root(f >> 1);
    if (a === b) continue;
    link[e] = f; link[f] = e;
    parent[a] = b;
  }
  // Walk each linked path from a free end, entering every chain by the end
  // that was linked and leaving by the other.
  const done = new Uint8Array(n);
  const out = [];
  const walk = (c, from) => {
    let path = [];
    for (;;) {
      done[c] = 1;
      path = path.concat(from === 0 ? chains[c] : chains[c].slice().reverse());
      const next = link[2 * c + (1 - from)];
      if (next < 0) return path;
      c = next >> 1;
      from = next & 1;
    }
  };
  for (let c = 0; c < n; c++) {
    if (done[c]) continue;
    if (link[2 * c] < 0) out.push(walk(c, 0));
    else if (link[2 * c + 1] < 0) out.push(walk(c, 1));
  }
  return out;
}

export const chainLength = (c) => c.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - c[i][0], q[1] - c[i][1]), 0);

export function smoothChain(c) {
  if (c.length < 5) return c;
  const out = c.map((_, i) => {
    let x = 0, y = 0, n = 0;
    for (let k = Math.max(0, i - 5); k <= Math.min(c.length - 1, i + 5); k++) { x += c[k][0]; y += c[k][1]; n++; }
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
          // Square ends: nothing before the start or past the end of the guide.
          // Interior joints clamp to the vertex.
          const along = arc[i] + t * len;
          if (along < 0 || along > total) continue;
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
  return overlayPieces(baseShards, rows.labels, w, h, an);
}

// Lays the pieces of `extra` (a label map, -1 where the background stays) on
// top of `baseShards`. Background pieces cut by them are re-traced and their
// small fragments merged into neighbours; untouched ones keep their polygon.
// `tag` is spread into the new pieces ({ row: true } for rows). With `polys`
// (one per extra label) those are used as they are instead of being traced.
// With `onlyCut`, fragments merge only into other pieces the overlay cut or
// trimmed, or into the new pieces, so background pieces it does not touch
// never change.
export function overlayPieces(baseShards, extra, w, h, an, tag = { row: true }, eps = 0.8, polys = null, { onlyCut = false } = {}) {
  const labels = new Int32Array(w * h).fill(-1);
  const order = baseShards.map((s, id) => [area(s.poly), id]).sort((a, b) => b[0] - a[0]);
  for (const [, id] of order) rasterize(baseShards[id].poly, w, h, (x, y) => { labels[y * w + x] = id; });
  const ROW = baseShards.length;
  // Which base piece each pixel belonged to before the rows went on top.
  const baseOf = Int32Array.from(labels);
  for (let i = 0; i < w * h; i++) if (extra[i] >= 0) labels[i] = ROW + extra[i];

  const { labels: parts, origin } = splitComponents(labels, w, h);
  // Base pieces that ended up in more parts than they had on their own were
  // cut by a row (overlapping base polygons can leave a piece in two parts
  // before anything is laid on top).
  const count = (list) => {
    const m = new Map();
    list.forEach((old) => m.set(old, (m.get(old) ?? 0) + 1));
    return m;
  };
  const partsBefore = count(splitComponents(baseOf, w, h).origin);
  const splitIds = new Set([...count(origin)].filter(([old, n]) => old < ROW && n > (partsBefore.get(old) ?? 0)).map(([old]) => old));
  fillUnlabeled(parts, w, h);
  const isNew = new Set();
  origin.forEach((old, id) => { if (old >= ROW) isNew.add(id); });
  // Only background fragments that touch a row may merge: the rest of the
  // mosaic stays as the background method made it.
  const touching = new Set();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, l = parts[i];
      if (isNew.has(l)) continue;
      if ((x + 1 < w && isNew.has(parts[i + 1])) || (x > 0 && isNew.has(parts[i - 1]))
        || (y + 1 < h && isNew.has(parts[i + w])) || (y > 0 && isNew.has(parts[i - w]))) touching.add(l);
    }
  }
  let merged;
  if (onlyCut) {
    // Background pieces that lost no pixel to the overlay neither merge nor
    // absorb; trimmed and cut ones may, and new pieces may absorb.
    const trimmed = new Set();
    for (let i = 0; i < w * h; i++) if (extra[i] >= 0 && baseOf[i] >= 0) trimmed.add(baseOf[i]);
    const keep = new Set();
    origin.forEach((old, id) => { if (old < ROW && !trimmed.has(old)) keep.add(id); });
    const only = new Set([...touching].filter((l) => !keep.has(l)));
    merged = mergeSlivers(parts, w, h, an.size, 0.25, { protect: keep, only });
  } else {
    merged = mergeSlivers(parts, w, h, an.size, 0.25, { protect: isNew, only: touching });
  }

  // Background pieces whose pixels are exactly what they were keep their
  // original, crisper polygon. A base piece changed if it lost pixels (to a
  // row or to a neighbour) or gained some (absorbed a fragment). A new piece
  // that absorbed a fragment is traced instead of using its given polygon.
  const changed = new Set(splitIds);
  const grown = new Set();
  for (let i = 0; i < w * h; i++) {
    const now = origin[merged[i]], was = baseOf[i];
    if (now === was) continue;
    if (now < ROW && was >= 0) changed.add(now);
    if (was >= 0) changed.add(was);
    if (now >= ROW && parts[i] !== merged[i]) grown.add(merged[i]);
  }
  const intact = baseShards.filter((_, id) => !changed.has(id)).map(({ poly, row }) => ({ poly, row: !!row }));
  const redo = new Set();
  for (let i = 0; i < w * h; i++) {
    const l = merged[i];
    if ((isNew.has(l) && (!polys || grown.has(l))) || changed.has(origin[l])) redo.add(l);
  }
  // A re-traced background piece keeps its origin's row flag, so rows the
  // focus overlay trims stay rows.
  const traced = labelsToPolygons(merged, w, h, eps, 4, redo).map(({ poly, label }) => (isNew.has(label)
    ? { poly, row: false, ...tag }
    : { poly, row: !!baseShards[origin[label]]?.row }));
  const grownNew = new Set([...grown].map((l) => origin[l] - ROW));
  const given = polys ? polys.filter((_, k) => !grownNew.has(k)).map((poly) => ({ poly, row: false, ...tag })) : [];
  return intact.concat(traced, given);
}

// The guide list can also hold eraser strokes, { erase: [[u, v], ...],
// radius } in normalised coordinates (radius a fraction of the long side).
// A stroke removes the lines it touches: drawn lines made before it, and any
// automatic line. Returns the drawn lines kept, in working pixels, and a
// test for automatic ones. Erasing removes a line whole.
export function eraseGuides(list, w, h, edges = null, p = {}) {
  const L = Math.max(w, h);
  const strokes = (list ?? []).map((g, i) => g.erase && { i, r: g.radius * L, pts: g.erase.map(([u, v]) => [u * w, v * h]) });
  // Measured to the line's segments, so a line with far-apart vertices is
  // touched along its whole length.
  const near = (line, ex, ey, r) => line.some(([ax, ay], i) => {
    const [bx, by] = line[i + 1] ?? line[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const k = l2 ? Math.min(1, Math.max(0, ((ex - ax) * dx + (ey - ay) * dy) / l2)) : 0;
    return (ex - ax - k * dx) ** 2 + (ey - ay - k * dy) ** 2 <= r * r;
  });
  const touches = (line, s) => s.pts.some(([ex, ey]) => near(line, ex, ey, s.r));
  const after = (i) => strokes.filter((s) => s && s.i > i);
  const drawn = (list ?? []).flatMap((g, i) => {
    if (g.erase) return [];
    const [line] = drawnGuides([g], w, h, edges, p);
    return line && !after(i).some((s) => touches(line, s)) ? [line] : [];
  });
  const all = after(-1);
  return { drawn, keep: (line) => !all.some((s) => touches(line, s)) };
}


// Hand-drawn guides arrive in normalised coordinates, either as a list of
// points (freehand) or { points, mode, snap }. Freehand strokes are
// smoothed to take the shake out; "points" lines keep their straight
// segments. With snap, every point moves to the strongest edge within a few
// pixels across the line, so passing near a contour is enough.
export function drawnGuides(list, w, h, edges = null, p = {}) {
  return (list ?? []).map((entry) => {
    const g = Array.isArray(entry) ? { points: entry, mode: 'free', snap: false } : entry;
    let line = g.points.map(([u, v]) => [u * w, v * h]);
    if (line.length < 2) return null;
    // snapRadius is a fraction of the image's long side (set with the wheel).
    const R = g.snapRadius ? g.snapRadius * Math.max(w, h) : Math.max(6, 0.8 * (p.sMin ?? 7));
    if (g.mode === 'points') {
      // Only the vertices snap, so the segments between them stay straight.
      if (g.snap && edges) line = line.map((q) => snapPoint(q, edges, R));
      return resample(line, 3);
    }
    line = smoothChain(resample(line, 1.5));
    if (g.snap && edges) line = smoothChain(snapToEdges(line, edges, R));
    return line;
  }).filter(Boolean);
}

// Bilinear sample of the scaled edge magnitude.
function edgeAt(edges, x, y) {
  const { w, h, mag } = edges;
  const xi = Math.min(w - 2, Math.max(0, Math.floor(x - 0.5))), yi = Math.min(h - 2, Math.max(0, Math.floor(y - 0.5)));
  const tx = Math.min(1, Math.max(0, x - 0.5 - xi)), ty = Math.min(1, Math.max(0, y - 0.5 - yi));
  const i = yi * w + xi;
  return (mag[i] * (1 - tx) + mag[i + 1] * tx) * (1 - ty) + (mag[i + w] * (1 - tx) + mag[i + w + 1] * tx) * ty;
}

// The strongest edge within radius R of a point (nearer ones win ties).
function snapPoint([x, y], edges, R) {
  const step = Math.max(0.5, R / 30);
  let best = [x, y], score = 0.2;
  for (let dy = -R; dy <= R; dy += step) {
    for (let dx = -R; dx <= R; dx += step) {
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      const m = edgeAt(edges, x + dx, y + dy) - (0.06 * d) / R;
      if (m > score) { score = m; best = [x + dx, y + dy]; }
    }
  }
  return best;
}

function snapToEdges(line, edges, R) {
  const at = (x, y) => edgeAt(edges, x, y);
  const normals = line.map((_, i) => {
    const a = line[Math.max(0, i - 2)], b = line[Math.min(line.length - 1, i + 2)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  });
  // Best shift across the line at every point (nearer edges win ties), then
  // smoothed along it so neighbouring points don't jump to different edges.
  const shift = line.map(([x, y], i) => {
    const [nx, ny] = normals[i];
    let best = 0, score = -Infinity;
    for (let t = -R; t <= R; t += Math.max(0.5, R / 40)) {
      const m = at(x + nx * t, y + ny * t) - (0.06 * Math.abs(t)) / R;
      if (m > score) { score = m; best = t; }
    }
    return score > 0.2 ? best : 0;
  });
  // A wider search means more chances of jumping between texture edges, so
  // the shifts are averaged over more points.
  const win = Math.max(3, Math.round(R / 3));
  return line.map(([x, y], i) => {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - win); k <= Math.min(line.length - 1, i + win); k++) { s += shift[k]; c++; }
    const t = s / c;
    return [x + normals[i][0] * t, y + normals[i][1] * t];
  });
}

// Put drawn and automatic guides together so their rows don't pile up:
// drawn lines go first and are kept whole; automatic ones, longest first,
// lose the stretches that run inside a band already taken (and are split
// there, ending just inside it). Then each drawn end close to an automatic
// line is pulled onto it, so the two join.
export function combineGuides(drawn, auto, w, h, p, size) {
  const sizeAt = (x, y) => size[Math.min(h - 1, Math.max(0, y | 0)) * w + Math.min(w - 1, Math.max(0, x | 0))];
  const half = (x, y) => (Math.round(p.rowCount) * p.rowScale * sizeAt(x, y)) / 2;
  const taken = new Uint8Array(w * h);
  const stamp = (g) => {
    for (const [x, y] of g) {
      const r = 1.1 * half(x, y) + 1;
      for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(h - 1, Math.ceil(y + r)); yy++) {
        for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(w - 1, Math.ceil(x + r)); xx++) {
          if ((xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r) taken[yy * w + xx] = 1;
        }
      }
    }
  };
  const isTaken = ([x, y]) => taken[Math.min(h - 1, Math.max(0, y | 0)) * w + Math.min(w - 1, Math.max(0, x | 0))] === 1;

  const lines = drawn.filter((g) => g.length > 1).map((g) => resample(g, 3));
  lines.forEach(stamp);
  const nDrawn = lines.length;

  const autos = auto.map((g) => resample(g, 3)).map((g) => [g, chainLength(g)]).sort((a, b) => b[1] - a[1]);
  for (const [g] of autos) {
    const runs = [];
    let run = null;
    g.forEach((pt, i) => {
      if (!isTaken(pt)) {
        // Start one point back, inside the band it comes from, so it touches.
        if (!run) run = i > 0 ? [g[i - 1]] : [];
        run.push(pt);
      } else if (run) {
        run.push(pt);
        runs.push(run);
        run = null;
      }
    });
    if (run) runs.push(run);
    // A guide nothing cut is kept whole, however short next to its rows.
    // Pieces left over from a cut need room for at least one row piece.
    const uncut = runs.length === 1 && runs[0].length >= g.length;
    const pieceLength = (r) => {
      const [x, y] = r[Math.floor(r.length / 2)];
      return p.rowLength * p.rowScale * sizeAt(x, y);
    };
    const accepted = runs.filter((r) => r.length > 1 && (uncut || chainLength(r) >= pieceLength(r)));
    for (const r of accepted) { lines.push(r); stamp(r); }
  }

  // Pull drawn ends onto a nearby automatic line.
  for (let i = 0; i < nDrawn; i++) {
    const g = lines[i];
    for (const end of [0, g.length - 1]) {
      const [ex, ey] = g[end];
      const reachR = 3 * half(ex, ey);
      let best = null, bd = reachR;
      for (let j = nDrawn; j < lines.length; j++) {
        for (const q of lines[j]) {
          const d = Math.hypot(q[0] - ex, q[1] - ey);
          if (d < bd) { bd = d; best = q; }
        }
      }
      if (best && bd > 1) {
        if (end === 0) g.unshift([best[0], best[1]]);
        else g.push([best[0], best[1]]);
      }
    }
  }
  return lines;
}
