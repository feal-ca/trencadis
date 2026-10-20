import { centroid, rasterize, area } from './polygon.js';
import { hslToRgb, labToRgb, rgbToHsl, rgbToLab } from './image.js';

// A plausible set of glazed tiles from a Barcelona workshop around 1900.
export const GAUDI_PALETTE = [
  '#f4f3ee', '#e9ddbf', '#1e4fa0', '#6fa3d6', '#2fa3a0', '#1f6b48',
  '#8a9a3b', '#f1cf3b', '#d39a2c', '#e2702b', '#b5482e', '#9e1f2e',
  '#6b4228', '#23201e', '#8d8c88', '#e3a3a8', '#8f7bb3', '#1d2b4f',
];

export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

// The grout colour to draw with. 'auto' is normally resolved per photo
// before rendering; this fallback covers callers that skip that.
export const mortarRgb = (p) => hexToRgb(/^#[0-9a-f]{6}$/i.test(p.groutColor) ? p.groutColor : '#3a3631');

// Automatic grout: a warm grey well below the photo's median lightness, so the
// pieces read against it. Light cement over a dark photo turns into a lace of
// white lines; this keeps the joints in the photo's own key. `rgba` is the
// photo's pixels (a small thumbnail is enough).
export function autoGroutColor(rgba) {
  const L = [];
  const t = [0, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) L.push(rgbToLab(rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255, t)[0]);
  L.sort((a, b) => a - b);
  const median = L[L.length >> 1] ?? 50;
  const g = Math.min(60, Math.max(10, 0.55 * median));
  return '#' + labToRgb(g, 1, 4).map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

// One colour per shard from the pixels it covers.
export function shardColors(shards, img, p) {
  const { w, h, rgb } = img;
  const out = new Float32Array(shards.length * 3);
  const px = [];
  shards.forEach(({ poly }, k) => {
    px.length = 0;
    rasterize(poly, w, h, (x, y) => px.push(y * w + x));
    if (!px.length) {
      const [cx, cy] = centroid(poly);
      px.push(Math.min(h - 1, Math.max(0, cy | 0)) * w + Math.min(w - 1, Math.max(0, cx | 0)));
    }
    const c = statistic(px, rgb, p.colorMode, poly, w, h);
    let [hu, s, l] = rgbToHsl(c[0], c[1], c[2]);
    s = Math.min(1, s * p.saturation);
    l = Math.min(1, Math.max(0, l + p.lightness));
    // Row pieces can be darker or lighter so the line reads as an outline.
    const strength = p.rowContrast ?? 1;
    if (shards[k].row && p.rowColor === 'dark') l *= 1 - 0.65 * strength;
    else if (shards[k].row && p.rowColor === 'light') l += (1 - l) * 0.6 * strength;
    const r = hslToRgb(hu, s, l);
    out[k * 3] = r[0]; out[k * 3 + 1] = r[1]; out[k * 3 + 2] = r[2];
  });
  return out;
}

function statistic(px, rgb, mode, poly, w, h) {
  const n = px.length;
  if (mode === 'center') {
    const [cx, cy] = centroid(poly);
    const i = Math.min(h - 1, Math.max(0, cy | 0)) * w + Math.min(w - 1, Math.max(0, cx | 0));
    return [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
  }
  if (mode === 'median') {
    return [0, 1, 2].map((ch) => {
      const v = px.map((i) => rgb[i * 3 + ch]).sort((a, b) => a - b);
      return v[n >> 1];
    });
  }
  if (mode === 'dominant') {
    // Mode of a 4-bit-per-channel histogram, then the mean inside that bin.
    const bins = new Map();
    for (const i of px) {
      const key = ((rgb[i * 3] * 15.99) | 0) << 8 | ((rgb[i * 3 + 1] * 15.99) | 0) << 4 | ((rgb[i * 3 + 2] * 15.99) | 0);
      const b = bins.get(key);
      if (b) { b[0] += rgb[i * 3]; b[1] += rgb[i * 3 + 1]; b[2] += rgb[i * 3 + 2]; b[3]++; }
      else bins.set(key, [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], 1]);
    }
    let best = null;
    for (const b of bins.values()) if (!best || b[3] > best[3]) best = b;
    return [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
  }
  let sel = px;
  if (mode === 'vivid') {
    // Mean of the ~30% most saturated pixels: keeps colour that averaging
    // greys out. The cut-off comes from a 64-bin saturation histogram.
    const bin = new Uint8Array(n), hist = new Uint32Array(64);
    for (let k = 0; k < n; k++) {
      const i = px[k];
      const s = Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]) - Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
      hist[(bin[k] = Math.min(63, (s * 64) | 0))]++;
    }
    let cut = 63, acc = hist[63];
    while (cut > 0 && acc < 0.3 * n) acc += hist[--cut];
    sel = px.filter((_, k) => bin[k] >= cut);
  }
  const m = [0, 0, 0];
  for (const i of sel) { m[0] += rgb[i * 3]; m[1] += rgb[i * 3 + 1]; m[2] += rgb[i * 3 + 2]; }
  return m.map((v) => v / sel.length);
}

// Snap shard colours to a palette (k-means on the shards, or the fixed Gaudi
// set), blend toward it by paletteMix, then add per-shard glaze variation.
export function applyPalette(colors, shards, p, rng) {
  const n = shards.length;
  const lab = new Float32Array(n * 3);
  const t = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    rgbToLab(colors[k * 3], colors[k * 3 + 1], colors[k * 3 + 2], t);
    lab.set(t, k * 3);
  }
  let centers = null;
  if (p.palette === 'gaudi') centers = GAUDI_PALETTE.map((hx) => rgbToLab(...hexToRgb(hx)));
  else if (p.palette === 'kmeans') centers = kmeans(lab, shards.map((s) => area(s.poly)), Math.round(p.paletteK), rng);

  const out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    let L = lab[k * 3], a = lab[k * 3 + 1], b = lab[k * 3 + 2];
    if (centers) {
      const c = nearest(centers, L, a, b);
      L += (c[0] - L) * p.paletteMix; a += (c[1] - a) * p.paletteMix; b += (c[2] - b) * p.paletteMix;
    }
    if (p.colorJitter > 0) {
      L += rng.normal() * p.colorJitter * 100;
      a += rng.normal() * p.colorJitter * 40;
      b += rng.normal() * p.colorJitter * 40;
    }
    labToRgb(L, a, b, t);
    out.set(t, k * 3);
  }
  return { colors: out, centers: centers ? centers.map((c) => labToRgb(c[0], c[1], c[2])) : null };
}

