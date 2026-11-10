import { blur, rgbToOklab } from './image.js';
import { distanceTransform } from './render.js';

// The structure of the photo: which pixels belong together. The photo is cut
// into small superpixels (SLIC) and neighbours are merged while the colour
// step across their shared border stays small, so a sky or a cheek stays one
// region whatever its gradient and a silhouette stays a border. No model and
// no download: this takes a fraction of a second.
//
// Returns { w, h, regions, count, dt, dmax, dmaxAt, L, A, B }:
//   regions  Int32Array, one label per pixel
//   dt       distance of each pixel to the border of its region
//   dmax     per region, its inscribed radius; dmaxAt, the pixel where it is
//   L, A, B  the photo in OKLab x 100, lightly blurred
//
// All lengths here are in pixels of a photo 640 px on its long side and are
// scaled to the photo given.
const REF = 640;
// The gradient (in OKLab x 100 per pixel of the half-size copy) below which nothing counts as full detail.
const DETAIL_FLOOR = 6;

const cache = new WeakMap();
// The structure of a photo, kept until the photo or the contour setting changes.
export function structureOf(img, p) {
  const key = p.contours ?? 8;
  let hit = cache.get(img);
  if (hit?.key !== key) {
    hit = { key, st: findStructure(img, p) };
    cache.set(img, hit);
  }
  return hit.st;
}

export function findStructure(img, p) {
  const { w, h, rgb } = img, N = w * h, u = Math.max(w, h) / REF;
  let L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
  const t = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    rgbToOklab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], t);
    L[i] = 100 * t[0]; A[i] = 100 * t[1]; B[i] = 100 * t[2];
  }
  L = blur121(L, w, h); A = blur121(A, w, h); B = blur121(B, w, h);

  const sp = slic(L, A, B, w, h, Math.max(4, Math.round(6 * u)), 10, 3);
  // Merging reads a copy with the fine texture blurred away, so leaves or
  // gravel do not become a hundred regions.
  const soft = (c) => (u > 0.8 ? blur121(blur121(c, w, h), w, h) : blur121(c, w, h));
  const merged = mergeRegions(sp.labels, sp.count, soft(L), soft(A), soft(B), w, h, p.contours ?? 8, 0.004 * N, 0.6 * (6 * u) ** 2);
  const regions = merged.regions;
  smoothLabels(regions, w, h, 2);

  let count = merged.count, shape = measure(regions, count, w, h);
  // A soft edge leaves a region a couple of pixels wide along it, which would
  // draw the outline twice. Regions that thin are shared out between their
  // neighbours, each pixel to the nearest one.
  const thinLimit = Math.max(1.5, 1.6 * u), thin = new Uint8Array(count);
  let anyThin = false, anyThick = false;
  for (let r = 0; r < count; r++) {
    if (shape.dmaxAt[r] < 0) continue;
    if (shape.dmax[r] < thinLimit) { thin[r] = 1; anyThin = true; } else anyThick = true;
  }
  if (anyThin && anyThick) {
    const queue = new Int32Array(N);
    let head = 0, tail = 0;
    const done = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (!thin[regions[i]]) { done[i] = 1; queue[tail++] = i; }
    while (head < tail) {
      const i = queue[head++], x = i % w, r = regions[i];
      if (x > 0 && !done[i - 1]) { done[i - 1] = 1; regions[i - 1] = r; queue[tail++] = i - 1; }
      if (x < w - 1 && !done[i + 1]) { done[i + 1] = 1; regions[i + 1] = r; queue[tail++] = i + 1; }
      if (i >= w && !done[i - w]) { done[i - w] = 1; regions[i - w] = r; queue[tail++] = i - w; }
      if (i + w < N && !done[i + w]) { done[i + w] = 1; regions[i + w] = r; queue[tail++] = i + w; }
    }
    // Labels in a row again, without the ones just emptied.
    const remap = new Int32Array(count).fill(-1);
    let next = 0;
    for (let i = 0; i < N; i++) {
      if (remap[regions[i]] < 0) remap[regions[i]] = next++;
      regions[i] = remap[regions[i]];
    }
    count = next;
    shape = measure(regions, count, w, h);
  }
  const { dt, dmax, dmaxAt } = shape;
  return { w, h, regions, count, dt, dmax, dmaxAt, L, A, B };
}

