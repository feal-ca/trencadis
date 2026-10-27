import { signedArea, simplifyClosed } from './polygon.js';

// Turn a label map into one polygon per label. For each label we walk the
// pixel-edge boundary (edges between an inside and an outside pixel), keep
// the longest loop, drop collinear vertices and simplify with Douglas-Peucker.
// Simplifying each region on its own leaves hairline gaps between neighbours;
// the grout covers them.
export function labelsToPolygons(labels, w, h, eps = 1, minPixels = 4, only = null) {
  let n = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] + 1 > n) n = labels[i] + 1;
  const x0 = new Int32Array(n).fill(w), y0 = new Int32Array(n).fill(h);
  const x1 = new Int32Array(n).fill(-1), y1 = new Int32Array(n).fill(-1);
  const count = new Int32Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = labels[y * w + x];
      if (l < 0) continue;
      count[l]++;
      if (x < x0[l]) x0[l] = x;
      if (x > x1[l]) x1[l] = x;
      if (y < y0[l]) y0[l] = y;
      if (y > y1[l]) y1[l] = y;
    }
  }

  const out = [];
  for (let l = 0; l < n; l++) {
    if (count[l] < minPixels || (only && !only.has(l))) continue;
    const ring = traceLabel(labels, w, h, l, x0[l], y0[l], x1[l], y1[l]);
    if (!ring || ring.length < 3) continue;
    const poly = simplifyClosed(dropCollinear(ring), eps);
    if (poly.length >= 3 && Math.abs(signedArea(poly)) >= minPixels / 2) out.push({ poly, label: l });
  }
  return out;
}

// The boundary loop of label l with the largest area, as [x, y] corners.
function traceLabel(labels, w, h, l, xa, ya, xb, yb) {
  const W = w + 1;
  let best = null, bestArea = 0;
  for (const loop of traceLoops(labels, w, h, l, [xa, ya, xb, yb])) {
    const ring = loop.map((c) => [c % W, Math.floor(c / W)]);
    const a = Math.abs(signedArea(ring));
    if (a > bestArea) {
      bestArea = a;
      best = ring;
    }
  }
  return best;
}

// Every boundary loop of label l inside the box [xa, ya, xb, yb], as corner
// ids (y * (w + 1) + x), with 4 corners or more.
export function traceLoops(labels, w, h, l, [xa, ya, xb, yb]) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === l;
  const W = w + 1;
  const next = new Map();
  const add = (ax, ay, bx, by) => {
    const k = ay * W + ax;
    const v = by * W + bx;
    const list = next.get(k);
    if (list) list.push(v);
    else next.set(k, [v]);
  };
  // Clockwise on screen (y down): top, right, bottom, left.
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops = [];
  for (const start of next.keys()) {
    while (next.get(start)?.length) {
      const ring = [];
      let cur = start, guard = 0;
      do {
        const list = next.get(cur);
        if (!list?.length) break;
        ring.push(cur);
        cur = list.pop();
      } while (cur !== start && ++guard < 1e7);
      if (ring.length >= 4) loops.push(ring);
    }
  }
  return loops;
}

function dropCollinear(ring) {
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n], b = ring[i], c = ring[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) out.push(b);
  }
  return out.length >= 3 ? out : ring;
}
