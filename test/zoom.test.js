import { describe, expect, it } from 'vitest';
import { zoomAt } from '../src/ui/zoom.js';

describe('zoomAt', () => {
  it('keeps the point under the pointer', () => {
    const w = 400, h = 300, px = 120, py = 90;
    const a = zoomAt({ k: 2, x: -100, y: -60 }, 1.5, px, py, w, h);
    expect(a.k).toBeCloseTo(3);
    // The image point under (px, py) is the same before and after.
    expect((px - a.x) / a.k).toBeCloseTo((px + 100) / 2);
    expect((py - a.y) / a.k).toBeCloseTo((py + 60) / 2);
  });
  it('clamps k between 1 and 8', () => {
    expect(zoomAt({ k: 7, x: 0, y: 0 }, 3, 10, 10, 400, 300).k).toBe(8);
    expect(zoomAt({ k: 1.2, x: 0, y: 0 }, 0.1, 10, 10, 400, 300).k).toBe(1);
  });
  it('at k 1 the translation is 0', () => {
    expect(zoomAt({ k: 2, x: -150, y: -80 }, 0.2, 200, 150, 400, 300)).toEqual({ k: 1, x: 0, y: 0 });
  });
  it('limits the translation to the box', () => {
    const z = zoomAt({ k: 1, x: 0, y: 0 }, 2, 0, 0, 400, 300);
    expect(z.x).toBeGreaterThanOrEqual(400 * (1 - z.k));
    expect(z.x).toBeLessThanOrEqual(0);
  });
});
