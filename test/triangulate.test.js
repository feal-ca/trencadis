import { describe, expect, it } from 'vitest';
import { triangulate } from '../src/gl/triangulate.js';
import { area } from '../src/core/polygon.js';

function trianglesArea(positions) {
  let s = 0;
  for (let i = 0; i < positions.length; i += 6) {
    const [ax, ay, bx, by, cx, cy] = positions.slice(i, i + 6);
    s += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  return s;
}

describe('triangulate', () => {
  const square = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const ell = [[10, 0], [16, 0], [16, 2], [12, 2], [12, 6], [10, 6]];

  it('triangulated area equals polygon area', () => {
    for (const poly of [square, ell]) {
      const { positions } = triangulate([{ poly }]);
      expect(trianglesArea(positions)).toBeCloseTo(area(poly), 6);
    }
  });

  it('ids follow area-descending order', () => {
    const { ids } = triangulate([{ poly: ell }, { poly: square }]);
    // The L (area 20) is bigger than the square (16), so it goes first.
    expect(ids[0]).toBe(0);
    expect(ids[ids.length - 1]).toBe(1);
    const { ids: ids2 } = triangulate([{ poly: square }, { poly: ell }]);
    expect(ids2[0]).toBe(1);
  });
});