// Distance of each pixel to the border of its region, and each region's
// inscribed radius and where it is (-1 for a label no pixel has).
function measure(regions, count, w, h) {
  const N = w * h, f = new Float32Array(N).fill(Infinity);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, r = regions[i];
      if ((x > 0 && regions[i - 1] !== r) || (x < w - 1 && regions[i + 1] !== r)
        || (y > 0 && regions[i - w] !== r) || (y < h - 1 && regions[i + w] !== r)) f[i] = 0;
    }
  }
  const dt = distanceTransform(f, w, h);
  const dmax = new Float32Array(count), dmaxAt = new Int32Array(count).fill(-1);
  for (let i = 0; i < N; i++) {
    const r = regions[i];
    // A region with no border at all (the whole photo) has an infinite one.
    const d = Math.min(dt[i], w + h);
    if (d >= dmax[r]) { dmax[r] = d; dmaxAt[r] = i; }
  }
  return { dt, dmax, dmaxAt };
}

// Piece size per pixel, between sMin and sMax: as large as it can be without
// losing what is inside a region. The border between two regions needs no
// small pieces, since no piece crosses it; what does is colour that changes
// within a region (an eye in a face, a fold in a cloth). So the measure is
// the gradient of each pixel's difference from its region's mean colour, on a
// blurred copy, where the light and dark of a texture cancel out: a tree gets
// pieces as large as a plain wall.
export function structureSize(st, p) {
  const { w, h } = st, N = w * h, u = Math.max(w, h) / REF;
  // At half size: the blurs are wide, so nothing is lost.
  const W = Math.ceil(w / 2), H = Math.ceil(h / 2);
  const half = (c) => {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const y0 = 2 * y * w, y1 = Math.min(h - 1, 2 * y + 1) * w;
      for (let x = 0; x < W; x++) {
        const x0 = 2 * x, x1 = Math.min(w - 1, x0 + 1);
        out[y * W + x] = (c[y0 + x0] + c[y0 + x1] + c[y1 + x0] + c[y1 + x1]) / 4;
      }
    }
    return blur(out, W, H, 1.75 * u);
  };
  // Each channel minus its region's mean.
  const { regions, count } = st, n = new Float64Array(count), sums = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
  const chans = [st.L, st.A, st.B];
  for (let i = 0; i < N; i++) { const r = regions[i]; n[r]++; sums[0][r] += chans[0][i]; sums[1][r] += chans[1][i]; sums[2][r] += chans[2][i]; }
  const within = chans.map((c, k) => {
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) out[i] = c[i] - sums[k][regions[i]] / n[regions[i]];
    return out;
  });
  const Lb = half(within[0]), Ab = half(within[1]), Bb = half(within[2]);
  const grad = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const lx = Lb[i + 1] - Lb[i - 1], ly = Lb[i + W] - Lb[i - W], ax = Ab[i + 1] - Ab[i - 1], ay = Ab[i + W] - Ab[i - W];
      const bx = Bb[i + 1] - Bb[i - 1], by = Bb[i + W] - Bb[i - W];
      grad[i] = Math.sqrt(lx * lx + ly * ly + ax * ax + ay * ay + bx * bx + by * by);
    }
  }
  const det = blur(grad, W, H, 1.8 * u);
  const sorted = Float32Array.from(det).sort();
  // Relative to the photo's own strongest detail, but a flat photo is not
  // stretched until its noise counts as detail.
  const hi = Math.max(DETAIL_FLOOR, sorted[Math.floor(0.97 * (sorted.length - 1))]);
  // Size per level of detail, then per pixel.
  const ratio = p.sMin / p.sMax, lut = new Float32Array(257);
  for (let k = 0; k <= 256; k++) lut[k] = p.sMax * ratio ** ((k / 256) ** 0.85);
  const size = new Float32Array(N);
  for (let y = 0; y < h; y++) {
    const row = (y >> 1) * W;
    for (let x = 0; x < w; x++) {
      const d = det[row + (x >> 1)];
      size[y * w + x] = lut[d >= hi ? 256 : d > 0 ? ((d / hi) * 256) | 0 : 0];
    }
  }
  return size;
}

function blur121(src, w, h) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      tmp[i] = (src[x > 0 ? i - 1 : i] + 2 * src[i] + src[x < w - 1 ? i + 1 : i]) / 4;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      out[i] = (tmp[y > 0 ? i - w : i] + 2 * tmp[i] + tmp[y < h - 1 ? i + w : i]) / 4;
    }
  }
  return out;
}

