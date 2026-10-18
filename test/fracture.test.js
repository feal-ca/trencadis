import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis.js';
import { toLab } from '../src/core/image.js';
import { DEFAULTS } from '../src/core/params.js';
import { mulberry32 } from '../src/core/rng.js';
import { tessellate } from '../src/core/tessellate.js';
import { flatImage } from './helpers.js';

// Longest straight seam: edges of different pieces that lie on the same line
// and touch are merged, because that is what the eye reads as one cut.
function longestSeam(shards, w, h) {
  const onBorder = (p) => p[0] < 0.5 || p[1] < 0.5 || p[0] > w - 0.5 || p[1] > h - 0.5;
  const lines = new Map();
  for (const { poly } of shards) {
    for (let i = 0; i < poly.length; i++) {
      const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1 || (onBorder(a) && onBorder(b) && (Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5))) continue;
      let t = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (t < 0) t += Math.PI;
      if (t >= Math.PI - 1e-9) t -= Math.PI;
      const nx = -Math.sin(t), ny = Math.cos(t);
      const rho = a[0] * nx + a[1] * ny;
      const key = `${Math.round(t * 200)}:${Math.round(rho)}`;
      const ux = Math.cos(t), uy = Math.sin(t);
      const s0 = a[0] * ux + a[1] * uy, s1 = b[0] * ux + b[1] * uy;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push([Math.min(s0, s1), Math.max(s0, s1)]);
    }
  }
  let best = 0;
  for (const iv of lines.values()) {
    iv.sort((p, q) => p[0] - q[0]);
    let [lo, hi] = iv[0];
    for (const [a, b] of iv) {
      if (a <= hi + 1.5) hi = Math.max(hi, b);
      else { best = Math.max(best, hi - lo); [lo, hi] = [a, b]; }
    }
    best = Math.max(best, hi - lo);
  }
  return best;
}

describe('fracture base tiles', () => {
  const img = flatImage(480, 360);
  const lab = toLab(img);
  const run = (tileSize) => {
    const p = { ...DEFAULTS, algorithm: 'fracture', tileSize };
    return tessellate(img, lab, analyze(img, p), p, mulberry32(3)).shards;
  };

  it('without base tiles some cut runs across most of the image', () => {
    expect(longestSeam(run(0), 480, 360)).toBeGreaterThan(240);
  });

  it('with base tiles no seam is longer than a tile', () => {
    expect(longestSeam(run(3.5), 480, 360)).toBeLessThan(200);
  });
});

import { discImage, syntheticImage } from './helpers.js';

// Minimum width of a convex polygon: over its edges, the smallest of the
// largest distances from that edge to the other vertices.
function minWidth(P) {
  let best = Infinity;
  for (let i = 0; i < P.length; i++) {
    const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length];
    const L = Math.hypot(bx - ax, by - ay);
    if (L < 1e-9) continue;
    let far = 0;
    for (const [x, y] of P) far = Math.max(far, Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / L);
    best = Math.min(best, far);
  }
  return best;
}

describe('following edges without slivers', () => {
  for (const [name, img] of [['scene', syntheticImage(500, 400)], ['disc', discImage(500, 400, 150)]]) {
    it(`edgeAlign 1 with the sliver penalty leaves no pieces under 3 px wide (${name})`, () => {
      const p = { ...DEFAULTS, algorithm: 'fracture', edgeAlign: 1, sliver: 3, temperature: 0.038 };
      const shards = tessellate(img, toLab(img), analyze(img, p), p, mulberry32(7)).shards;
      expect(shards.filter((s) => minWidth(s.poly) < 3).length).toBe(0);
    });
  }
});
