import { describe, expect, it } from 'vitest';
import { inside, regionAt } from '../src/ui/shapeMask.js';

// A 2 x 2 mask over the box [0.4, 0.4, 0.6, 0.6]: its top-left cell is off.
const region = { box: [0.4, 0.4, 0.6, 0.6], w: 2, h: 2, data: new Uint8Array([0, 1, 1, 1]) };

describe('shape hit test', () => {
  it('a point on the mask is inside', () => {
    expect(inside(region, 0.55, 0.55)).toBe(true);
    expect(inside(region, 0.55, 0.45)).toBe(true);
  });
  it('a point outside the box is not', () => {
    expect(inside(region, 0, 0)).toBe(false);
    expect(inside(region, 0.7, 0.5)).toBe(false);
    expect(inside(region, 0.5, 0.39)).toBe(false);
  });
  it('a point in the box but off the mask is not', () => {
    expect(inside(region, 0.45, 0.45)).toBe(false);
  });
  it('the overlay labels match, pixel by pixel', () => {
    // On a 10 x 10 overlay the box covers pixels 4 and 5 in each direction.
    const at = regionAt(region, 10, 10);
    expect(at(4, 4)).toBe(-1);
    expect(at(5, 4)).toBe(0);
    expect(at(5, 5)).toBe(0);
    expect(at(3, 5)).toBe(-1);
    expect(at(6, 5)).toBe(-1);
  });
});
