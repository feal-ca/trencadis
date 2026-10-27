import { describe, expect, it } from 'vitest';
import { blur, downscale, gaussianBlur, normalizePercentile } from '../src/core/image.js';
import { createPipeline } from '../src/core/pipeline.js';
import { DEFAULTS } from '../src/core/params.js';
import { mulberry32 } from '../src/core/rng.js';
import { syntheticImage } from './helpers.js';

function testField(w, h) {
  const rng = mulberry32(3);
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = rng() * 0.4 + (x > w / 2 ? 0.6 : 0);
  return f;
}

describe('blur', () => {
  for (const sigma of [1, 2.5, 6]) {
    it(`box blur stays within 3% of gaussian (σ=${sigma})`, () => {
      const w = 120, h = 90;
      const f = testField(w, h);
      const a = blur(f, w, h, sigma), b = gaussianBlur(f, w, h, sigma);
      let lo = Infinity, hi = -Infinity, err = 0;
      for (const v of f) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      for (let i = 0; i < a.length; i++) err = Math.max(err, Math.abs(a[i] - b[i]));
      expect(err).toBeLessThan(0.03 * (hi - lo));
    });
  }
});

describe('downscale', () => {
  const flat = (w, h, v) => ({ w, h, rgb: new Float32Array(w * h * 3).fill(v) });

  it('downscale keeps a flat colour', () => {
    const out = downscale(flat(333, 211, 0.37), 100);
    for (const v of out.rgb) expect(v).toBeCloseTo(0.37, 5);
  });

  it('downscale gives the requested long side', () => {
    const out = downscale(flat(800, 600, 0.5), 400);
    expect([out.w, out.h]).toEqual([400, 300]);
    expect(out.rgb.length).toBe(400 * 300 * 3);
    const tall = downscale(flat(300, 900, 0.5), 400);
    expect([tall.w, tall.h]).toEqual([133, 400]);
  });

  it('downscale returns the same image when it already fits', () => {
    const img = flat(300, 200, 0.5);
    expect(downscale(img, 400)).toBe(img);
  });

  it('downscale averages a checkerboard to grey', () => {
    const w = 800, h = 600, img = flat(w, h, 0);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.rgb.fill((x + y) % 2, (y * w + x) * 3, (y * w + x) * 3 + 3);
    const out = downscale(img, 400);
    for (const v of out.rgb) expect(v).toBeCloseTo(0.5, 5);
  });
});

describe('normalizePercentile', () => {
  it('percentile via histogram matches sort within 1/2048', () => {
    const rng = mulberry32(5);
    const a = Float32Array.from({ length: 5000 }, () => rng() ** 2 * 7);
    const sorted = Float32Array.from(a).sort();
    const p98 = sorted[Math.floor(0.98 * a.length)];
    const out = normalizePercentile(a, 0.98);
    // The value at the exact percentile should map close to 1.
    const i = a.indexOf(p98);
    expect(Math.abs(out[i] - 1)).toBeLessThan(2 / 2048 * 7 / p98 + 1e-3);
  });
});

describe('small images', () => {
  it('tiny image 64x64 runs the pipeline', async () => {
    const pipe = createPipeline();
    pipe.setImage(syntheticImage(64, 64));
    const res = await pipe.run({ ...DEFAULTS, sMax: 140, outLong: 64, supersample: 1 }, () => {});
    expect(res.shards).toBeGreaterThanOrEqual(1);
  });
});
