import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis.js';
import { toLab } from '../src/core/image.js';
import { DEFAULTS } from '../src/core/params.js';
import { mulberry32 } from '../src/core/rng.js';
import { segmentGuides } from '../src/core/seglines.js';
import { tessellate } from '../src/core/tessellate.js';
import { flatImage, syntheticImage } from './helpers.js';

// A disc-shaped object on a 120 x 80 label grid (a quarter of the photo's size).
function discSegments() {
  const w = 60, h = 40, labels = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = Math.hypot(x - 30, y - 20) < 12 ? 1 : 0;
  return { w, h, labels };
}

describe('hileras along segmented objects', () => {
  const p = { ...DEFAULTS, sMin: 7, sMax: 20 };

  it('traces the outline of an object at working resolution', () => {
    const lines = segmentGuides(discSegments(), 240, 160, p);
    // Every point lies on the circle of radius 48 around (120, 80), and the
    // lines go most of the way round (a loop may be traced in pieces).
    let len = 0;
    for (const line of lines) {
      for (const [x, y] of line) expect(Math.abs(Math.hypot(x - 120, y - 80) - 48)).toBeLessThan(4);
      for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
    expect(len).toBeGreaterThan(0.85 * 2 * Math.PI * 48);
  });

  it('lays rows over a flat photo where only the model sees an object', () => {
    const img = flatImage(240, 160);
    const an = analyze(img, p);
    const rows = (seg, q) => tessellate(img, toLab(img), an, q, mulberry32(1), null, seg).shards.filter((s) => s.row).length;
    expect(rows(discSegments(), p)).toBeGreaterThan(10);
    expect(rows(null, p)).toBe(0);
  });

  it('tessellate lays rows only along segment borders', () => {
    const img = syntheticImage(240, 160);
    const an = analyze(img, p);
    const kind = (seg) => tessellate(img, toLab(img), an, p, mulberry32(1), null, seg).structure.kind;
    expect(kind(discSegments())).toBe('guides');
    expect(kind(null)).not.toBe('guides');
  });
});
