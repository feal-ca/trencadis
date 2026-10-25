import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/core/analysis.js';
import { toLab } from '../../src/core/image.js';
import { DEFAULTS } from '../../src/core/params.js';
import { area, pointInPolygon, rasterize } from '../../src/core/polygon.js';
import { mulberry32 } from '../../src/core/rng.js';
import { tessellate } from '../../src/core/tessellate.js';

// Skin with an eye: a white almond and a small dark iris (r = 5 px, smaller
// than the smallest piece).
function eyeImage(w = 240, h = 160) {
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = [0.85, 0.65, 0.5];
      if (((x - 120) / 30) ** 2 + ((y - 80) / 12) ** 2 < 1) c = [0.95, 0.94, 0.9];
      if ((x - 120) ** 2 + (y - 80) ** 2 < 25) c = [0.1, 0.12, 0.25];
      rgb.set(c, (y * w + x) * 3);
    }
  }
  return { w, h, rgb };
}

function markAround(w, h, cx, cy, r) {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - cx, y - cy) < r) data[y * w + x] = 1;
  return { w, h, data };
}

describe('intentional tiling (lab)', () => {
  const img = eyeImage();
  const p = { ...DEFAULTS, sMin: 14, sMax: 36 };
  const an = analyze(img, p);
  const lab = toLab(img);

  it('gives a small important part its own piece', () => {
    const res = tessellate(img, lab, an, p, mulberry32(1), null, markAround(240, 160, 120, 80, 45));
    expect(res.before).toBeTruthy();
    const iris = res.shards.filter((s) => s.intent && pointInPolygon(s.poly, 120, 80));
    expect(iris.length).toBe(1);
    // The piece holds the iris and little else.
    const xs = iris[0].poly.map((q) => q[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(16);
    // Without the mark the iris shares its piece with the white.
    const plain = tessellate(img, lab, an, p, mulberry32(1));
    expect(plain.before).toBeUndefined();
  });

  it('does nothing when switched off', () => {
    const res = tessellate(img, lab, an, { ...p, intent: false }, mulberry32(1), null, markAround(240, 160, 120, 80, 45));
    expect(res.before).toBeUndefined();
  });

  it('covers the whole image with convex pieces when everything is important', () => {
    const res = tessellate(img, lab, an, { ...p, intentAll: true }, mulberry32(1));
    expect(res.before).toBeTruthy();
    let total = 0, concave = 0;
    for (const { poly } of res.shards) {
      total += area(poly);
      for (let i = 0, n = poly.length; i < n; i++) {
        const a = poly[i], b = poly[(i + 1) % n], c = poly[(i + 2) % n];
        if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-6) { concave++; break; }
      }
    }
    expect(concave).toBe(0);
    // Shared straightened borders: no gaps or overlaps between pieces.
    expect(Math.abs(total - 240 * 160) / (240 * 160)).toBeLessThan(0.002);
    const hits = new Uint8Array(240 * 160);
    for (const { poly } of res.shards) rasterize(poly, 240, 160, (x, y) => { hits[y * 240 + x]++; });
    expect(hits.filter((v) => v !== 1).length / hits.length).toBeLessThan(0.01);
  });
});
