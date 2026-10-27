import { describe, expect, it } from 'vitest';
import { pointerToUV } from '../src/ui/geometry.js';

// A 200 x 100 canvas drawn with object-fit: contain in a 400 x 400 box.
const canvas = { width: 200, height: 100, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }) };

describe('pointerToUV', () => {
  it('the centre of the box is the centre of the image', () => {
    const [u, v] = pointerToUV(canvas, { clientX: 200, clientY: 200 });
    expect(u).toBeCloseTo(0.5);
    expect(v).toBeCloseTo(0.5);
  });

  it('the empty band above the image gives v < 0, not a clamped value', () => {
    const [, v] = pointerToUV(canvas, { clientX: 200, clientY: 50 });
    expect(v).toBeLessThan(0);
  });
});
