import { Delaunay } from 'd3-delaunay';
import { sample } from './analysis.js';

// Bridson's Poisson-disk sampling with a variable radius. Two seeds p, q are
// kept at least spacing * (s(p) + s(q)) / 2 apart, so the local spacing follows
// the size field s(x).
export function poissonVariable(an, spacing, rng, maxPoints = 40000) {
  const { w, h, size } = an;
  let rMin = Infinity, rMax = 0;
  for (let i = 0; i < size.length; i++) {
    if (size[i] < rMin) rMin = size[i];
    if (size[i] > rMax) rMax = size[i];
  }
  rMin = Math.max(1, rMin * spacing);
  rMax = Math.max(rMin, rMax * spacing);
  const cell = rMin;
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = Array.from({ length: gw * gh }, () => []);
  const reach = Math.ceil(rMax / cell);
  const pts = [], rad = [];
  const radiusAt = (x, y) => spacing * sample(size, w, h, x, y);

  const fits = (x, y, r) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let j = Math.max(0, cy - reach); j <= Math.min(gh - 1, cy + reach); j++) {
      for (let i = Math.max(0, cx - reach); i <= Math.min(gw - 1, cx + reach); i++) {
        for (const k of grid[j * gw + i]) {
          const need = (r + rad[k]) / 2;
          const dx = pts[k][0] - x, dy = pts[k][1] - y;
          if (dx * dx + dy * dy < need * need) return false;
        }
      }
    }
    return true;
  };
  const add = (x, y, r) => {
    grid[Math.floor(y / cell) * gw + Math.floor(x / cell)].push(pts.length);
    pts.push([x, y]);
    rad.push(r);
    return pts.length - 1;
  };

  const x0 = rng() * w, y0 = rng() * h;
  const active = [add(x0, y0, radiusAt(x0, y0))];
  while (active.length && pts.length < maxPoints) {
    const ai = rng.int(active.length);
    const k = active[ai];
    const [px, py] = pts[k];
    let placed = false;
    for (let t = 0; t < 24; t++) {
      const ang = rng() * 2 * Math.PI;
      const d = rad[k] * (1 + rng());
      const x = px + Math.cos(ang) * d, y = py + Math.sin(ang) * d;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const r = radiusAt(x, y);
      if (fits(x, y, r)) {
        active.push(add(x, y, r));
        placed = true;
        break;
      }
    }
    if (!placed) {
      active[ai] = active[active.length - 1];
      active.pop();
    }
  }
  return pts;
}

// Nearest-seed label for every pixel, walking the Delaunay graph from the
// previous answer so the scan is close to O(pixels).
export function labelIsotropic(seeds, w, h) {
  const d = Delaunay.from(seeds);
  const labels = new Int32Array(w * h);
  let hint = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      hint = d.find(x + 0.5, y + 0.5, hint);
      labels[y * w + x] = hint;
    }
  }
  return labels;
}

// Anisotropic labelling: each seed measures distance in a metric stretched
// along the local edge tangent, so cells elongate along image contours
// (the idea in Hausner 2001). Done by splatting each seed over its
// neighbourhood and keeping the closest seed per pixel.
export function labelAnisotropic(seeds, an, anisotropy) {
  const { w, h, theta, coherence, size } = an;
  const best = new Float32Array(w * h).fill(Infinity);
  const labels = new Int32Array(w * h).fill(-1);
  for (let k = 0; k < seeds.length; k++) {
    const [sx, sy] = seeds[k];
    const t = sample(theta, w, h, sx, sy);
    const a = 1 + anisotropy * sample(coherence, w, h, sx, sy);
    const ct = Math.cos(t), st = Math.sin(t);
    const R = 1.8 * sample(size, w, h, sx, sy) * Math.sqrt(a);
    const xa = Math.max(0, Math.floor(sx - R)), xb = Math.min(w - 1, Math.ceil(sx + R));
    const ya = Math.max(0, Math.floor(sy - R)), yb = Math.min(h - 1, Math.ceil(sy + R));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const dx = x + 0.5 - sx, dy = y + 0.5 - sy;
        const dt = dx * ct + dy * st, dn = -dx * st + dy * ct;
        const d = (dt * dt) / a + dn * dn * a;
        const i = y * w + x;
        if (d < best[i]) {
          best[i] = d;
          labels[i] = k;
        }
      }
    }
  }
  // Pixels no splat reached fall back to the Euclidean nearest seed.
  let missing = false;
  for (let i = 0; i < labels.length && !missing; i++) missing = labels[i] < 0;
  if (missing) {
    const iso = labelIsotropic(seeds, w, h);
    for (let i = 0; i < labels.length; i++) if (labels[i] < 0) labels[i] = iso[i];
  }
  return labels;
}

// Lloyd relaxation: move each seed to the (density-weighted) centroid of its
// cell. With density 1/s(x)^2 this gives a centroidal Voronoi tessellation
// whose cell size follows the size field.
export function lloyd(seeds, an, iterations, weighted, labelFn) {
  const { w, h, size } = an;
  let pts = seeds.map((p) => [p[0], p[1]]);
  for (let it = 0; it < iterations; it++) {
    const labels = labelFn(pts);
    const sx = new Float64Array(pts.length), sy = new Float64Array(pts.length), sw = new Float64Array(pts.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x, k = labels[i];
        const wt = weighted ? 1 / (size[i] * size[i]) : 1;
        sx[k] += (x + 0.5) * wt;
        sy[k] += (y + 0.5) * wt;
        sw[k] += wt;
      }
    }
    pts = pts.map((p, k) => (sw[k] > 0 ? [sx[k] / sw[k], sy[k] / sw[k]] : p));
  }
  return pts;
}