// SLIC superpixels on a grid of step S (Achanta et al., 2012).
function slic(L, A, B, w, h, S, m, iters) {
  const gx = Math.max(1, Math.round(w / S)), gy = Math.max(1, Math.round(h / S)), K = gx * gy;
  const cx = new Float32Array(K), cy = new Float32Array(K), cl = new Float32Array(K), ca = new Float32Array(K), cb = new Float32Array(K);
  for (let j = 0; j < gy; j++) {
    for (let i = 0; i < gx; i++) {
      const k = j * gx + i, x = Math.min(w - 1, Math.floor(((i + 0.5) * w) / gx)), y = Math.min(h - 1, Math.floor(((j + 0.5) * h) / gy)), q = y * w + x;
      cx[k] = x; cy[k] = y; cl[k] = L[q]; ca[k] = A[q]; cb[k] = B[q];
    }
  }
  const labels = new Int32Array(w * h), dist = new Float32Array(w * h), k2 = (m / S) ** 2, R = Math.ceil(S * 1.3);
  const acc = new Float64Array(K * 6);
  for (let it = 0; it < iters; it++) {
    dist.fill(Infinity);
    for (let k = 0; k < K; k++) {
      const x0 = Math.max(0, Math.floor(cx[k] - R)), x1 = Math.min(w - 1, Math.ceil(cx[k] + R));
      const y0 = Math.max(0, Math.floor(cy[k] - R)), y1 = Math.min(h - 1, Math.ceil(cy[k] + R));
      const kl = cl[k], ka = ca[k], kb = cb[k], kx = cx[k], ky = cy[k];
      for (let y = y0; y <= y1; y++) {
        const dy2 = k2 * (y - ky) * (y - ky);
        for (let x = x0, q = y * w + x0; x <= x1; x++, q++) {
          const dl = L[q] - kl, da = A[q] - ka, db = B[q] - kb, dx = x - kx;
          const d = dl * dl + da * da + db * db + k2 * dx * dx + dy2;
          if (d < dist[q]) { dist[q] = d; labels[q] = k; }
        }
      }
    }
    if (it === iters - 1) break;
    acc.fill(0);
    for (let y = 0, q = 0; y < h; y++) {
      for (let x = 0; x < w; x++, q++) {
        const o = labels[q] * 6;
        acc[o]++; acc[o + 1] += x; acc[o + 2] += y; acc[o + 3] += L[q]; acc[o + 4] += A[q]; acc[o + 5] += B[q];
      }
    }
    for (let k = 0; k < K; k++) {
      const o = k * 6, n = acc[o];
      if (n) { cx[k] = acc[o + 1] / n; cy[k] = acc[o + 2] / n; cl[k] = acc[o + 3] / n; ca[k] = acc[o + 4] / n; cb[k] = acc[o + 5] / n; }
    }
  }
  return { labels, count: K };
}

