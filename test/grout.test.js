import { describe, expect, it } from 'vitest';
import { autoGroutColor, hexToRgb } from '../src/core/color.js';
import { rgbToLab } from '../src/core/image.js';

const flat = (v, n = 64) => new Uint8ClampedArray(n * 4).map((_, i) => (i % 4 === 3 ? 255 : v));
const lightness = (hex) => rgbToLab(...hexToRgb(hex))[0];

describe('autoGroutColor', () => {
  it('is darker than most of the photo', () => {
    for (const v of [40, 120, 200]) {
      const photo = rgbToLab(v / 255, v / 255, v / 255)[0];
      expect(lightness(autoGroutColor(flat(v)))).toBeLessThan(photo);
    }
  });
  it('gets darker as the photo gets darker, within limits', () => {
    const dark = lightness(autoGroutColor(flat(20)));
    const mid = lightness(autoGroutColor(flat(128)));
    const light = lightness(autoGroutColor(flat(250)));
    expect(dark).toBeLessThan(mid);
    expect(mid).toBeLessThan(light);
    expect(dark).toBeGreaterThanOrEqual(9.5);
    expect(light).toBeLessThanOrEqual(60.5);
  });
  it('returns a hex colour', () => {
    expect(autoGroutColor(flat(90))).toMatch(/^#[0-9a-f]{6}$/);
  });
});
