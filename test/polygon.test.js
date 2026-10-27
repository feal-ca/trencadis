import { describe, expect, it } from 'vitest';
import { douglasPeucker } from '../src/core/polygon.js';

describe('douglasPeucker', () => {
  it('douglasPeucker collapses a straight run to its ends', () => {
    expect(douglasPeucker([[0, 0], [1, 0], [2, 0], [3, 0]], 0.1)).toEqual([[0, 0], [3, 0]]);
  });

  it('douglasPeucker keeps the farthest point of a closed run', () => {
    // The ends coincide: the distance is measured to that point.
    expect(douglasPeucker([[0, 0], [5, 10], [0, 0]], 1)).toEqual([[0, 0], [5, 10], [0, 0]]);
  });

  it('douglasPeucker with eps 0 keeps every point', () => {
    const pts = [[0, 0], [1, 1], [2, 0], [3, 1]];
    expect(douglasPeucker(pts, 0)).toEqual(pts);
  });
});
