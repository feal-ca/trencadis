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

import { textureAndEdge } from './helpers.js';

describe('detail control', () => {
  const img = textureAndEdge();
  const mean = (an, x0, x1) => {
    let s = 0, n = 0;
    for (let y = 20; y < an.h - 20; y++) for (let x = x0; x < x1; x++) { s += an.detail[y * an.w + x]; n++; }
    return s / n;
  };

  it('ignoreTexture lowers detail in directionless texture far more than at an edge', () => {
    const base = analyze(img, { ...DEFAULTS, ignoreTexture: 0, exactAnalysis: true });
    const supp = analyze(img, { ...DEFAULTS, ignoreTexture: 1, exactAnalysis: true });
    const texBefore = mean(base, 20, 100), texAfter = mean(supp, 20, 100);
    const edgeBefore = mean(base, 172, 188), edgeAfter = mean(supp, 172, 188);
    expect(texAfter / texBefore).toBeLessThan(0.4);
    expect(edgeAfter / edgeBefore).toBeGreaterThan(0.7);
  });

  it('a negative mask removes detail where painted', () => {
    const mask = { w: 64, h: 43, data: new Float32Array(64 * 43) };
    for (let y = 0; y < 43; y++) for (let x = 0; x < 32; x++) mask.data[y * 64 + x] = -1;
    const an = analyze(img, { ...DEFAULTS, exactAnalysis: true }, mask);
    expect(mean(an, 10, 100)).toBeLessThan(0.02);
    expect(an.size[80 * an.w + 40]).toBeCloseTo(DEFAULTS.sMax, 3);
  });

  it('a positive mask adds detail where painted', () => {
    const mask = { w: 64, h: 43, data: new Float32Array(64 * 43).fill(1) };
    const an = analyze(img, { ...DEFAULTS, exactAnalysis: true }, mask);
    expect(mean(an, 20, 100)).toBeGreaterThan(0.95);
  });
});
