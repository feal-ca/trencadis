import { describe, expect, it } from 'vitest';
import { createLongPress, nearestLine } from '../src/ui/longPress.js';

// A long press that records where it fired.
function setup() {
  const fired = [];
  const lp = createLongPress({ delay: 450, slop: 6, onFire: (x, y) => fired.push([x, y]) });
  return { lp, fired };
}

describe('createLongPress', () => {
  it('fires after the delay without movement', () => {
    const { lp, fired } = setup();
    lp.down(1, 100, 50, 0);
    lp.move(1, 103, 52);
    lp.tick(300);
    expect(fired).toEqual([]);
    lp.tick(460);
    expect(fired).toEqual([[100, 50]]);
    // It fires once.
    lp.tick(900);
    expect(fired).toHaveLength(1);
  });

  it('a move beyond slop cancels', () => {
    const { lp, fired } = setup();
    lp.down(1, 100, 50, 0);
    lp.move(1, 108, 50);
    lp.move(1, 100, 50);
    lp.tick(600);
    expect(fired).toEqual([]);
    expect(lp.up(1)).toBe(null);
  });

  it('a second pointer cancels (pinch)', () => {
    const { lp, fired } = setup();
    lp.down(1, 100, 50, 0);
    lp.down(2, 200, 50, 100);
    lp.tick(600);
    expect(fired).toEqual([]);
    lp.up(2);
    lp.tick(1200);
    expect(fired).toEqual([]);
    expect(lp.up(1)).toBe(null);
    // cancel() also stops a press in progress.
    lp.down(3, 10, 10, 2000);
    lp.cancel();
    lp.tick(3000);
    expect(fired).toEqual([]);
  });

  it('up after firing reports fired', () => {
    const { lp } = setup();
    lp.down(1, 100, 50, 0);
    lp.tick(500);
    expect(lp.up(1)).toBe('fired');
    // The next press starts afresh.
    lp.down(2, 100, 50, 1000);
    expect(lp.up(2)).toBe(null);
  });
});

describe('nearestLine', () => {
  it('nearestLine picks the closest of two parallel lines and respects maxDist', () => {
    // Two horizontal lines in a 2:1 image, at v = 0.4 and v = 0.6.
    const lines = [[[0.1, 0.4], [0.9, 0.4]], [[0.1, 0.6], [0.5, 0.6], [0.9, 0.6]]];
    const hit = nearestLine(lines, 0.5, 0.56, 2, 0.05);
    expect(hit.index).toBe(1);
    // 0.04 of the height is 0.02 of the long side.
    expect(hit.dist).toBeCloseTo(0.02, 6);
    expect(nearestLine(lines, 0.5, 0.45, 2, 0.05).index).toBe(0);
    // Past the end of a segment the distance is to its end point.
    expect(nearestLine(lines, 0.95, 0.4, 2, 0.06).dist).toBeCloseTo(0.05, 6);
    expect(nearestLine(lines, 0.5, 0.5, 2, 0.04)).toBe(null);
    expect(nearestLine([], 0.5, 0.5, 2, 0.04)).toBe(null);
  });
});
