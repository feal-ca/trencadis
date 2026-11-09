import { describe, expect, it } from 'vitest';
import { applyPalette, shardColors } from '../src/core/color.js';
import { oklabToRgb, rgbToOklab } from '../src/core/image.js';
import { DEFAULTS } from '../src/core/params.js';
import { mulberry32 } from '../src/core/rng.js';

const square = (x, y, s) => ({ poly: [[x, y], [x + s, y], [x + s, y + s], [x, y + s]] });

// A w x h image filled by `fn(x, y) -> [r, g, b]`.
function image(w, h, fn) {
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.set(fn(x, y), (y * w + x) * 3);
  return { w, h, rgb };
}

const plain = { ...DEFAULTS, colorMode: 'mean', saturation: 1, lightness: 0, colorJitter: 0, palette: 'none' };

describe('OKLab', () => {
  it('goes to OKLab and back', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      const c = [rng(), rng(), rng()];
      const back = oklabToRgb(...rgbToOklab(...c));
      for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(c[k], 4);
    }
  });

  it('brings a colour outside sRGB inside by lowering its chroma, keeping the hue', () => {
    const [L, a, b] = [0.6, 0.4, 0.2];
    const rgb = oklabToRgb(L, a, b);
    for (const c of rgb) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); }
    const back = rgbToOklab(...rgb);
    expect(back[0]).toBeCloseTo(L, 2);
    expect(Math.atan2(back[2], back[1])).toBeCloseTo(Math.atan2(b, a), 2);
    expect(Math.hypot(back[1], back[2])).toBeLessThan(Math.hypot(a, b));
  });
});

describe('shardColors', () => {
  it('averages in linear light: half black, half white is a light grey', () => {
    const img = image(8, 8, (x) => (x < 4 ? [0, 0, 0] : [1, 1, 1]));
    const [r] = shardColors([square(0, 0, 8)], img, plain);
    // The linear mean 0.5 is 0.735 in sRGB; averaging sRGB codes gives 0.5.
    expect(r).toBeCloseTo(0.735, 2);
  });

  it('keeps the perceived lightness when the saturation goes to zero', () => {
    const blue = [0.1, 0.2, 0.9];
    const img = image(8, 8, () => blue);
    const [r, g, b] = shardColors([square(0, 0, 8)], img, { ...plain, saturation: 0 });
    expect(r).toBeCloseTo(g, 4);
    expect(g).toBeCloseTo(b, 4);
    expect(rgbToOklab(r, g, b)[0]).toBeCloseTo(rgbToOklab(...blue)[0], 3);
  });

  it('keeps the hue when the saturation goes up past what sRGB can show', () => {
    const c = [0.85, 0.35, 0.2];
    const img = image(8, 8, () => c);
    const out = shardColors([square(0, 0, 8)], img, { ...plain, saturation: 2.5 });
    const [, a0, b0] = rgbToOklab(...c), [, a1, b1] = rgbToOklab(...out);
    expect(Math.atan2(b1, a1)).toBeCloseTo(Math.atan2(b0, a0), 1);
    expect(Math.hypot(a1, b1)).toBeGreaterThan(Math.hypot(a0, b0));
  });
});

describe('applyPalette with dithering', () => {
  // A horizontal grey ramp cut into a grid of square pieces, and two palette
  // colours from k-means: without dithering each piece snaps to the nearer
  // one; with it, the local mean follows the ramp.
  const N = 24, S = 4;
  const shards = [];
  const colors = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      shards.push(square(i * S, j * S, S));
      const v = 0.15 + (0.7 * i) / (N - 1);
      colors.push(v, v, v);
    }
  }
  const flat = Float32Array.from(colors);
  const run = (dither, extra = {}) => applyPalette(flat, shards, { ...plain, palette: 'kmeans', paletteK: 2, paletteMix: 1, paletteDither: dither, ...extra }, mulberry32(5)).colors;
  // Error of the mean lightness of each column against the ramp, over the
  // columns whose lightness lies between the two palette colours (no mix of
  // them can reach the others).
  const lightness = (c, k) => rgbToOklab(c[k * 3], c[k * 3 + 1], c[k * 3 + 2])[0];
  const columnError = (out) => {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < N * N; k++) { lo = Math.min(lo, lightness(out, k)); hi = Math.max(hi, lightness(out, k)); }
    let e = 0, cols = 0;
    for (let i = 0; i < N; i++) {
      let m = 0, want = 0;
      for (let j = 0; j < N; j++) { m += lightness(out, j * N + i); want += lightness(flat, j * N + i); }
      if (want / N < lo + 0.02 || want / N > hi - 0.02) continue;
      e += Math.abs(m - want) / N;
      cols++;
    }
    return e / cols;
  };

  it('makes the local mean follow a gradient the palette cannot show', () => {
    const hard = columnError(run(0)), soft = columnError(run(1));
    expect(soft).toBeLessThan(hard * 0.35);
  });

  it('only uses palette colours at full strength', () => {
    const out = run(1);
    const seen = new Set();
    for (let k = 0; k < out.length / 3; k++) seen.add(out.slice(k * 3, k * 3 + 3).map((v) => v.toFixed(3)).join());
    expect(seen.size).toBe(2);
  });

  it('leaves row pieces as they would be without it', () => {
    const rowShards = shards.map((s, k) => (k % 7 === 0 ? { ...s, row: true } : s));
    const at = (dither) => applyPalette(flat, rowShards, { ...plain, palette: 'kmeans', paletteK: 2, paletteMix: 1, paletteDither: dither }, mulberry32(5)).colors;
    const a = at(0), b = at(1);
    rowShards.forEach((s, k) => {
      if (s.row) expect([...b.slice(k * 3, k * 3 + 3)]).toEqual([...a.slice(k * 3, k * 3 + 3)]);
    });
  });

  it('does nothing without a palette', () => {
    const a = applyPalette(flat, shards, { ...plain, paletteDither: 0 }, mulberry32(5)).colors;
    const b = applyPalette(flat, shards, { ...plain, paletteDither: 1 }, mulberry32(5)).colors;
    expect([...b]).toEqual([...a]);
  });
});
