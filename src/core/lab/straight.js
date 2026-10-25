// LAB SPIKE (?lab), second try: colour parts turned into straight-edged,
// convex pieces.
//
// 1. The borders between parts form a network. Corners where three or more
//    parts meet (junctions) stay fixed, and each border between two
//    junctions is straightened once, so both neighbours share the same edge.
// 2. Points along those borders and evenly inside the parts are triangulated
//    (Delaunay) and the triangles of each part merged back into convex
//    pieces while they stay convex and no bigger than a piece
//    (Hertel-Mehlhorn), so piece edges run along the borders.
import { Delaunay } from 'd3-delaunay';
import { poissonVariable } from '../sampling.js';
import { area, centroid, signedArea } from '../polygon.js';

// One polygon per part label (labels >= 0); -1 is outside (the background).
// Returns [{ label, outer, holes }] with straightened rings in pixel corners.
export function straightParts(labels, w, h, count, eps) {
  const W = w + 1;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -2 : labels[y * w + x]);
  // Junctions: corners touched by three or more labels (outside the image
  // counts as one), plus the image corners.
  const junction = new Uint8Array(W * (h + 1));
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) {
      const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x - 1, y), d = at(x, y);
      const n = 1 + (b !== a) + (c !== a && c !== b) + (d !== a && d !== b && d !== c);
      if (n >= 3) junction[y * W + x] = 1;
    }
  }
  for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) junction[y * W + x] = 1;

  const boxes = labelBoxes(labels, w, h, count);
  const cache = new Map();
  const out = [];
  for (let l = 0; l < count; l++) {
    if (!boxes[l]) continue;
    const loops = traceLoops(labels, w, h, l, boxes[l]);
    if (!loops.length) continue;
    const rings = loops.map((ring) => straightenRing(ring, junction, W, eps, cache)).filter((r) => r.length >= 3);
    if (!rings.length) continue;
    rings.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    out.push({ label: l, outer: rings[0], holes: rings.slice(1) });
  }
  return out;
}

function labelBoxes(labels, w, h, count) {
  const boxes = new Array(count).fill(null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      if (l < 0) continue;
      const b = boxes[l];
      if (!b) boxes[l] = [x, y, x, y];
      else {
        if (x < b[0]) b[0] = x;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
      }
    }
  }
  return boxes;
}

// Every boundary loop of label l, as corner ids (y * (w + 1) + x).
function traceLoops(labels, w, h, l, [xa, ya, xb, yb]) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === l;
  const W = w + 1;
  const next = new Map();
  const add = (ax, ay, bx, by) => {
    const k = ay * W + ax, v = by * W + bx;
    const list = next.get(k);
    if (list) list.push(v);
    else next.set(k, [v]);
  };
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const start of next.keys()) {
    while (next.get(start)?.length) {
      const ring = [];
      let cur = start, guard = 0;
      do {
        const list = next.get(cur);
        if (!list?.length) break;
        ring.push(cur);
        cur = list.pop();
      } while (cur !== start && ++guard < 1e7);
      if (ring.length >= 4) loops.push(ring);
    }
  }
  return loops;
}

// Replaces each run between junctions by its Douglas-Peucker simplification,
// computed once per border in a canonical direction so both sides agree.
function straightenRing(ring, junction, W, eps, cache) {
  const n = ring.length;
  let fixed = [];
  for (let i = 0; i < n; i++) if (junction[ring[i]]) fixed.push(i);
  if (!fixed.length) {
    // A loop with no junction (an island): fix its lowest corner and the
    // corner farthest from it, which both sides find the same way.
    let a = 0;
    for (let i = 1; i < n; i++) if (ring[i] < ring[a]) a = i;
    const [ax, ay] = [ring[a] % W, (ring[a] / W) | 0];
    let b = a, bd = -1;
    for (let i = 0; i < n; i++) {
      const d = (ring[i] % W - ax) ** 2 + (((ring[i] / W) | 0) - ay) ** 2;
      if (d > bd) { bd = d; b = i; }
    }
    fixed = [a, b].sort((p, q) => p - q);
  }
  const pts = [];
  for (let k = 0; k < fixed.length; k++) {
    const i0 = fixed[k], i1 = fixed[(k + 1) % fixed.length];
    const len = ((i1 - i0 + n - 1) % n) + 1;
    const run = [];
    for (let j = 0; j <= len; j++) run.push(ring[(i0 + j) % n]);
    const s = simplifyRun(run, W, eps, cache);
    for (let j = 0; j < s.length - 1; j++) pts.push(s[j]);
  }
  return pts;
}

function simplifyRun(run, W, eps, cache) {
  const a = run[0], b = run[run.length - 1];
  const flip = a > b || (a === b && run[1] > run[run.length - 2]);
  const canon = flip ? run.slice().reverse() : run;
  const key = `${canon[0]},${canon[1]},${canon[canon.length - 1]}`;
  let s = cache.get(key);
  if (!s) {
    s = dp(canon.map((c) => [c % W, (c / W) | 0]), eps);
    cache.set(key, s);
  }
  return flip ? s.slice().reverse() : s;
}

function dp(pts, eps) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
  let idx = -1, md = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = len > 1e-9
      ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len
      : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
    if (d > md) { md = d; idx = i; }
  }
  if (md <= eps) return [pts[0], pts[pts.length - 1]];
  const l = dp(pts.slice(0, idx + 1), eps);
  return l.slice(0, -1).concat(dp(pts.slice(idx), eps));
}

