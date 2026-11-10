import { describe, expect, it } from 'vitest';
import { autoGroutColor, MORTAR_LIGHT, MORTAR_MID } from '../src/core/color.js';

const flat = (v, n = 64) => new Uint8ClampedArray(n * 4).map((_, i) => (i % 4 === 3 ? 255 : v));

describe('autoGroutColor', () => {
  it('is light cement on a bright photo and a mid grey on a dark one', () => {
    expect(autoGroutColor(flat(200))).toBe(MORTAR_LIGHT);
    expect(autoGroutColor(flat(40))).toBe(MORTAR_MID);
  });
  it('returns a hex colour', () => {
    expect(autoGroutColor(flat(90))).toMatch(/^#[0-9a-f]{6}$/);
  });
});
