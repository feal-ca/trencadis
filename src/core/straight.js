// Colour parts of a label image turned into straight-edged polygons. The
// borders between parts form a network: corners where three or more parts
// meet (junctions) stay fixed, and each border between two junctions is
// straightened once, so both neighbours share the same edge.
import { douglasPeucker, signedArea } from './polygon.js';
import { traceLoops } from './polygonize.js';

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
    s = douglasPeucker(canon.map((c) => [c % W, (c / W) | 0]), eps);
    cache.set(key, s);
  }
  return flip ? s.slice().reverse() : s;
}
