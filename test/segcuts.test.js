import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis.js';
import { toLab } from '../src/core/image.js';
import { cutBySegments } from '../src/core/segcuts.js';
import { DEFAULTS } from '../src/core/params.js';
import { area, rasterize } from '../src/core/polygon.js';
import { mulberry32 } from '../src/core/rng.js';
import { tessellate } from '../src/core/tessellate.js';
import { flatImage } from './helpers.js';

// A disc-shaped object on a 120 x 80 label grid (half the photo's size).
function discSegments() {
  const w = 120, h = 80, labels = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = Math.hypot(x - 60, y - 40) < 24 ? 1 : 0;
  return { w, h, labels };
}
const inDisc = (x, y) => Math.hypot(x + 0.5 - 120, y + 0.5 - 80) < 48;

// Share of the pixels of each piece that are not of its main object, summed.
function mixedPixels(shards) {
  let wrong = 0;
  for (const { poly } of shards) {
    let n = 0, d = 0;
    rasterize(poly, 240, 160, (x, y) => { n++; if (inDisc(x, y)) d++; });
    wrong += Math.min(d, n - d);
  }
  return wrong;
}

describe('cuts along segmented objects', () => {
  const p = { ...DEFAULTS, sMin: 7, sMax: 20 };
  const grid = [];
  for (let y = 0; y < 160; y += 20) for (let x = 0; x < 240; x += 20) grid.push({ poly: [[x, y], [x + 20, y], [x + 20, y + 20], [x, y + 20]] });

  it('splits pieces that straddle an object border, keeping the area', () => {
    const out = cutBySegments(grid, discSegments(), 240, 160, p);
    expect(out.length).toBeGreaterThan(grid.length);
    expect(mixedPixels(out)).toBeLessThan(0.35 * mixedPixels(grid));
    const total = out.reduce((s, q) => s + area(q.poly), 0);
    expect(total).toBeCloseTo(240 * 160, 3);
    // No half smaller than the floor.
    for (const q of out) expect(area(q.poly)).toBeGreaterThan(0.3 * 49 - 1e-6);
  });

  it('leaves pieces inside one object alone', () => {
    const one = { w: 4, h: 4, labels: new Int32Array(16).fill(2) };
    expect(cutBySegments(grid, one, 240, 160, p)).toEqual(grid);
  });

  it('applies through tessellate whenever there are segments', () => {
    const img = flatImage(240, 160);
    const an = analyze(img, p);
    const run = (seg) => tessellate(img, toLab(img), an, p, mulberry32(1), null, seg).shards;
    // Without the model's border the pieces ignore the object; with it they are cut along it.
    expect(mixedPixels(run(discSegments()))).toBeLessThan(0.5 * mixedPixels(run(null)));
  });
});
