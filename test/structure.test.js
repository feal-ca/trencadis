import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/core/params.js';
import { convexify, makePieces } from '../src/core/pieces.js';
import { pointInPolygon } from '../src/core/polygon.js';
import { mulberry32 } from '../src/core/rng.js';
import { findStructure, structureSize } from '../src/core/structure.js';
import { discImage, flatImage, textureAndEdge } from './helpers.js';

describe('structure', () => {
  it('a flat photo is one region with the largest pieces', () => {
    const st = findStructure(flatImage(120, 80), DEFAULTS);
    expect(st.count).toBe(1);
    const size = structureSize(st, DEFAULTS);
    expect(Math.min(...size)).toBeCloseTo(DEFAULTS.sMax);
  });

  it('a disc on a background is two regions, split at the outline', () => {
    const img = discImage(240, 200, 60), st = findStructure(img, DEFAULTS);
    expect(st.count).toBe(2);
    const at = (x, y) => st.regions[y * img.w + x];
    expect(at(120, 100)).not.toBe(at(5, 5));
    expect(at(120, 50)).toBe(at(120, 100));
    expect(at(120, 30)).toBe(at(5, 5));
  });

  it('texture counts for much less than an edge inside a region would', () => {
    // Salt noise on every pixel is the hardest texture there is; a photo's
    // foliage or gravel is milder. Even so the pieces stay over half size.
    const img = textureAndEdge(640, 426), st = findStructure(img, DEFAULTS), size = structureSize(st, DEFAULTS);
    expect(size[213 * img.w + 160]).toBeGreaterThan(0.5 * DEFAULTS.sMax);
    expect(size[213 * img.w + 600]).toBeCloseTo(DEFAULTS.sMax);
  });
});

describe('pieces', () => {
  it('no piece crosses the outline of the disc', () => {
    const img = discImage(240, 200, 60), st = findStructure(img, DEFAULTS);
    const shards = makePieces(st, structureSize(st, DEFAULTS), DEFAULTS, mulberry32(7));
    expect(shards.length).toBeGreaterThan(20);
    const inside = (x, y) => Math.hypot(x - 120, y - 100) < 60;
    let mixed = 0;
    for (const { poly } of shards) {
      let a = 0, b = 0;
      const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
      for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y++) {
        for (let x = Math.floor(Math.min(...xs)); x <= Math.max(...xs); x++) {
          if (!pointInPolygon(poly, x + 0.5, y + 0.5)) continue;
          if (inside(x + 0.5, y + 0.5)) a++; else b++;
        }
      }
      // A few pixels of slack for the straightened outline.
      if (Math.min(a, b) > 0.15 * (a + b)) mixed++;
    }
    expect(mixed).toBe(0);
  });

  it('convexify splits an L into convex parts of the same area', () => {
    const L = [[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]];
    const parts = [];
    convexify(L, 0, parts);
    expect(parts.length).toBe(2);
    const twice = (P) => Math.abs(P.reduce((s, q, i) => s + q[0] * P[(i + 1) % P.length][1] - P[(i + 1) % P.length][0] * q[1], 0));
    expect(parts.reduce((s, P) => s + twice(P), 0)).toBeCloseTo(600);
  });
});