// Greedy merging on the region adjacency graph, cheapest pair first. The cost
// of joining two regions is mostly the colour step across their border (read
// two pixels apart, past the blur) and a little the difference of their mean
// colours; it is scaled down for small regions, which join first unless they
// stand out a lot. Merging stops at `limit`.
function mergeRegions(labels, K, L, A, B, w, h, limit, smallArea, minArea) {
  const n = new Float64Array(K), sl = new Float64Array(K), sa = new Float64Array(K), sb = new Float64Array(K);
  for (let i = 0; i < w * h; i++) { const k = labels[i]; n[k]++; sl[k] += L[i]; sa[k] += A[i]; sb[k] += B[i]; }
  const adj = Array.from({ length: K }, () => new Map());
  const link = (a, b, i, j) => {
    let e = adj[a].get(b);
    if (!e) { e = { len: 0, diff: 0 }; adj[a].set(b, e); adj[b].set(a, e); }
    const dl = L[i] - L[j], da = A[i] - A[j], db = B[i] - B[j];
    e.len++; e.diff += Math.sqrt(dl * dl + da * da + db * db);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, a = labels[i];
      if (x + 1 < w && labels[i + 1] !== a) {
        const b = labels[i + 1];
        link(a, b, x > 0 && labels[i - 1] === a ? i - 1 : i, x + 2 < w && labels[i + 2] === b ? i + 2 : i + 1);
      }
      if (y + 1 < h && labels[i + w] !== a) {
        const b = labels[i + w];
        link(a, b, y > 0 && labels[i - w] === a ? i - w : i, y + 2 < h && labels[i + 2 * w] === b ? i + 2 * w : i + w);
      }
    }
  }
  const ver = new Int32Array(K), parent = Int32Array.from({ length: K }, (_, i) => i), alive = new Uint8Array(K).fill(1);
  const cost = (a, b, e) => {
    const dl = sl[a] / n[a] - sl[b] / n[b], da = sa[a] / n[a] - sa[b] / n[b], db = sb[a] / n[a] - sb[b] / n[b];
    const small = Math.min(1, Math.sqrt(Math.min(n[a], n[b]) / smallArea));
    return (0.25 * Math.sqrt(dl * dl + da * da + db * db) + (0.75 * e.diff) / e.len) * small;
  };
  const heap = new Heap();
  for (let a = 0; a < K; a++) for (const [b, e] of adj[a]) if (a < b) heap.push(cost(a, b, e), a, b, 0, 0);
  const merge = (a, b) => {
    if (n[a] < n[b]) { const s = a; a = b; b = s; }
    for (const [c, e] of adj[b]) {
      adj[c].delete(b);
      if (c === a) continue;
      const mine = adj[a].get(c);
      if (mine) { mine.len += e.len; mine.diff += e.diff; } else { adj[a].set(c, e); adj[c].set(a, e); }
    }
    adj[a].delete(b); adj[b].clear();
    n[a] += n[b]; sl[a] += sl[b]; sa[a] += sa[b]; sb[a] += sb[b];
    alive[b] = 0; parent[b] = a; ver[a]++;
    for (const [c, e] of adj[a]) heap.push(cost(a, c, e), a, c, ver[a], ver[c]);
  };
  const top = [0, 0, 0, 0, 0];
  while (heap.pop(top)) {
    const [c, a, b, va, vb] = top;
    if (!alive[a] || !alive[b] || ver[a] !== va || ver[b] !== vb) continue;
    if (c > limit) break;
    merge(a, b);
  }
  // Regions too small to hold a piece join the neighbour they differ least from.
  for (let pass = 0; pass < 3; pass++) {
    for (let a = 0; a < K; a++) {
      if (!alive[a] || n[a] >= minArea || !adj[a].size) continue;
      let best = -1, bc = Infinity;
      for (const [b, e] of adj[a]) { const c = e.diff / e.len; if (c < bc) { bc = c; best = b; } }
      merge(a, best);
    }
  }
  const find = (k) => { while (parent[k] !== k) k = parent[k]; return k; };
  const remap = new Int32Array(K).fill(-1);
  let count = 0;
  const regions = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = find(labels[i]);
    if (remap[r] < 0) remap[r] = count++;
    regions[i] = remap[r];
  }
  return { regions, count };
}

// A binary min-heap of (cost, a, b, va, vb) rows in flat arrays.
class Heap {
  constructor() { this.c = []; this.d = []; }
  push(c, a, b, va, vb) {
    const C = this.c, D = this.d;
    let i = C.length;
    C.push(c); D.push(a, b, va, vb);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (C[j] <= C[i]) break;
      this.swap(i, j);
      i = j;
    }
  }
  swap(i, j) {
    const C = this.c, D = this.d;
    const t = C[i]; C[i] = C[j]; C[j] = t;
    for (let k = 0; k < 4; k++) { const s = D[i * 4 + k]; D[i * 4 + k] = D[j * 4 + k]; D[j * 4 + k] = s; }
  }
  pop(out) {
    const C = this.c, D = this.d, n = C.length;
    if (!n) return false;
    out[0] = C[0]; out[1] = D[0]; out[2] = D[1]; out[3] = D[2]; out[4] = D[3];
    this.swap(0, n - 1);
    C.pop(); D.length -= 4;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let s = i;
      if (l < n - 1 && C[l] < C[s]) s = l;
      if (r < n - 1 && C[r] < C[s]) s = r;
      if (s === i) break;
      this.swap(i, s);
      i = s;
    }
    return true;
  }
}

// Each pixel takes the label most common among itself and its 8 neighbours,
// which rounds off the staircase the superpixels leave on region outlines.
function smoothLabels(labels, w, h, passes) {
  const nb = new Int32Array(9);
  for (let pass = 0; pass < passes; pass++) {
    const src = Int32Array.from(labels);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x, own = src[i];
        if (src[i - 1] === own && src[i + 1] === own && src[i - w] === own && src[i + w] === own) continue;
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nb[k++] = src[i + dy * w + dx];
        let best = own, bc = 0;
        for (let a = 0; a < 9; a++) {
          let c = 0;
          for (let b = 0; b < 9; b++) if (nb[b] === nb[a]) c++;
          if (c > bc || (c === bc && nb[a] === own)) { bc = c; best = nb[a]; }
        }
        labels[i] = best;
      }
    }
  }
}
