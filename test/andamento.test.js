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
  // On a flat image s(x) = sMax everywhere, so rowScale = 8 / sMax gives 8 px pieces.
  const eight = 8 / DEFAULTS.sMax;
  const rowsOver = (p, guides) => overlayRows(base(p), guides, img.w, img.h, p, analyze(img, p));

  it('a single centred row of pieces follows the line', () => {
    const p = { ...DEFAULTS, rowScale: eight, rowLength: 2, rowCount: 1 };
    const shards = rowsOver(p, [line]);
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
    const p = { ...DEFAULTS, sMin: 4, sMax: 20, rowCount: 2 };
    const an2 = analyze(img2, p);
    const b2 = tessellate(img2, toLab(img2), an2, p, mulberry32(2)).shards;
    const shards = overlayRows(b2, [[[20, 150], [200, 60], [380, 150]]], img2.w, img2.h, p, an2);
    // Rasterise everything and count pixels nobody covers.
    const cover = new Uint8Array(img2.w * img2.h);
    for (const s of shards) rasterize(s.poly, img2.w, img2.h, (x, y) => { cover[y * img2.w + x] = 1; });
    const holes = cover.reduce((n, c) => n + (c ? 0 : 1), 0) / cover.length;
    expect(holes).toBeLessThan(0.01);
  });

  it('background pieces reach the rows: no gaps', () => {
    const p = { ...DEFAULTS, rowScale: eight, rowLength: 2, rowCount: 2 };
    const shards = rowsOver(p, [line]);
    const covered = shards.reduce((s, sh) => s + area(sh.poly), 0) / (img.w * img.h);
    expect(covered).toBeGreaterThan(0.97);
    // Original polygons next to re-traced ones overlap by a fraction of a
    // pixel along their shared edge; rows are drawn on top.
    expect(covered).toBeLessThan(1.05);
  });

  it('rowCount 3 spans three widths around the line', () => {
    const p = { ...DEFAULTS, rowScale: eight, rowLength: 2, rowCount: 3 };
    const rows = rowsOver(p, [line]).filter((s) => s.row);
    const ys = rows.flatMap((s) => s.poly.map((q) => q[1]));
    expect(Math.min(...ys)).toBeGreaterThan(100 - 14);
    expect(Math.max(...ys)).toBeLessThan(100 + 14);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
  });
});

describe('row pieces follow the piece size', () => {
  it('pieces are narrow where s(x) is small and wide where it is large', () => {
    const w = 400, h = 200;
    const img = flatImage(w, h);
    const p = { ...DEFAULTS, rowScale: 0.5, rowLength: 2, rowCount: 1 };
    const an = analyze(img, p);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) an.size[y * w + x] = x < w / 2 ? 10 : 40;
    const base = tessellate(img, toLab(img), an, p, mulberry32(2)).shards;
    const rows = overlayRows(base, [[[10, 100], [390, 100]]], w, h, p, an).filter((s) => s.row);
    const height = (s) => { const [, y0, , y1] = bbox(s.poly); return y1 - y0; };
    const mean = (list) => list.reduce((a, s) => a + height(s), 0) / list.length;
    const left = rows.filter((s) => centroid(s.poly)[0] < 120), right = rows.filter((s) => centroid(s.poly)[0] > 280);
    expect(mean(left)).toBeLessThan(8);
    expect(mean(right)).toBeGreaterThan(15);
  });
});

