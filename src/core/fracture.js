import { sample } from './analysis.js';
import { area, bbox, centroid, elongation, minAngle, pointInPolygon, splitByLine } from './polygon.js';

const SAMPLES = 96;
const MIN_SAMPLES = 24;

// Recursive fracture: keep cutting pieces with straight lines until they are
// as small as the size field asks for. Each cut is picked from N candidate
// lines with a softmax over their cost at temperature T:
//   cost = colour variance left in the two halves (normalised by the parent)
//        + lambda * sliver penalty
// T -> 0 cuts along image contours (faithful); large T cuts at random (abstract).
//
// opts.forced: per-input-polygon number of cuts to make regardless of size
// (used by the hybrid mode). opts.bySize: whether the size criterion applies.
export function fracture(inputs, img, lab, an, p, rng, opts = {}) {
  const { w, h } = img;
  const bySize = opts.bySize ?? true;
  const out = [];
  const queue = inputs.map((P, i) => ({
    P,
    samples: drawSamples(P, w, h, SAMPLES, rng),
    depth: 0,
    forced: opts.forced ? opts.forced[i] : 0,
  }));
  const maxPieces = 60000;

  while (queue.length) {
    const item = queue.pop();
    const { P, samples, depth } = item;
    const A = area(P);
    let split = false;
    if (item.forced > 0) split = A > 4 * p.sMin * p.sMin;
    else if (bySize) split = A > p.kappa * targetSize(samples, an) ** 2 && A > 3;
    if (!split || depth > 40 || out.length + queue.length > maxPieces || samples.length < 2) {
      out.push({ poly: P, depth });
      continue;
    }
    const cut = chooseCut(P, A, samples, lab, an, p, rng);
    if (!cut) {
      out.push({ poly: P, depth });
      continue;
    }
    for (const side of [0, 1]) {
      const child = cut.children[side];
      let s = cut.parts[side];
      if (s.length < MIN_SAMPLES) s = s.concat(drawSamples(child, w, h, MIN_SAMPLES - s.length, rng));
      queue.push({ P: child, samples: s, depth: depth + 1, forced: Math.max(0, item.forced - 1) });
    }
  }
  return out;
}

function targetSize(samples, an) {
  const v = samples.map((q) => an.size[q]).sort((a, b) => a - b);
  return v[Math.floor(v.length * 0.2)];
}

function drawSamples(P, w, h, n, rng) {
  const [x0, y0, x1, y1] = bbox(P);
  const out = [];
  for (let t = 0; t < n * 6 && out.length < n; t++) {
    const x = x0 + rng() * (x1 - x0), y = y0 + rng() * (y1 - y0);
    if (!pointInPolygon(P, x, y)) continue;
    const xi = Math.min(w - 1, x | 0), yi = Math.min(h - 1, y | 0);
    out.push(yi * w + xi);
  }
  return out;
}

function sse(idx, lab) {
  let s0 = 0, s1 = 0, s2 = 0, q = 0;
  for (const i of idx) {
    const L = lab[i * 3], a = lab[i * 3 + 1], b = lab[i * 3 + 2];
    s0 += L; s1 += a; s2 += b;
    q += L * L + a * a + b * b;
  }
  const n = idx.length || 1;
  return q - (s0 * s0 + s1 * s1 + s2 * s2) / n;
}

// `thick` is how far the child reaches from the cut line, `target` the piece
// size wanted here: a child thinner than half a piece is a sliver however
// regular its outline looks.
function sliverPenalty(P, parentArea, thick, target) {
  const e = elongation(P);
  const ang = minAngle(P);
  const frac = area(P) / parentArea;
  const thin = Math.max(0, 1 - thick / (0.5 * target));
  return Math.max(0, e - 1.8) * 0.5 + Math.max(0, 0.4 - ang) * 2.5 + Math.max(0, 0.12 - frac) * 6 + 3 * thin * thin;
}

