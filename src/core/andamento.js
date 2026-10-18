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

// Gradient of the photo, with its magnitude scaled so 1 is a strong edge
// (the 99.5th percentile). Shared by the automatic guides and the snapping
// of drawn ones.
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

// Strong contours of the photo: gradient magnitude, non-maximum
// suppression, hysteresis, then 8-connected chains, joined across small
// gaps, smoothed and resampled. `autoGuides` in [0, 1]: 0 finds nothing,
// 1 many and shorter contours.
export function extractGuides(img, an, p, edges = edgeMap(img, p)) {
  const amount = p.autoGuides ?? 0;
  if (amount <= 0 || !(edges.strong > 0)) return [];
  const { w, h } = img;
  const { gx, gy, mag } = edges;

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

  // Thresholds relative to the strongest edges of the image (mag is scaled
  // so they are 1), so smooth gradients and noise never qualify.
  const hi = 0.55 - 0.4 * amount;
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
  const minLen = p.sMax * (2.5 - 2 * amount);
  const budget = (1 + 5 * amount) * (w + h);
  const chains = bridgeGaps(traceChains(edge, w, h).filter((c) => c.length > 2), Math.max(8, p.sMin))
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

// Join chains whose ends are close and point the same way, so a contour
// broken by a small gap becomes one guide.
export function bridgeGaps(chains, gap) {
  const dir = (c, atEnd) => {
    const k = Math.min(6, c.length - 1);
    const [a, b] = atEnd ? [c[c.length - 1 - k], c[c.length - 1]] : [c[k], c[0]];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const cosMax = Math.cos((35 * Math.PI) / 180);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < chains.length; i++) {
      for (let j = 0; j < chains.length; j++) {
        if (i === j) continue;
        // The end of i against the start of j, or against its end (reversed).
        for (const flip of [false, true]) {
          const b = flip ? chains[j].slice().reverse() : chains[j];
          const e = chains[i][chains[i].length - 1], s0 = b[0];
          const d = Math.hypot(s0[0] - e[0], s0[1] - e[1]);
          if (d > gap) continue;
          const [ux, uy] = dir(chains[i], true);
          const [vx, vy] = dir(b, false);
          // b's start direction points backwards out of b, so it must oppose u.
          if (-(ux * vx + uy * vy) < cosMax) continue;
          if (d > 1 && ((s0[0] - e[0]) * ux + (s0[1] - e[1]) * uy) / d < 0.5) continue;
          chains[i] = chains[i].concat(b);
          chains.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return chains;
}

const chainLength = (c) => c.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - c[i][0], q[1] - c[i][1]), 0);

function smoothChain(c) {
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
    line = g.mode === 'points' ? resample(line, 3) : smoothChain(resample(line, 1.5));
    if (g.snap && edges) {
      line = snapToEdges(line, edges, Math.max(6, 0.8 * (p.sMin ?? 7)));
      if (g.mode !== 'points') line = smoothChain(line);
    }
    return line;
  }).filter(Boolean);
}

function snapToEdges(line, edges, R) {
  const { w, h, mag } = edges;
  const at = (x, y) => {
    const xi = Math.min(w - 2, Math.max(0, Math.floor(x - 0.5))), yi = Math.min(h - 2, Math.max(0, Math.floor(y - 0.5)));
    const tx = Math.min(1, Math.max(0, x - 0.5 - xi)), ty = Math.min(1, Math.max(0, y - 0.5 - yi));
    const i = yi * w + xi;
    return (mag[i] * (1 - tx) + mag[i + 1] * tx) * (1 - ty) + (mag[i + w] * (1 - tx) + mag[i + w + 1] * tx) * ty;
  };
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
    for (let t = -R; t <= R; t += 0.5) {
      const m = at(x + nx * t, y + ny * t) - 0.01 * Math.abs(t);
      if (m > score) { score = m; best = t; }
    }
    return score > 0.2 ? best : 0;
  });
  return line.map(([x, y], i) => {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - 3); k <= Math.min(line.length - 1, i + 3); k++) { s += shift[k]; c++; }
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
    const accepted = runs.filter((r) => r.length > 1 && chainLength(r) >= 4 * half(...r[Math.floor(r.length / 2)]));
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