// Joins two positively oriented cycles that share the edge u-v.
function mergeCycles(A, B, u, v) {
  const rot = (C, a, b) => {
    // C rotated to start at b and end at a, where C has ...a, b... in order.
    const n = C.length;
    for (let i = 0; i < n; i++) {
      if (C[i] === a && C[(i + 1) % n] === b) return Array.from({ length: n }, (_, j) => C[(i + 1 + j) % n]);
    }
    return null;
  };
  let a = rot(A, u, v), b = rot(B, v, u);
  if (!a || !b) {
    a = rot(A, v, u);
    b = rot(B, u, v);
    if (!a || !b) return null;
  }
  // a runs from one shared vertex to the other; b too, the other way round.
  return a.concat(b.slice(1, -1));
}

function isConvex(P) {
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], c = P[(i + 2) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-6) return false;
  }
  return true;
}

// Straight, convex pieces for every part of `labels`, as shards tagged
// { intent: true }. Points go along the straightened borders and, evenly
// spaced, inside the parts; their Delaunay triangles (fat, unlike a
// triangulation of the outline alone) are given to the part under their
// centre and merged into convex pieces of about the local piece size.
// One triangulation for the whole image, so the pieces leave no gaps.
export function straightPieces(labels, count, img, lab, an, p, rng) {
  const { w, h } = an;
  const sizeAt = (x, y) => an.size[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))] * p.intentScale;
  const parts = straightParts(labels, w, h, count, p.intentStraight);

  // Border points: the straightened corners, plus points along long edges.
  const pts = [], seen = new Set();
  const add = (x, y) => {
    const k = Math.round(x * 4) * 65536 + Math.round(y * 4);
    if (seen.has(k)) return;
    seen.add(k);
    pts.push([x, y]);
  };
  for (const { outer, holes } of parts) {
    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % ring.length];
        const step = 0.45 * sizeAt((ax + bx) / 2, (ay + by) / 2);
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
        for (let j = 0; j < n; j++) add(ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n);
      }
    }
  }
  // Interior points, kept away from the borders so triangles follow them.
  const cell = 4, gw = Math.ceil(w / cell) + 1;
  const grid = new Map();
  for (const [x, y] of pts) {
    const k = Math.floor(y / cell) * gw + Math.floor(x / cell);
    const list = grid.get(k);
    if (list) list.push([x, y]);
    else grid.set(k, [[x, y]]);
  }
  const nearBorder = (x, y, r) => {
    const R = Math.ceil(r / cell), cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let j = cy - R; j <= cy + R; j++) {
      for (let i = cx - R; i <= cx + R; i++) {
        for (const [bx, by] of grid.get(j * gw + i) ?? []) if ((bx - x) ** 2 + (by - y) ** 2 < r * r) return true;
      }
    }
    return false;
  };
  const scaled = { ...an, size: an.size.map((v) => v * p.intentScale) };
  for (const [x, y] of poissonVariable(scaled, 0.75, rng)) {
    const l = labels[Math.min(h - 1, Math.floor(y)) * w + Math.min(w - 1, Math.floor(x))];
    if (l >= 0 && !nearBorder(x, y, 0.35 * sizeAt(x, y))) pts.push([x, y]);
  }

  const del = Delaunay.from(pts);
  const { triangles, halfedges } = del;
  const nt = triangles.length / 3;
  const label = new Int32Array(nt);
  const cycles = new Array(nt);
  for (let t = 0; t < nt; t++) {
    const c = [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
    const cx = (pts[c[0]][0] + pts[c[1]][0] + pts[c[2]][0]) / 3, cy = (pts[c[0]][1] + pts[c[1]][1] + pts[c[2]][1]) / 3;
    label[t] = labels[Math.min(h - 1, Math.floor(cy)) * w + Math.min(w - 1, Math.floor(cx))];
    cycles[t] = signedArea(c.map((i) => pts[i])) < 0 ? [c[0], c[2], c[1]] : c;
  }
  const parent = Int32Array.from({ length: nt }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const diags = [];
  for (let e = 0; e < halfedges.length; e++) {
    const o = halfedges[e];
    if (o < e) continue;
    const t1 = Math.floor(e / 3), t2 = Math.floor(o / 3);
    if (label[t1] < 0 || label[t1] !== label[t2]) continue;
    const u = triangles[e], v = triangles[e % 3 === 2 ? e - 2 : e + 1];
    diags.push({ u, v, t1, t2, len: Math.hypot(pts[u][0] - pts[v][0], pts[u][1] - pts[v][1]) });
  }
  diags.sort((a, b) => b.len - a.len);
  for (const { u, v, t1, t2 } of diags) {
    const r1 = find(t1), r2 = find(t2);
    if (r1 === r2) continue;
    const merged = mergeCycles(cycles[r1], cycles[r2], u, v);
    if (!merged) continue;
    const poly = merged.map((i) => pts[i]);
    const [cx, cy] = centroid(poly);
    if (!isConvex(poly) || area(poly) > p.kappa * sizeAt(cx, cy) ** 2) continue;
    parent[r2] = r1;
    cycles[r1] = merged;
  }
  const out = [];
  for (let t = 0; t < nt; t++) {
    if (label[t] < 0 || find(t) !== t) continue;
    out.push({ poly: dropStraight(cycles[t].map((i) => pts[i])), row: false, intent: true });
  }
  return out;
}

// Removes vertices that lie on a straight edge (from the border points).
function dropStraight(P) {
  const out = P.filter((b, i) => {
    const a = P[(i + P.length - 1) % P.length], c = P[(i + 1) % P.length];
    return Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-6;
  });
  return out.length >= 3 ? out : P;
}
