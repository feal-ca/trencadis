import { describe, expect, it } from 'vitest';
import { OUT_SIZES, printSize } from '../src/ui/exportSize.js';

describe('printSize', () => {
  it('gives the centimetres at 300 ppp', () => {
    expect(printSize(2000)).toBe('17 cm a 300 ppp');
    expect(printSize(4000)).toBe('34 cm a 300 ppp');
    expect(printSize(1200)).toBe('10 cm a 300 ppp');
  });
  it('offers the four sizes', () => {
    expect(OUT_SIZES).toEqual([1200, 2000, 3000, 4000]);
  });
});
