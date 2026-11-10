import { area, centroid, perimeter, splitByLine } from './polygon.js';
import { labelsToPolygons } from './polygonize.js';

// Pieces that never cross a region border, so the joints draw the outlines.
//
// Seeds are scattered inside each region (Poisson-disc, spaced by the size
// field), a first row of them at half a piece from the region's border so a
// row of pieces follows every outline. Each pixel joins the nearest seed of
// its own region. The cells are then made convex and broken with straight
// cuts, which is what turns pebbles into shards of tile.
//
// `st` is the structure (structure.js), `size` the piece size per pixel.
// `opts`: { coarse, cuts, lloyd, rows, convex } (see the methods in tessellate.js).
// Returns [{ poly }] in working pixels.
export function makePieces(st, size, p, rng, opts = {}) {
  const { coarse = 1.5, cuts = 0.5, lloyd = 1, rows = true, convex: makeConvex = true } = opts;
  const { w, h, regions, count: R, dt, dmax, dmaxAt } = st, N = w * h;

  // Piece size at a pixel: the size field, bounded by how thick the region is,
  // so a lip or a mast gets pieces that fit across it.
  const sEff = new Float32Array(N);
  for (let i = 0; i < N; i++) sEff[i] = Math.max(3, Math.min(size[i], 2.4 * dmax[regions[i]] + 1));

  const cell = 12, gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = Array.from({ length: gw * gh }, () => []);
  const sx = [], sy = [], sr = [];
  const accept = (i, k) => {
    const x = i % w, y = (i / w) | 0, r = sEff[i] * k, r2 = r * r, reg = regions[i];
    const c = Math.ceil(r / cell), gx = (x / cell) | 0, gy = (y / cell) | 0;
    const j1 = Math.min(gh - 1, gy + c), i1 = Math.min(gw - 1, gx + c);
    for (let j = Math.max(0, gy - c); j <= j1; j++) {
      for (let q = Math.max(0, gx - c); q <= i1; q++) {
        const list = grid[j * gw + q];
        for (let n = 0; n < list.length; n++) {
          const s = list[n];
          if (sr[s] === reg && (sx[s] - x) * (sx[s] - x) + (sy[s] - y) * (sy[s] - y) < r2) return;
        }
      }
    }
    grid[gy * gw + gx].push(sx.length);
    sx.push(x); sy.push(y); sr.push(reg);
  };
  if (rows) {
    const band = [];
    for (let i = 0; i < N; i++) {
      const row = 0.45 * coarse * Math.min(sEff[i], (2 * dmax[regions[i]]) / coarse + 1);
      if (Math.abs(dt[i] - row) < 0.6) band.push(i);
    }
    for (let i = band.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0, t = band[i];
      band[i] = band[j]; band[j] = t;
    }
    for (const i of band) accept(i, 0.9 * coarse);
  }
  for (let n = (N / 3) | 0; n > 0; n--) {
    const i = (rng() * N) | 0;
    if (dt[i] >= 0.45 * sEff[i]) accept(i, 0.84 * coarse);
  }
  const has = new Uint8Array(R);
  for (let s = 0; s < sr.length; s++) has[sr[s]] = 1;
  for (let r = 0; r < R; r++) {
    if (!has[r] && dmaxAt[r] >= 0) { sx.push(dmaxAt[r] % w); sy.push((dmaxAt[r] / w) | 0); sr.push(r); }
  }

  const X = Int32Array.from(sx), Y = Int32Array.from(sy);
  let own = nearestInRegion(X, Y, regions, w, h, lloyd > 0 ? 1 : 2);
  for (let it = 0; it < lloyd; it++) {
    const acc = new Float64Array(X.length * 3);
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const s = own[i];
        if (s >= 0) { acc[s * 3]++; acc[s * 3 + 1] += x; acc[s * 3 + 2] += y; }
      }
    }
    for (let s = 0; s < X.length; s++) {
      if (!acc[s * 3]) continue;
      const x = Math.round(acc[s * 3 + 1] / acc[s * 3]), y = Math.round(acc[s * 3 + 2] / acc[s * 3]);
      if (regions[y * w + x] === sr[s]) { X[s] = x; Y[s] = y; }
    }
    own = nearestInRegion(X, Y, regions, w, h);
  }
  const count = fillOrphans(own, regions, w, h, X.length);
  mergeSlivers(own, count, regions, sEff, w, h);

  // Outlines first, then the breaks.
  const out = [];
  const convex = [];
  for (const { poly } of labelsToPolygons(own, w, h, p.simplify ?? 1.1, 3)) {
    if (makeConvex) convexify(poly, 0, convex);
    else convex.push(poly);
  }
  const sizeAt = (cx, cy) => sEff[Math.min(h - 1, Math.max(0, Math.round(cy))) * w + Math.min(w - 1, Math.max(0, Math.round(cx)))];
  // A cut is tried along a few lines and the one that leaves the two most
  // compact, most even halves is taken; when every line would leave a splinter
  // the piece stays whole.
  const chop = (P, depth) => {
    const a = area(P), [cx, cy] = centroid(P), s = sizeAt(cx, cy);
    if (depth < 3 && a > 0.8 * s * s && (a > 1.5 * s * s || rng() < cuts)) {
      const across = longAxis(P, cx, cy), j = 0.16 * Math.sqrt(a);
      let best = null, bestScore = MIN_COMPACT;
      for (let k = 0; k < 5; k++) {
        const ang = k === 0 ? across : k === 1 ? across + (rng() - 0.5) * 1.1 : rng() * Math.PI;
        const parts = splitByLine(P, cx + (rng() - 0.5) * j, cy + (rng() - 0.5) * j, Math.cos(ang), Math.sin(ang));
        if (parts[0].length < 3 || parts[1].length < 3) continue;
        const a0 = area(parts[0]), a1 = area(parts[1]);
        if (Math.min(a0, a1) < 0.22 * s * s) continue;
        const score = Math.min(compactness(parts[0], a0), compactness(parts[1], a1)) * (0.7 + (0.3 * Math.min(a0, a1)) / Math.max(a0, a1)) * (0.9 + 0.2 * rng());
        if (score > bestScore) { bestScore = score; best = parts; }
      }
      if (best) {
        chop(best[0], depth + 1);
        chop(best[1], depth + 1);
        return;
      }
    }
    out.push({ poly: P });
  };
  if (cuts > 0) for (const P of convex) chop(P, 0);
  else for (const P of convex) out.push({ poly: P });
  return out;
}

