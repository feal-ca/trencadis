import { describe, expect, it } from 'vitest';
import { blur, gaussianBlur, normalizePercentile } from '../src/core/image.js';
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
