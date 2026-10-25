// LAB SPIKE (?lab): tiling "with intention" inside areas marked important.
// Throwaway: kept apart from the methods so it can be dropped or rewritten.
//
// Inside the marked area (or the whole image) the photo is split into parts
// by colour (iris, white of the eye, a bird against the sky) and each part
// is cut into straight, convex pieces (straight.js). Parts that touch the
// rim of the mark are handed back to the background method, which then
// packs around the object instead of across it.
import { blur } from '../image.js';
import { overlayPieces } from '../andamento.js';
import { area, rasterize } from '../polygon.js';
import { mergeSlivers } from '../slivers.js';
import { straightPieces } from './straight.js';

// The important mask, painted on a 256 px grid with values in [0, 1], as a
// pixel region at working resolution.
export function regionFromMask(mask, w, h, threshold = 0.3) {
  const region = new Uint8Array(w * h);
  let any = false;
  for (let y = 0; y < h; y++) {
    const my = Math.min(mask.h - 1, Math.floor(((y + 0.5) / h) * mask.h));
    for (let x = 0; x < w; x++) {
      const mx = Math.min(mask.w - 1, Math.floor(((x + 0.5) / w) * mask.w));
      if (mask.data[my * mask.w + mx] > threshold) { region[y * w + x] = 1; any = true; }
    }
  }
  return any ? region : null;
}

// Parts of `region` by colour. A fine oversegmentation (Felzenszwalb) is
// merged pairwise, most similar neighbours first, while their mean colours
// differ by less than `T` (ΔE in Lab). Comparing means rather than pixels
// keeps soft edges (a painted iris) as boundaries. Parts under `minSize`
// pixels then join their most similar neighbour.
export function segmentRegion(lab, w, h, region, T, minSize) {
  const over = felzenszwalb(lab, w, h, region, 2, 3);
  const n = over.count;
  const sum = new Float64Array(n * 3), cnt = new Float64Array(n);
  for (let i = 0; i < w * h; i++) {
    const l = over.labels[i];
    if (l < 0) continue;
    cnt[l]++;
    sum[l * 3] += lab[i * 3]; sum[l * 3 + 1] += lab[i * 3 + 1]; sum[l * 3 + 2] += lab[i * 3 + 2];
  }
  const nbrs = Array.from({ length: n }, () => new Set());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, a = over.labels[i];
      if (a < 0) continue;
      const r = x + 1 < w ? over.labels[i + 1] : -1, d = y + 1 < h ? over.labels[i + w] : -1;
      if (r >= 0 && r !== a) { nbrs[a].add(r); nbrs[r].add(a); }
      if (d >= 0 && d !== a) { nbrs[a].add(d); nbrs[d].add(a); }
    }
  }
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const dE = (a, b) => Math.hypot(
    sum[a * 3] / cnt[a] - sum[b * 3] / cnt[b], sum[a * 3 + 1] / cnt[a] - sum[b * 3 + 1] / cnt[b], sum[a * 3 + 2] / cnt[a] - sum[b * 3 + 2] / cnt[b]);
  const merge = (a, b) => {
    parent[b] = a;
    cnt[a] += cnt[b];
    for (let c = 0; c < 3; c++) sum[a * 3 + c] += sum[b * 3 + c];
    for (const m of nbrs[b]) { nbrs[m].delete(b); if (m !== a) { nbrs[m].add(a); nbrs[a].add(m); } }
    nbrs[a].delete(b);
    nbrs[b].clear();
  };
  // Min-heap of candidate pairs; entries go stale when either side changes.
  const version = new Int32Array(n);
  const heap = new MinHeap();
  const push = (a, b) => heap.push(dE(a, b), [a, b, version[a], version[b]]);
  for (let a = 0; a < n; a++) for (const b of nbrs[a]) if (a < b) push(a, b);
  while (heap.size) {
    const [cost, [a, b, va, vb]] = heap.pop();
    if (cost > T) break;
    if (find(a) !== a || find(b) !== b || version[a] !== va || version[b] !== vb) continue;
    merge(a, b);
    version[a]++;
    for (const m of nbrs[a]) push(a, m);
  }
  // Specks join the neighbour closest in colour.
  for (let a = 0; a < n; a++) {
    if (find(a) !== a || cnt[a] >= minSize || !nbrs[a].size) continue;
    let best = -1, bd = Infinity;
    for (const m of nbrs[a]) { const d = dE(a, m); if (d < bd) { bd = d; best = m; } }
    merge(best, a);
  }
  const labels = new Int32Array(w * h).fill(-1);
  const ids = new Map();
  for (let i = 0; i < w * h; i++) {
    if (over.labels[i] < 0) continue;
    const r = find(over.labels[i]);
    if (!ids.has(r)) ids.set(r, ids.size);
    labels[i] = ids.get(r);
  }
  return { labels, count: ids.size };
}

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const { k, v } = this;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const { k, v } = this;
    const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