// 4πA / P²: 1 for a disc, 0.79 for a square, 0.5 for a 4:1 strip.
const compactness = (P, a) => (4 * Math.PI * a) / perimeter(P) ** 2;
// No cut may leave a half less compact than this.
const MIN_COMPACT = 0.5;

// For each pixel, the nearest seed of its own region, by passing seed ids
// between neighbours of the same region in forward and backward sweeps
// (Danielsson's vector propagation). Borders between cells of one region
// come out straight, and no cell leaks across a region border.
function nearestInRegion(X, Y, regions, w, h, rounds = 2) {
  const own = new Int32Array(w * h).fill(-1);
  for (let s = 0; s < X.length; s++) own[Y[s] * w + X[s]] = s;
  const take = (i, j, x, y) => {
    const s = own[j];
    if (s < 0 || regions[j] !== regions[i]) return;
    const c = own[i];
    if (c === s) return;
    if (c < 0) { own[i] = s; return; }
    const dx = x - X[s], dy = y - Y[s], ex = x - X[c], ey = y - Y[c];
    if (dx * dx + dy * dy < ex * ex + ey * ey) own[i] = s;
  };
  for (let round = 0; round < rounds; round++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (x > 0) take(i, i - 1, x, y);
        if (y > 0) {
          take(i, i - w, x, y);
          if (x > 0) take(i, i - w - 1, x, y);
          if (x < w - 1) take(i, i - w + 1, x, y);
        }
      }
    }
    for (let y = h - 1; y >= 0; y--) {
      for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x;
        if (x < w - 1) take(i, i + 1, x, y);
        if (y < h - 1) {
          take(i, i + w, x, y);
          if (x < w - 1) take(i, i + w + 1, x, y);
          if (x > 0) take(i, i + w - 1, x, y);
        }
      }
    }
  }
  return own;
}

// Pixels no seed reached (a detached bit of a region) become one cell per bit.
function fillOrphans(own, regions, w, h, next) {
  const N = w * h, stack = [];
  for (let start = 0; start < N; start++) {
    if (own[start] >= 0) continue;
    const id = next++, reg = regions[start];
    own[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop(), x = i % w;
      if (x > 0 && own[i - 1] < 0 && regions[i - 1] === reg) { own[i - 1] = id; stack.push(i - 1); }
      if (x < w - 1 && own[i + 1] < 0 && regions[i + 1] === reg) { own[i + 1] = id; stack.push(i + 1); }
      if (i >= w && own[i - w] < 0 && regions[i - w] === reg) { own[i - w] = id; stack.push(i - w); }
      if (i + w < N && own[i + w] < 0 && regions[i + w] === reg) { own[i + w] = id; stack.push(i + w); }
    }
  }
  return next;
}

