import { describe, expect, it } from 'vitest';
import { PLACE, placementRandoms, placePolygon } from '../src/core/placement.js';
import { area, centroid } from '../src/core/polygon.js';

describe('placement', () => {
  const poly = [[0, 0], [30, 0], [30, 20], [0, 20]];

  it('amount 0 leaves the piece untouched', () => {
    const r = placementRandoms(1, 7)[0];
    expect(placePolygon(poly, r, 0)).toEqual(poly);
  });

  it('amount 1 shrinks, rotates at most the max angle and moves at most the max offset', () => {
    const rs = placementRandoms(50, 7);
    for (const r of rs) {
      const q = placePolygon(poly, r, 1);
      expect(area(q)).toBeCloseTo(area(poly) * (1 - PLACE.shrink) ** 2, 6);
      const [cx, cy] = centroid(q);
      expect(Math.hypot(cx - 15, cy - 10)).toBeLessThanOrEqual(PLACE.offset + 1e-9);
      const ang = Math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]);
      expect(Math.abs(ang)).toBeLessThanOrEqual((PLACE.angle * Math.PI) / 180 + 1e-9);
    }
  });
});