describe('rows leave the rest alone', () => {
  it('background pieces away from the rows are kept as they were', () => {
    const img = syntheticImage(400, 300);
    const p = { ...DEFAULTS, sMin: 4, sMax: 20 };
    const an = analyze(img, p);
    const base = tessellate(img, toLab(img), an, p, mulberry32(2)).shards;
    const line = [[20, 20], [380, 20]];
    const out = overlayRows(base, [line], img.w, img.h, p, an);
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

import { combineGuides } from '../src/core/andamento.js';

describe('combining guides', () => {
  const w = 300, h = 200;
  const size = new Float32Array(w * h).fill(20);
  const p = { ...DEFAULTS, rowScale: 0.5, rowCount: 2 };
  const len = (gs) => gs.reduce((s, g) => s + pathLength(g), 0);
  const nearest = (pt, g) => Math.min(...g.map((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1])));

  it('keeps one of two nearly overlapping automatic guides', () => {
    const a = [[20, 100], [280, 100]], b = [[20, 104], [280, 104]];
    const out = combineGuides([], [a, b], w, h, p, size);
    expect(len(out)).toBeLessThan(260 * 1.3);
  });

  it('a drawn line cuts the automatic guide it crosses instead of overlapping it', () => {
    const auto = [[20, 100], [280, 100]], drawn = [[150, 20], [150, 180]];
    const out = combineGuides([drawn], [auto], w, h, p, size);
    // Nothing of the automatic guide is left right under the drawn line.
    const autoParts = out.slice(1);
    for (const g of autoParts) for (const [x] of g) expect(Math.abs(x - 150)).toBeGreaterThan(8);
    expect(len(autoParts)).toBeGreaterThan(200);
  });

  it('snaps a drawn end close to an automatic guide onto it', () => {
    const auto = [[20, 100], [280, 100]], drawn = [[150, 20], [150, 88]];
    const out = combineGuides([drawn], [auto], w, h, p, size);
    const end = out[0][out[0].length - 1];
    expect(Math.abs(end[1] - 100)).toBeLessThan(1.5);
    expect(nearest(end, auto.length ? out[1] ?? auto : auto)).toBeLessThan(25);
  });
});

import { bridgeGaps, drawnGuides, edgeMap } from '../src/core/andamento.js';
import { triangulate } from '../src/gl/triangulate.js';
import { shardColors } from '../src/core/color.js';

describe('drawing help', () => {
  const img = discImage(400, 300, 100);
  const edges = edgeMap(img, DEFAULTS);
  // A freehand circle 5 px outside the disc's outline, in normalised coordinates.
  const circle = Array.from({ length: 90 }, (_, i) => {
    const t = (i / 89) * 2 * Math.PI;
    return [(200 + 105 * Math.cos(t)) / 400, (150 + 105 * Math.sin(t)) / 300];
  });
  const radiusError = (g) => g.reduce((s, [x, y]) => s + Math.abs(Math.hypot(x - 200, y - 150) - 100), 0) / g.length;

  it('snaps a stroke drawn near a contour onto it', () => {
    const [free] = drawnGuides([{ points: circle, mode: 'free', snap: false }], 400, 300, edges, DEFAULTS);
    const [snapped] = drawnGuides([{ points: circle, mode: 'free', snap: true }], 400, 300, edges, DEFAULTS);
    expect(radiusError(free)).toBeGreaterThan(3.5);
    expect(radiusError(snapped)).toBeLessThan(1.5);
  });

  it('point-by-point lines stay straight', () => {
    const [g] = drawnGuides([{ points: [[0.1, 0.5], [0.5, 0.2], [0.9, 0.5]], mode: 'points', snap: false }], 400, 300, edges, DEFAULTS);
    // Every point lies on one of the two segments.
    const onSeg = ([x, y]) => (x <= 200 ? Math.abs(y - (150 - (x - 40) * 0.5625)) : Math.abs(y - (60 + (x - 200) * 0.5625)));
    for (const q of g) expect(onSeg(q)).toBeLessThan(0.5);
  });

  it('smooths the shake out of a freehand stroke', () => {
    const shaky = Array.from({ length: 120 }, (_, i) => [(40 + i * 2.6) / 400, (60 + (i % 2 ? 3 : -3)) / 300]);
    const [g] = drawnGuides([{ points: shaky, mode: 'free', snap: false }], 400, 300, edges, DEFAULTS);
    const sd = Math.sqrt(g.reduce((s, [, y]) => s + (y - 60) ** 2, 0) / g.length);
    expect(sd).toBeLessThan(1);
  });
});

describe('automatic guides', () => {
  const line = (x0, x1, y) => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y]);

  it('joins two pieces of one contour separated by a small gap', () => {
    const out = bridgeGaps([line(10, 150, 100), line(157, 300, 100)], 8);
    expect(out.length).toBe(1);
    expect(pathLength(out[0])).toBeGreaterThan(285);
  });

  it('joins them whichever way each piece was traced', () => {
    const out = bridgeGaps([line(10, 150, 100), line(157, 300, 100).reverse()], 8);
    expect(out.length).toBe(1);
  });

  it('does not join a piece that turns away', () => {
    const down = Array.from({ length: 100 }, (_, i) => [156, 104 + i]);
    expect(bridgeGaps([line(10, 150, 100), down], 8).length).toBe(2);
  });
});

describe('row pieces stay orderly', () => {
  it('row pieces get no hand-placement jitter', () => {
    const poly = [[0, 0], [10, 0], [10, 5], [0, 5]];
    const { place } = triangulate([{ poly, row: true }, { poly: poly.map(([x, y]) => [x + 20, y]) }], 3);
    // First shard (row) vertices have zero randoms; the other does not.
    const rowPlace = place.slice(0, 18), other = place.slice(18);
    expect(rowPlace.every((v) => v === 0)).toBe(true);
    expect(other.some((v) => v !== 0)).toBe(true);
  });

  it('row colour strength sets how much darker the rows are', () => {
    const img = flatImage(40, 40);
    const shards = [{ poly: [[0, 0], [40, 0], [40, 20], [0, 20]], row: true }, { poly: [[0, 20], [40, 20], [40, 40], [0, 40]] }];
    const lum = (c) => c[0] + c[1] + c[2];
    const at = (strength) => shardColors(shards, img, { ...DEFAULTS, rowColor: 'dark', rowContrast: strength });
    const weak = at(0.3), strong = at(1);
    expect(lum(strong.slice(0, 3))).toBeLessThan(lum(weak.slice(0, 3)));
    expect(lum(weak.slice(0, 3))).toBeLessThan(lum(weak.slice(3, 6)));
  });
});
