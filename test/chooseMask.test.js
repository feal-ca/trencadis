import { describe, expect, it } from 'vitest';
import { chooseMask } from '../src/seg/chooseMask.js';

describe('chooseMask', () => {
  it('one tap takes the smallest confident mask, not the most confident', () => {
    // Face (best IoU), eye, iris.
    expect(chooseMask([0.95, 0.93, 0.92], [5000, 400, 60], 1)).toBe(2);
  });

  it('each further tap takes the next larger confident mask', () => {
    const ious = [0.95, 0.93, 0.92], areas = [5000, 400, 60];
    expect(chooseMask(ious, areas, 2)).toBe(1);
    expect(chooseMask(ious, areas, 3)).toBe(0);
  });

  it('more taps than candidates stay on the largest', () => {
    expect(chooseMask([0.95, 0.93, 0.92], [5000, 400, 60], 7)).toBe(0);
    expect(chooseMask([0.95, 0.5, 0.4], [5000, 400, 60], 4)).toBe(0);
  });

  it('only masks within 0.05 of the best IoU count', () => {
    expect(chooseMask([0.9, 0.85, 0.849], [5000, 400, 60], 1)).toBe(1);
    expect(chooseMask([0.9, 0.85, 0.849], [5000, 400, 60], 2)).toBe(0);
  });

  it('empty masks never count, even with the best IoU', () => {
    expect(chooseMask([0.99, 0.9, 0.7], [0, 400, 60], 1)).toBe(1);
    expect(chooseMask([0.9, 0.95, 0.7], [500, 0, 60], 1)).toBe(0);
  });

  it('all masks empty gives -1', () => {
    expect(chooseMask([0.9, 0.8, 0.7], [0, 0, 0], 1)).toBe(-1);
  });

  it('ties in area keep the model order; ties in IoU all count', () => {
    expect(chooseMask([0.9, 0.9, 0.9], [100, 100, 50], 1)).toBe(2);
    expect(chooseMask([0.9, 0.9, 0.9], [100, 100, 50], 2)).toBe(0);
    expect(chooseMask([0.9, 0.9, 0.9], [100, 100, 50], 3)).toBe(1);
  });

  it('works on typed arrays as the model returns them', () => {
    expect(chooseMask(Float32Array.of(0.95, 0.93, 0.92), [5000, 400, 60], 1)).toBe(2);
  });
});
