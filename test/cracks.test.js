import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis.js';
import { growCracks } from '../src/core/cracks.js';
import { mergeSlivers, regionWidths } from '../src/core/slivers.js';
import { DEFAULTS } from '../src/core/params.js';
import { mulberry32 } from '../src/core/rng.js';
import { syntheticImage } from './helpers.js';

describe('slivers', () => {
  it('merges a thin strip into a neighbour', () => {
    const w = 120, h = 60;
    const labels = new Int32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = x < 58 ? 0 : x < 61 ? 1 : 2;
    const size = new Float32Array(w * h).fill(20);
    const out = mergeSlivers(labels, w, h, size, 0.3);
    expect(new Set(out).size).toBe(2);
    expect(out[30 * w + 59]).not.toBe(1);
  });

  it('leaves regions thicker than the threshold alone', () => {
    const w = 120, h = 60;
    const labels = new Int32Array(w * h);
    for (let i = 0; i < labels.length; i++) labels[i] = i % w < 60 ? 0 : 1;
    const out = mergeSlivers(labels, w, h, new Float32Array(w * h).fill(20), 0.3);
    expect(new Set(out).size).toBe(2);
  });
});

describe('crack spacing', () => {
  it('minimum gap plus sliver merging leaves almost no thin pieces', () => {
    const img = syntheticImage(320, 220);
    const p = { ...DEFAULTS, algorithm: 'cracks' };
    const an = analyze(img, p);
    const thin = (gap, minWidth) => {
      const { labels } = growCracks(an, { ...p, crackGap: gap }, mulberry32(5));
      const merged = mergeSlivers(labels, img.w, img.h, an.size, minWidth);
      let n = 0;
      for (const [, width] of regionWidths(merged, img.w, img.h)) if (width < 3) n++;
      return n;
    };
    expect(thin(0.35, 0.3)).toBeLessThan(thin(0, 0) * 0.2);
  });
});

describe('crack count', () => {
  it('the minimum gap does not stop crack growth early', () => {
    const img = syntheticImage(400, 300);
    const p = { ...DEFAULTS, algorithm: 'cracks', minWidth: 0 };
    const an = analyze(img, p);
    const regions = (gap) => new Set(growCracks(an, { ...p, crackGap: gap }, mulberry32(9)).labels).size;
    expect(regions(0.35)).toBeGreaterThan(regions(0) * 0.6);
  });
});