function nearest(centers, L, a, b) {
  let best = centers[0], bd = Infinity;
  for (const c of centers) {
    const d = (c[0] - L) ** 2 + (c[1] - a) ** 2 + (c[2] - b) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

// Area-weighted k-means in Lab with k-means++ seeding.
export function kmeans(lab, weights, K, rng, iters = 15) {
  const n = weights.length;
  K = Math.max(1, Math.min(K, n));
  const pt = (k) => [lab[k * 3], lab[k * 3 + 1], lab[k * 3 + 2]];
  const centers = [pt(pickWeighted(weights, rng))];
  const d2 = new Float64Array(n);
  while (centers.length < K) {
    for (let k = 0; k < n; k++) {
      const [L, a, b] = pt(k);
      let m = Infinity;
      for (const c of centers) m = Math.min(m, (c[0] - L) ** 2 + (c[1] - a) ** 2 + (c[2] - b) ** 2);
      d2[k] = m * weights[k];
    }
    centers.push(pt(pickWeighted(d2, rng)));
  }
  for (let it = 0; it < iters; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let k = 0; k < n; k++) {
      const [L, a, b] = pt(k);
      let bi = 0, bd = Infinity;
      centers.forEach((c, i) => {
        const d = (c[0] - L) ** 2 + (c[1] - a) ** 2 + (c[2] - b) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      const wt = weights[k];
      acc[bi][0] += L * wt; acc[bi][1] += a * wt; acc[bi][2] += b * wt; acc[bi][3] += wt;
    }
    acc.forEach((s, i) => { if (s[3] > 0) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  return centers;
}

function pickWeighted(wts, rng) {
  let total = 0;
  for (const v of wts) total += v;
  let r = rng() * total;
  for (let i = 0; i < wts.length; i++) {
    r -= wts[i];
    if (r <= 0) return i;
  }
  return wts.length - 1;
}
