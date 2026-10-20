import { mortarRgb } from './color.js';
import { placePolygon, placementRandoms } from './placement.js';
import { area, rasterize } from './polygon.js';
import { hash2, mulberry32 } from './rng.js';

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher).
// f[i] is 0 at feature pixels and Infinity elsewhere; returns distances.
export function distanceTransform(f, w, h) {
  const BIG = 1e20;
  const d = new Float64Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = f[i] === Infinity ? BIG : f[i];
  const n = Math.max(w, h);
  const g = new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  const dt1d = (len) => {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (g[q] + q * q - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (z[k + 1] < q) k++;
      r[q] = (q - v[k]) ** 2 + g[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let q = 0; q < h; q++) g[q] = d[q * w + x];
    dt1d(h);
    for (let q = 0; q < h; q++) d[q * w + x] = r[q];
  }
  for (let y = 0; y < h; y++) {
    for (let q = 0; q < w; q++) g[q] = d[y * w + q];
    dt1d(w);
    for (let q = 0; q < w; q++) d[y * w + q] = r[q];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) out[i] = Math.sqrt(d[i]);
  return out;
}

// Final image: grout lines, per-shard glaze tilt, bevelled edges and a
// Blinn-Phong highlight. Rendered at outLong * supersample and box-filtered down.
export function renderMosaic(shards, colors, w, h, p) {
  const ss = Math.max(1, Math.round(p.supersample));
  const scale = p.outLong / Math.max(w, h);
  const W = Math.round(w * scale * ss), H = Math.round(h * scale * ss);
  const k = scale * ss;

  const labels = new Int32Array(W * H).fill(-1);
  // Largest first, so a region enclosed by another (a crack loop) paints on top.
  // Rows last, so they stay on top whatever their size.
  const order = shards.map((s, id) => [area(s.poly), id, s.row ? 1 : 0]).sort((a, b) => a[2] - b[2] || b[0] - a[0]);
  const rand = placementRandoms(shards.length, p.seed);
  for (const [, id] of order) {
    const poly = shards[id].row ? shards[id].poly : placePolygon(shards[id].poly, rand[id], p.place ?? 0);
    rasterize(poly, W, H, (x, y) => { labels[y * W + x] = id; }, k);
  }

  const f = new Float32Array(W * H).fill(Infinity);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, l = labels[i];
      if (l < 0) { f[i] = 0; continue; }
      if (x + 1 < W && labels[i + 1] !== l) { f[i] = 0; f[i + 1] = 0; }
      if (y + 1 < H && labels[i + W] !== l) { f[i] = 0; f[i + W] = 0; }
    }
  }
  const dist = distanceTransform(f, W, H);

  const gBase = (p.grout * k) / 2;
  const bw = Math.max(1e-3, p.bevel * k);
  const mortar = mortarRgb(p);
  const az = (p.lightAz * Math.PI) / 180, el = (p.lightEl * Math.PI) / 180;
  const L = [Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), Math.sin(el)];
  const Hv = norm([L[0], L[1], L[2] + 1]);
  const rng = mulberry32(p.seed * 7919 + 13);
  const tilt = shards.map((s) => {
    const k = s.row ? 0.5 * p.tilt : p.tilt;
    return [rng.normal() * k, rng.normal() * k];
  });
  const noiseCell = Math.max(1, Math.round(ss * 1.5));

  const hi = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x, l = labels[i], d = dist[i];
      const g = l >= 0 && shards[l].row ? gBase * (p.rowGrout ?? 1) : gBase;
      const grain = hash2((x / noiseCell) | 0, (y / noiseCell) | 0, p.seed) - 0.5;
      if (l < 0 || d <= g) {
        const shade = (1 - p.groutShadow * (g > 0 ? Math.min(1, d / g) : 0) * 0.6) * (1 + grain * 0.12);
        hi[i * 3] = mortar[0] * shade; hi[i * 3 + 1] = mortar[1] * shade; hi[i * 3 + 2] = mortar[2] * shade;
        continue;
      }
      const di = d - g;
      let nx = tilt[l][0], ny = tilt[l][1];
      let edgeShade = 1;
      if (di < bw) {
        // The distance field's gradient points away from the shard edge.
        const gx = dist[y * W + Math.min(W - 1, x + 1)] - dist[y * W + Math.max(0, x - 1)];
        const gy = dist[Math.min(H - 1, y + 1) * W + x] - dist[Math.max(0, y - 1) * W + x];
        const gl = Math.hypot(gx, gy) || 1;
        const t = (1 - di / bw) ** 2 * p.bevelStrength;
        nx -= (gx / gl) * t;
        ny -= (gy / gl) * t;
        edgeShade = 1 - 0.15 * t;
      }
      const n = norm([nx, ny, 1]);
      const ndl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
      const light = (p.ambient + (1 - p.ambient) * (ndl / Math.max(0.15, L[2]))) * edgeShade;
      const spec = p.specular * Math.max(0, n[0] * Hv[0] + n[1] * Hv[1] + n[2] * Hv[2]) ** p.shininess;
      const glaze = 1 + grain * p.glazeNoise * 2;
      for (let c = 0; c < 3; c++) hi[i * 3 + c] = colors[l * 3 + c] * light * glaze + spec;
    }
  }

  const ow = Math.floor(W / ss), oh = Math.floor(H / ss);
  const out = new Uint8ClampedArray(ow * oh * 4);
  const inv = 1 / (ss * ss);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let r = 0, gg = 0, b = 0;
      for (let j = 0; j < ss; j++) {
        for (let q = 0; q < ss; q++) {
          const i = ((y * ss + j) * W + x * ss + q) * 3;
          r += hi[i]; gg += hi[i + 1]; b += hi[i + 2];
        }
      }
      const o = (y * ow + x) * 4;
      out[o] = r * inv * 255; out[o + 1] = gg * inv * 255; out[o + 2] = b * inv * 255; out[o + 3] = 255;
    }
  }
  return { width: ow, height: oh, data: out };
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
