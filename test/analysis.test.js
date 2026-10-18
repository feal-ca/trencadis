import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis.js';
import { DEFAULTS } from '../src/core/params.js';
import { syntheticImage } from './helpers.js';

describe('analysis', () => {
  it('half-resolution analysis stays close to full resolution', () => {
    const img = syntheticImage(700, 520);
    const fast = analyze(img, DEFAULTS);
    const exact = analyze(img, { ...DEFAULTS, exactAnalysis: true });
    expect(fast.w).toBe(700);
    expect(fast.size.length).toBe(700 * 520);
    let err = 0;
    for (let i = 0; i < exact.size.length; i++) err += Math.abs(fast.size[i] - exact.size[i]);
    const meanErr = err / exact.size.length;
    // Mean size error under 6% of the size range.
    expect(meanErr).toBeLessThan(0.06 * (DEFAULTS.sMax - DEFAULTS.sMin));
  });
});
