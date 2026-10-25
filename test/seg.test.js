import { describe, expect, it } from 'vitest';
import { partition } from '../src/seg/partition.js';

describe('partition', () => {
  it('each pixel takes the smallest mask covering it', () => {
    const w = 4, h = 4;
    const big = new Uint8Array(w * h);
    big.fill(1, 0, 12); // rows 0-2 only
    const small = new Uint8Array(w * h);
    for (const k of [5, 6, 9, 10]) small[k] = 1; // the 2x2 block at (1,1)
    const label = partition({ w, h, masks: [{ data: big, area: 12 }, { data: small, area: 4 }] });
    for (const k of [5, 6, 9, 10]) expect(label[k]).toBe(1);
    for (const k of [0, 1, 2, 3, 4, 7, 8, 11]) expect(label[k]).toBe(0);
    for (const k of [12, 13, 14, 15]) expect(label[k]).toBe(-1);
  });
});