// Largest distance from the line through (px, py) with normal n to P.
function reach(P, px, py, nx, ny) {
  let m = 0;
  for (const [x, y] of P) m = Math.max(m, Math.abs((x - px) * nx + (y - py) * ny));
  return m;
}

function chooseCut(P, A, samples, lab, an, p, rng) {
  const { w, theta, coherence } = an;
  const [cx, cy] = centroid(P);

  // Principal axes of the piece from its samples.
  let mx = 0, my = 0;
  for (const i of samples) { mx += (i % w) + 0.5; my += Math.floor(i / w) + 0.5; }
  mx /= samples.length; my /= samples.length;
  let sxx = 0, sxy = 0, syy = 0;
  for (const i of samples) {
    const dx = (i % w) + 0.5 - mx, dy = Math.floor(i / w) + 0.5 - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const longAxis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tr = (sxx + syy) / samples.length;
  const det = (sxx * syy - sxy * sxy) / samples.length ** 2;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const sdL = Math.sqrt(Math.max(1e-6, tr / 2 + disc)), sdS = Math.sqrt(Math.max(1e-6, tr / 2 - disc));
  const eL = [Math.cos(longAxis), Math.sin(longAxis)], eS = [-eL[1], eL[0]];

  const parentVar = sse(samples, lab) / samples.length;
  const noise = (p.angleNoise * Math.PI) / 180;
  const target = targetSize(samples, an);
  const cands = [];
  const N = Math.max(1, Math.round(p.candidates));
  // At least a third of the candidates cut across the piece's long axis, so
  // a piece never has only edge-parallel cuts (all slivers) to choose from.
  const across = Math.ceil(N / 3);
  for (let c = 0; c < N; c++) {
    const u = (rng() * 2 - 1) * p.cutJitter * 2, v = (rng() * 2 - 1) * p.cutJitter * 2;
    const px = cx + u * sdL * eL[0] + v * sdS * eS[0];
    const py = cy + u * sdL * eL[1] + v * sdS * eS[1];
    let dir;
    const coh = sample(coherence, an.w, an.h, px, py);
    if (c >= across && rng() < p.edgeAlign * Math.min(1, coh * 2)) dir = sample(theta, an.w, an.h, px, py);
    else dir = longAxis + Math.PI / 2;
    dir += (rng() * 2 - 1) * noise;
    const nx = -Math.sin(dir), ny = Math.cos(dir);
    const children = splitByLine(P, px, py, nx, ny);
    if (children[0].length < 3 || children[1].length < 3) continue;
    const a0 = area(children[0]), a1 = area(children[1]);
    if (a0 < 1 || a1 < 1) continue;
    const t0 = reach(children[0], px, py, nx, ny), t1 = reach(children[1], px, py, nx, ny);
    // Never cut off a strip thinner than a fifth of a piece.
    if (Math.min(t0, t1) < 0.2 * target) continue;
    const parts = [[], []];
    for (const i of samples) {
      const d = ((i % w) + 0.5 - px) * nx + (Math.floor(i / w) + 0.5 - py) * ny;
      parts[d >= 0 ? 0 : 1].push(i);
    }
    if (!parts[0].length || !parts[1].length) continue;
    const v0 = sse(parts[0], lab) / parts[0].length, v1 = sse(parts[1], lab) / parts[1].length;
    const fit = (v0 * a0 + v1 * a1) / (parentVar * A + 1e-6);
    const cost = fit + p.sliver * (sliverPenalty(children[0], A, t0, target) + sliverPenalty(children[1], A, t1, target));
    cands.push({ cost, children, parts });
  }
  if (!cands.length) return null;

  const T = Math.max(1e-4, p.temperature);
  const cmin = Math.min(...cands.map((c) => c.cost));
  const wts = cands.map((c) => Math.exp(-(c.cost - cmin) / T));
  let r = rng() * wts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cands.length; i++) {
    r -= wts[i];
    if (r <= 0) return cands[i];
  }
  return cands[cands.length - 1];
}
