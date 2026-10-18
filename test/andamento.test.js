import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis.js';
import { extractGuides, overlayRows } from '../src/core/andamento.js';
import { toLab } from '../src/core/image.js';
import { DEFAULTS } from '../src/core/params.js';
import { area, bbox, centroid, rasterize } from '../src/core/polygon.js';
import { mulberry32 } from '../src/core/rng.js';
import { splitComponents } from '../src/core/slivers.js';
import { tessellate } from '../src/core/tessellate.js';
import { discImage, flatImage, syntheticImage } from './helpers.js';

const pathLength = (g) => g.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - g[i][0], p[1] - g[i][1]), 0);

describe('guides', () => {
  it('finds the outline of a disc as a long guide', () => {
    const img = discImage();
    const p = { ...DEFAULTS, autoGuides: 0.5 };
    const guides = extractGuides(img, analyze(img, p), p);
    const longest = guides.reduce((a, g) => (pathLength(g) > pathLength(a) ? g : a), []);
    expect(pathLength(longest)).toBeGreaterThan(150);
    const err = longest.reduce((s, [x, y]) => s + Math.abs(Math.hypot(x - 120, y - 100) - 60), 0) / longest.length;
    expect(err).toBeLessThan(3);
  });

  it('keeps to strong contours on a busy image', () => {
    const img = syntheticImage(800, 947);
    const p = { ...DEFAULTS, autoGuides: 0.5 };
    const total = extractGuides(img, analyze(img, p), p).reduce((s, g) => s + pathLength(g), 0);
    expect(total).toBeLessThan(4 * (800 + 947));
  });

  it('autoGuides 0 finds nothing', () => {
    const img = discImage();
    const p = { ...DEFAULTS, autoGuides: 0 };
    expect(extractGuides(img, analyze(img, p), p)).toEqual([]);
  });
});

describe('rows', () => {
  const img = flatImage(300, 200);
  const base = (p) => tessellate(img, toLab(img), analyze(img, p), p, mulberry32(2)).shards;
  const line = [[20, 100], [280, 100]];

  it('a single centred row of pieces follows the line', () => {
    const p = { ...DEFAULTS, rowWidth: 8, rowLength: 2, rowCount: 1 };
    const shards = overlayRows(base(p), [line], img.w, img.h, p, mulberry32(1));
    const rows = shards.filter((s) => s.row);
    expect(rows.length).toBeGreaterThan(11);
    expect(rows.length).toBeLessThan(22);
    for (const s of rows) {
      const [, y0, , y1] = bbox(s.poly);
      expect(y1 - y0).toBeGreaterThan(5);
      expect(y1 - y0).toBeLessThan(11);
      expect(Math.abs(centroid(s.poly)[1] - 100)).toBeLessThan(3);
    }
  });

  it('no gaps on a detailed image either', () => {
    const img2 = syntheticImage(400, 300);
    const p = { ...DEFAULTS, sMin: 4, sMax: 20, rowWidth: 8, rowCount: 2 };
    const b2 = tessellate(img2, toLab(img2), analyze(img2, p), p, mulberry32(2)).shards;
    const shards = overlayRows(b2, [[[20, 150], [200, 60], [380, 150]]], img2.w, img2.h, p);
    // Rasterise everything and count pixels nobody covers.
    const cover = new Uint8Array(img2.w * img2.h);
    for (const s of shards) rasterize(s.poly, img2.w, img2.h, (x, y) => { cover[y * img2.w + x] = 1; });
    const holes = cover.reduce((n, c) => n + (c ? 0 : 1), 0) / cover.length;
    expect(holes).toBeLessThan(0.01);
  });

  it('background pieces reach the rows: no gaps', () => {
    const p = { ...DEFAULTS, rowWidth: 8, rowLength: 2, rowCount: 2 };
    const shards = overlayRows(base(p), [line], img.w, img.h, p, mulberry32(1));
    const covered = shards.reduce((s, sh) => s + area(sh.poly), 0) / (img.w * img.h);
    expect(covered).toBeGreaterThan(0.97);
    // Original polygons next to re-traced ones overlap by a fraction of a
    // pixel along their shared edge; rows are drawn on top.
    expect(covered).toBeLessThan(1.05);
  });

  it('rowCount 3 spans three widths around the line', () => {
    const p = { ...DEFAULTS, rowWidth: 8, rowLength: 2, rowCount: 3 };
    const rows = overlayRows(base(p), [line], img.w, img.h, p, mulberry32(1)).filter((s) => s.row);
    const ys = rows.flatMap((s) => s.poly.map((q) => q[1]));
    expect(Math.min(...ys)).toBeGreaterThan(100 - 14);
    expect(Math.max(...ys)).toBeLessThan(100 + 14);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
  });
});

describe('rows leave the rest alone', () => {
  it('background pieces away from the rows are kept as they were', () => {
    const img = syntheticImage(400, 300);
    const p = { ...DEFAULTS, sMin: 4, sMax: 20 };
    const base = tessellate(img, toLab(img), analyze(img, p), p, mulberry32(2)).shards;
    const line = [[20, 20], [380, 20]];
    const out = overlayRows(base, [line], img.w, img.h, p);
    const far = (s) => centroid(s.poly)[1] > 60;
    const before = base.filter(far).length, after = out.filter((s) => !s.row && far(s)).length;
    expect(after).toBeGreaterThan(before * 0.95);
  });
});

describe('splitComponents', () => {
  it('gives each disconnected part of a label its own label', () => {
    const w = 10, h = 4;
    const labels = new Int32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = x >= 4 && x < 6 ? 1 : 0;
    const { labels: out } = splitComponents(labels, w, h);
    expect(new Set(out).size).toBe(3);
  });
});
