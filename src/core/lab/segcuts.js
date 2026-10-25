// LAB SPIKE (?lab): pieces that straddle the border between two objects the
// segmentation model found are cut in two with a straight line along that
// border, as a tiler would trim a tile to fit. Works on any method's pieces.
import { area, rasterize, splitByLine } from '../polygon.js';

const ANGLES = 24;

// `seg` is { w, h, labels } (see segguides.js); `shards` in working pixels
// (w x h). A piece is cut when its second object covers at least `minShare`
// of it and the cut leaves both halves at least `minPart` sizes of the
// smallest piece squared. Each half is checked again, up to `depth` cuts.
export function cutBySegments(shards, seg, w, h, p, { minShare = 0.12, minPart = 0.3, depth = 3 } = {}) {
  if (!seg) return shards;
  const sx = seg.w / w, sy = seg.h / h;
  const at = (x, y) => seg.labels[Math.min(seg.h - 1, Math.floor((y + 0.5) * sy)) * seg.w + Math.min(seg.w - 1, Math.floor((x + 0.5) * sx))];
  const minArea = minPart * p.sMin * p.sMin;
  // A cut piece keeps its slot with one half and the other halves go at the
  // end, so the colour stage (random jitter in piece order) gives every
  // uncut piece the same colour as without cuts.
  const out = [], extra = [];
  const visit = (shard, left, list) => {
    const cut = left > 0 ? bestCut(shard.poly, w, h, at, minShare, minArea) : null;
    if (!cut) {
      list.push(shard);
      return;
    }
    visit({ ...shard, poly: cut[0] }, left - 1, list);
    visit({ ...shard, poly: cut[1] }, left - 1, extra);
  };
  for (const s of shards) visit(s, depth, out);
  return out.concat(extra);
}

// The straight line that best separates the two main objects inside P, or
// null when P is (nearly) one object or no line helps enough.
function bestCut(P, w, h, at, minShare, minArea) {
  const xs = [], ys = [], ls = [];
  rasterize(P, w, h, (x, y) => {
    xs.push(x + 0.5);
    ys.push(y + 0.5);
    ls.push(at(x, y));
  });
  const n = ls.length;
  if (n < 2 * minArea) return null;
  const counts = new Map();
  for (const l of ls) counts.set(l, (counts.get(l) ?? 0) + 1);
  const [[a], [b, nb] = [null, 0]] = [...counts].sort((u, v) => v[1] - u[1]);
  if (nb < minShare * n) return null;

  // For each direction, sort the pixels along the normal and sweep the
  // threshold: errors = pixels of a on the far side + pixels of b on the
  // near side (others count as neither), trying both orientations.
  let best = null;
  const order = new Int32Array(n), proj = new Float64Array(n);
  for (let k = 0; k < ANGLES; k++) {
    const t = (k / ANGLES) * Math.PI, nx = Math.cos(t), ny = Math.sin(t);
    for (let i = 0; i < n; i++) {
      order[i] = i;
      proj[i] = xs[i] * nx + ys[i] * ny;
    }
    order.sort((i, j) => proj[i] - proj[j]);
    const na = counts.get(a);
    // Before position i: aBefore, bBefore. Option 1: a below, b above.
    let aBefore = 0, bBefore = 0;
    for (let i = 1; i < n; i++) {
      const l = ls[order[i - 1]];
      if (l === a) aBefore++;
      else if (l === b) bBefore++;
      if (i < minArea || n - i < minArea) continue;
      if (proj[order[i]] - proj[order[i - 1]] < 1e-9) continue;
      const e1 = (na - aBefore) + bBefore, e2 = aBefore + (nb - bBefore);
      const err = Math.min(e1, e2);
      if (!best || err < best.err) best = { err, nx, ny, c: (proj[order[i]] + proj[order[i - 1]]) / 2 };
    }
  }
  // Worth it only if the cut puts at least two thirds of the minority on
  // its own side.
  if (!best || best.err > nb / 3) return null;
  const halves = splitByLine(P, best.nx * best.c, best.ny * best.c, best.nx, best.ny);
  if (halves.some((q) => q.length < 3 || area(q) < minArea)) return null;
  return halves;
}
