import { describe, expect, it } from 'vitest';
import { zonesDetailMask } from '../src/core/zones.js';

const zone = (mode, box) => ({ id: 1, mode, region: { box, w: 8, h: 8, data: new Uint8Array(64).fill(1) }, parts: null });

describe('zonesDetailMask', () => {
  it('less zones become -1 in the detail mask', () => {
    const m = zonesDetailMask([zone('less', [0, 0, 0.5, 1])], 32, 16);
    expect(m.w).toBe(32);
    expect(m.h).toBe(16);
    expect(m.data[8 * 32 + 3]).toBe(-1);
    expect(m.data[8 * 32 + 12]).toBe(-1);
    expect(m.data[8 * 32 + 16]).toBe(0);
    expect(m.data[8 * 32 + 30]).toBe(0);
  });

  it('no less zone gives null', () => {
    expect(zonesDetailMask(null)).toBeNull();
    expect(zonesDetailMask([zone('more', [0, 0, 1, 1])])).toBeNull();
  });
});
