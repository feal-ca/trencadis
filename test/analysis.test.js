import { describe, expect, it } from 'vitest';
import { analyze, analyzeMaps, withSize } from '../src/core/analysis.js';
import { DEFAULTS as BASE } from '../src/core/params.js';

// The size field of analysis.js still takes a gamma; the app no longer sets one.
const DEFAULTS = { ...BASE, gamma: 0.7 };
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

import { sizeFromDetail } from '../src/core/analysis.js';

describe('detail stays finite', () => {
  it('rounding noise below zero never turns into NaN sizes', () => {
    // Box-blur running sums can leave values like -3e-19 where 0 is meant.
    const size = sizeFromDetail(Float32Array.of(-2.9e-19, 0, 0.5, 1 + 1e-7), { ...DEFAULTS, gamma: 0.78 });
    expect(Array.from(size).every(Number.isFinite)).toBe(true);
    expect(size[0]).toBeCloseTo(DEFAULTS.sMax, 6);
  });

  it('ignoreTexture at its maximum never yields NaN', () => {
    const img = textureAndEdge(400, 300);
    for (const exactAnalysis of [false, true]) {
      const an = analyze(img, { ...DEFAULTS, ignoreTexture: 1, exactAnalysis });
      expect(an.detail.every((v) => v >= 0 && v <= 1)).toBe(true);
      expect(an.size.every(Number.isFinite)).toBe(true);
    }
  });

  it('a fully painted remove-detail brush never yields NaN', () => {
    const img = textureAndEdge(400, 300);
    const mask = { w: 64, h: 48, data: new Float32Array(64 * 48).fill(-1) };
    const an = analyze(img, { ...DEFAULTS, exactAnalysis: true }, mask);
    expect(an.size.every(Number.isFinite)).toBe(true);
  });

  it('analyze equals withSize of analyzeMaps', () => {
    // The second image goes through the half-resolution path.
    for (const img of [syntheticImage(240, 160), syntheticImage(400, 320)]) {
      const whole = analyze(img, DEFAULTS);
      const parts = withSize(analyzeMaps(img, DEFAULTS), DEFAULTS);
      expect(Object.keys(parts).sort()).toEqual(Object.keys(whole).sort());
      for (const k of ['detail', 'size', 'theta', 'coherence']) {
        // Byte equality is exact (NaN-safe) and avoids element-wise deep equality on large arrays.
        const a = parts[k], b = whole[k];
        expect(a.length).toBe(b.length);
        const ba = Buffer.from(a.buffer, a.byteOffset, a.byteLength);
        const bb = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
        expect(Buffer.compare(ba, bb), k).toBe(0);
      }
    }
  });
});

describe('colour edges', () => {
  // A red disc on green with the same luma: invisible to a luma-only analysis.
  // A black band on the left gives a strong luma edge, as any photo has, so
  // the detail map's scale is set by a real edge.
  const w = 200, h = 160, r = 45, cx = 110, cy = 80;
  const red = [0.8, 0.3, 0.3], green = [0.2, 0.488, 0.2];
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set(x < 20 ? [0, 0, 0] : Math.hypot(x - cx, y - cy) < r ? red : green, (y * w + x) * 3);
  const img = { w, h, rgb };
  const an = analyze(img, { ...DEFAULTS, exactAnalysis: true });
  const at = (f, x, y) => f[y * w + x];

  it('uses two colours of the same luma', () => {
    expect(Math.abs(luma(red) - luma(green))).toBeLessThan(0.002);
  });

  it('finds detail along the border and none inside or far away', () => {
    expect(at(an.detail, cx + r, cy)).toBeGreaterThan(0.4);
    expect(at(an.detail, cx, cy - r)).toBeGreaterThan(0.4);
    expect(at(an.detail, cx, cy)).toBeLessThan(0.05);
    expect(at(an.detail, w - 5, 5)).toBeLessThan(0.05);
  });

  it('gives the border as the edge direction', () => {
    // On the right of the disc the border runs vertically.
    const t = ((at(an.theta, cx + r, cy) % Math.PI) + Math.PI) % Math.PI;
    expect(Math.abs(t - Math.PI / 2)).toBeLessThan(0.1);
    expect(at(an.coherence, cx + r, cy)).toBeGreaterThan(0.5);
  });
});
