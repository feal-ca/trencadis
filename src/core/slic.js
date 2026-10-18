import { sample } from './analysis.js';

// SLIC superpixels with a per-centre spacing taken from the size field.
// Distance: dLab^2 + (dXY / S_k)^2 * m^2, searched in a window of +-1.5 S_k.
// Low compactness m hugs image edges; high m gives regular blobs.
export function slic(centers0, lab, an, compactness, iterations) {
  const { w, h, size } = an;
  const K = centers0.length;
  const C = new Float64Array(K * 6); // L a b x y S
  const setCenter = (k, x, y) => {
    const xi = Math.min(w - 1, Math.max(0, x | 0)), yi = Math.min(h - 1, Math.max(0, y | 0));
    const i = yi * w + xi;
    C[k * 6] = lab[i * 3]; C[k * 6 + 1] = lab[i * 3 + 1]; C[k * 6 + 2] = lab[i * 3 + 2];
    C[k * 6 + 3] = x; C[k * 6 + 4] = y; C[k * 6 + 5] = sample(size, w, h, x, y);
  };
  centers0.forEach(([x, y], k) => setCenter(k, x, y));

  const labels = new Int32Array(w * h);
  const dist = new Float32Array(w * h);
  const m2 = compactness * compactness;
  for (let it = 0; it < iterations; it++) {
    labels.fill(-1);
    dist.fill(Infinity);
    for (let k = 0; k < K; k++) {
      const cx = C[k * 6 + 3], cy = C[k * 6 + 4], S = C[k * 6 + 5];
      const R = 1.5 * S;
      const xa = Math.max(0, Math.floor(cx - R)), xb = Math.min(w - 1, Math.ceil(cx + R));
      const ya = Math.max(0, Math.floor(cy - R)), yb = Math.min(h - 1, Math.ceil(cy + R));
      for (let y = ya; y <= yb; y++) {
        for (let x = xa; x <= xb; x++) {
          const i = y * w + x;
          const dL = lab[i * 3] - C[k * 6], da = lab[i * 3 + 1] - C[k * 6 + 1], db = lab[i * 3 + 2] - C[k * 6 + 2];
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
          const d = dL * dL + da * da + db * db + ((dx * dx + dy * dy) / (S * S)) * m2;
          if (d < dist[i]) { dist[i] = d; labels[i] = k; }
        }
      }
    }
    const acc = new Float64Array(K * 6);
    for (let i = 0; i < w * h; i++) {
      const k = labels[i];
      if (k < 0) continue;
      acc[k * 6] += lab[i * 3]; acc[k * 6 + 1] += lab[i * 3 + 1]; acc[k * 6 + 2] += lab[i * 3 + 2];
      acc[k * 6 + 3] += (i % w) + 0.5; acc[k * 6 + 4] += Math.floor(i / w) + 0.5; acc[k * 6 + 5]++;
    }
    for (let k = 0; k < K; k++) {
      const n = acc[k * 6 + 5];
      if (!n) continue;
      C[k * 6] = acc[k * 6] / n; C[k * 6 + 1] = acc[k * 6 + 1] / n; C[k * 6 + 2] = acc[k * 6 + 2] / n;
      C[k * 6 + 3] = acc[k * 6 + 3] / n; C[k * 6 + 4] = acc[k * 6 + 4] / n;
      C[k * 6 + 5] = sample(size, w, h, C[k * 6 + 3], C[k * 6 + 4]);
    }
  }
  return enforceConnectivity(labels, w, h);
}

// Keep only the largest 4-connected component of each label, then grow the
// surviving labels into the orphaned pixels (multi-source BFS).
export function enforceConnectivity(labels, w, h) {
  const N = w * h;
  const comp = new Int32Array(N).fill(-1);
  const compSize = [];
  const compLabel = [];
  const stack = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0 || labels[s] < 0) continue;
    const id = compSize.length, l = labels[s];
    let top = 0, n = 0;
    stack[top++] = s;
    comp[s] = id;
    while (top) {
      const i = stack[--top];
      n++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && comp[i - 1] < 0 && labels[i - 1] === l) { comp[i - 1] = id; stack[top++] = i - 1; }
      if (x < w - 1 && comp[i + 1] < 0 && labels[i + 1] === l) { comp[i + 1] = id; stack[top++] = i + 1; }
      if (y > 0 && comp[i - w] < 0 && labels[i - w] === l) { comp[i - w] = id; stack[top++] = i - w; }
      if (y < h - 1 && comp[i + w] < 0 && labels[i + w] === l) { comp[i + w] = id; stack[top++] = i + w; }
    }
    compSize.push(n);
    compLabel.push(l);
  }
  const bestComp = new Map();
  compSize.forEach((n, id) => {
    const l = compLabel[id];
    const b = bestComp.get(l);
    if (b === undefined || compSize[b] < n) bestComp.set(l, id);
  });
  const out = new Int32Array(N);
  for (let i = 0; i < N; i++) out[i] = comp[i] >= 0 && bestComp.get(labels[i]) === comp[i] ? labels[i] : -1;
  return fillUnlabeled(out, w, h);
}

// Grow the labelled pixels into the -1 ones (multi-source BFS), in place.
export function fillUnlabeled(out, w, h) {
  const N = w * h;
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (let i = 0; i < N; i++) if (out[i] >= 0) queue[qt++] = i;
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % w, y = (i / w) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) {
      if (j >= 0 && out[j] < 0) { out[j] = out[i]; queue[qt++] = j; }
    }
  }
  return out;
}