// Felzenszwalb-Huttenlocher graph segmentation restricted to `region`.
// Edges between 8-neighbours weigh their colour difference (ΔE in Lab);
// two parts merge while the edge is below both internal thresholds
// Int(C) + k / |C|. Parts under `minSize` pixels then join a neighbour.
export function felzenszwalb(lab, w, h, region, k, minSize) {
  const L = new Float32Array(w * h), A = new Float32Array(w * h), B = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { L[i] = lab[i * 3]; A[i] = lab[i * 3 + 1]; B[i] = lab[i * 3 + 2]; }
  const sL = blur(L, w, h, 0.8), sA = blur(A, w, h, 0.8), sB = blur(B, w, h, 0.8);
  const dist = (i, j) => Math.hypot(sL[i] - sL[j], sA[i] - sA[j], sB[i] - sB[j]);

  const ea = [], eb = [], ew = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!region[i]) continue;
      const nb = [x + 1 < w ? i + 1 : -1, y + 1 < h ? i + w : -1, x + 1 < w && y + 1 < h ? i + w + 1 : -1, x > 0 && y + 1 < h ? i + w - 1 : -1];
      for (const j of nb) if (j >= 0 && region[j]) { ea.push(i); eb.push(j); ew.push(dist(i, j)); }
    }
  }
  const order = Uint32Array.from(ew.keys()).sort((a, b) => ew[a] - ew[b]);

  const parent = new Int32Array(w * h).map((_, i) => i);
  const size = new Int32Array(w * h).fill(1);
  const thresh = new Float32Array(w * h).fill(k);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const join = (a, b) => {
    if (size[a] < size[b]) [a, b] = [b, a];
    parent[b] = a;
    size[a] += size[b];
    return a;
  };
  for (const e of order) {
    const a = find(ea[e]), b = find(eb[e]);
    if (a === b) continue;
    if (ew[e] <= thresh[a] && ew[e] <= thresh[b]) {
      const r = join(a, b);
      thresh[r] = ew[e] + k / size[r];
    }
  }
  for (const e of order) {
    const a = find(ea[e]), b = find(eb[e]);
    if (a !== b && (size[a] < minSize || size[b] < minSize)) join(a, b);
  }

  const labels = new Int32Array(w * h).fill(-1);
  const ids = new Map();
  for (let i = 0; i < w * h; i++) {
    if (!region[i]) continue;
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    labels[i] = ids.get(r);
  }
  return { labels, count: ids.size };
}

// Parts with a pixel next to the outside of the region (or the image border).
function rimParts(labels, region, w, h, count) {
  const rim = new Uint8Array(count);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (labels[i] < 0) continue;
      const out = (j) => !region[j];
      if ((x > 0 && out(i - 1)) || (x + 1 < w && out(i + 1)) || (y > 0 && out(i - w)) || (y + 1 < h && out(i + w))) rim[labels[i]] = 1;
    }
  }
  return rim;
}

// Colour parts of `region`, with those touching its rim handed back (-1).
function partLabels(lab, an, p, region) {
  const { w, h } = an;
  const minSize = Math.max(4, Math.round((0.5 * p.sMin) ** 2));
  const seg = segmentRegion(lab, w, h, region, p.intentDE, minSize);
  // Thin bands where colour changes gradually at an edge join a neighbour.
  const merged = mergeSlivers(seg.labels, w, h, an.size, 0.25);
  const renumber = (a) => {
    const ids = new Map();
    return { labels: a.map((l) => (l < 0 ? -1 : ids.get(l) ?? ids.set(l, ids.size).get(l))), count: () => ids.size };
  };
  let r = renumber(merged);
  if (!p.intentRim || p.intentAll) return { labels: r.labels, count: r.count() };
  const rim = rimParts(r.labels, region, w, h, r.count());
  r = renumber(r.labels.map((l) => (l >= 0 && rim[l] ? -1 : l)));
  return { labels: r.labels, count: r.count() };
}

// The intentional pieces: in the marked areas or, with intentAll, everywhere.
export function intentionalShards(img, lab, an, p, mask, rng) {
  const { w, h } = an;
  const region = p.intentAll ? new Uint8Array(w * h).fill(1) : mask && regionFromMask(mask, w, h);
  if (!region) return null;
  const { labels, count } = partLabels(lab, an, p, region);
  if (!count) return null;
  return straightPieces(labels, count, img, lab, an, p, rng);
}

// The background with the intentional pieces on top (or, with intentAll,
// only them), or null when there are none.
export function overlayIntentional(shards, img, lab, an, p, mask, rng) {
  const pieces = intentionalShards(img, lab, an, p, mask, rng);
  if (!pieces?.length) return null;
  if (p.intentAll) return pieces;
  const { w, h } = an;
  const extra = new Int32Array(w * h).fill(-1);
  const order = pieces.map((s, id) => [area(s.poly), id]).sort((a, b) => b[0] - a[0]);
  for (const [, id] of order) rasterize(pieces[id].poly, w, h, (x, y) => { extra[y * w + x] = id; });
  return overlayPieces(shards, extra, w, h, an, { intent: true }, 0.8, pieces.map((s) => s.poly));
}