// A cell much smaller than the piece size there joins the cell of its own
// region it shares the longest border with.
function mergeSlivers(own, count, regions, sEff, w, h) {
  const N = w * h, cnt = new Int32Array(count), sSum = new Float32Array(count), regOf = new Int32Array(count);
  for (let i = 0; i < N; i++) { const s = own[i]; cnt[s]++; sSum[s] += sEff[i]; regOf[s] = regions[i]; }
  const small = new Uint8Array(count);
  let any = false;
  for (let s = 0; s < count; s++) {
    const m = cnt[s] ? sSum[s] / cnt[s] : 0;
    if (cnt[s] && cnt[s] < 0.15 * m * m) { small[s] = 1; any = true; }
  }
  if (!any) return;
  // Shared border lengths, only for the small cells.
  const share = new Map();
  const add = (a, b) => {
    if (a === b || regOf[a] !== regOf[b]) return;
    if (small[a]) { const k = a * count + b; share.set(k, (share.get(k) ?? 0) + 1); }
    if (small[b]) { const k = b * count + a; share.set(k, (share.get(k) ?? 0) + 1); }
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = own[i];
      if (x + 1 < w && own[i + 1] !== a) add(a, own[i + 1]);
      if (y + 1 < h && own[i + w] !== a) add(a, own[i + w]);
    }
  }
  const best = new Int32Array(count).fill(-1), bestLen = new Int32Array(count);
  for (const [k, len] of share) {
    const a = Math.floor(k / count), b = k % count;
    if (len > bestLen[a]) { bestLen[a] = len; best[a] = b; }
  }
  const to = Int32Array.from({ length: count }, (_, i) => i);
  const find = (k) => { for (let g = 0; to[k] !== k && g < 64; g++) k = to[k]; return k; };
  for (let s = 0; s < count; s++) {
    if (!small[s] || best[s] < 0) continue;
    const t = find(best[s]);
    if (t !== s) to[s] = t;
  }
  for (let i = 0; i < N; i++) own[i] = find(own[i]);
}

// Split a polygon at its sharpest inward corner, along that corner's
// bisector, until no corner turns inward by much. A tile nipper does the
// same: nobody lays an L-shaped shard.
export function convexify(P, depth, out) {
  const n = P.length;
  if (n < 4 || depth > 3) { out.push(P); return; }
  let twice = 0;
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; twice += a[0] * b[1] - b[0] * a[1]; }
  const turn = Math.sign(twice);
  let worst = -1, sharpest = 0.3;
  for (let i = 0; i < n; i++) {
    const a = P[(i + n - 1) % n], b = P[i], c = P[(i + 1) % n];
    const e1 = Math.hypot(b[0] - a[0], b[1] - a[1]), e2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (e1 < 1.5 || e2 < 1.5) continue;
    const sin = (-turn * ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))) / (e1 * e2);
    if (sin > sharpest) { sharpest = sin; worst = i; }
  }
  if (worst < 0) { out.push(P); return; }
  const b = P[worst], a = P[(worst + n - 1) % n], c = P[(worst + 1) % n];
  const e1 = Math.hypot(a[0] - b[0], a[1] - b[1]), e2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
  let dx = -((a[0] - b[0]) / e1 + (c[0] - b[0]) / e2), dy = -((a[1] - b[1]) / e1 + (c[1] - b[1]) / e2);
  const dl = Math.hypot(dx, dy);
  if (dl < 1e-3) { out.push(P); return; }
  dx /= dl; dy /= dl;
  // Where the bisector first meets the outline again.
  let hit = Infinity, edge = -1;
  for (let j = 0; j < n; j++) {
    if (j === worst || (j + 1) % n === worst) continue;
    const q = P[j], r = P[(j + 1) % n], ex = r[0] - q[0], ey = r[1] - q[1], den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((q[0] - b[0]) * ey - (q[1] - b[1]) * ex) / den, v = ((q[0] - b[0]) * dy - (q[1] - b[1]) * dx) / den;
    if (t > 1e-3 && v >= 0 && v <= 1 && t < hit) { hit = t; edge = j; }
  }
  if (edge < 0) { out.push(P); return; }
  const at = [b[0] + dx * hit, b[1] + dy * hit], one = [b], two = [at];
  for (let i = (worst + 1) % n; ; i = (i + 1) % n) { one.push(P[i]); if (i === edge) break; }
  one.push(at);
  for (let i = (edge + 1) % n; ; i = (i + 1) % n) { two.push(P[i]); if (i === worst) break; }
  if (area(one) < 2 || area(two) < 2) { out.push(P); return; }
  convexify(one, depth + 1, out);
  convexify(two, depth + 1, out);
}

// Direction of the longest extent of a polygon's corners, in radians.
function longAxis(P, cx, cy) {
  let xx = 0, yy = 0, xy = 0;
  for (const q of P) { const dx = q[0] - cx, dy = q[1] - cy; xx += dx * dx; yy += dy * dy; xy += dx * dy; }
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}
