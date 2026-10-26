import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis.js';
import { focusShards, focusSize, overlayFocus, partMap } from '../src/core/focus.js';
import { toLab } from '../src/core/image.js';
import { applyMacroDefaults } from '../src/core/macros.js';
import { ALGORITHMS, DEFAULTS, toWorkPx } from '../src/core/params.js';
import { bbox, centroid, rasterize } from '../src/core/polygon.js';
import { mulberry32 } from '../src/core/rng.js';
import { regionWidths } from '../src/core/slivers.js';
import { tessellate } from '../src/core/tessellate.js';
import { flatImage } from './helpers.js';

const W = 240, H = 160;
const BOX = [0.25, 0.25, 0.75, 0.75];
// The zone in working pixels: x 60..180, y 40..120 (120 x 80).
const X0 = BOX[0] * W, Y0 = BOX[1] * H;
// Parts in zone pixels (the crop has the zone's resolution): a large
// rectangle, a 4 px bar along its lower side and an isolated 3 x 3 square.
const RECT = [2, 2, 114, 56], BAR = [2, 56, 114, 60], SQUARE = [50, 70, 53, 73];
const RECT_PART = 0, BAR_PART = 1, SQUARE_PART = 2;

function syntheticParts() {
  const w = 120, h = 80, labels = new Int32Array(w * h).fill(-1);
  const fill = ([x0, y0, x1, y1], l) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) labels[y * w + x] = l;
  };
  fill(RECT, RECT_PART);
  fill(BAR, BAR_PART);
  fill(SQUARE, SQUARE_PART);
  return { box: BOX, w, h, labels, count: 3 };
}

// The part of every working pixel (-1 outside), straight from the rectangles.
function truth() {
  const t = new Int32Array(W * H).fill(-1);
  [[RECT, RECT_PART], [BAR, BAR_PART], [SQUARE, SQUARE_PART]].forEach(([[x0, y0, x1, y1], l]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) t[(y + Y0) * W + x + X0] = l;
  });
  return t;
}

// Pixel count of each part inside a piece.
function partCounts(poly, parts) {
  const c = new Map();
  rasterize(poly, W, H, (x, y) => {
    const l = parts[y * W + x];
    c.set(l, (c.get(l) ?? 0) + 1);
  });
  return c;
}

// Width across the narrowest direction of a polygon (rotated bounding box).
function shortAxis(poly) {
  let best = Infinity;
  for (let k = 0; k < 90; k++) {
    const t = (k / 90) * Math.PI, nx = Math.cos(t), ny = Math.sin(t);
    let lo = Infinity, hi = -Infinity;
    for (const [x, y] of poly) {
      const d = x * nx + y * ny;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    best = Math.min(best, hi - lo);
  }
  return best;
}

const img = flatImage(W, H);
const lab = toLab(img);
const base = toWorkPx(applyMacroDefaults(DEFAULTS));
const an = analyze(img, base);
const parts = truth();

describe('pieces with intention inside a touched shape', () => {
  const run = (algorithm) => {
    const p = { ...base, algorithm };
    return { p, shards: focusShards(img, lab, an, p, mulberry32(3), [syntheticParts()]) };
  };

  it.each(ALGORITHMS.map((a) => a.value))('no piece crosses a part border (%s)', (algorithm) => {
    const { shards } = run(algorithm);
    expect(shards.length).toBeGreaterThan(0);
    let minority = 0, total = 0;
    for (const { poly, intent } of shards) {
      expect(intent).toBe(true);
      const counts = [...partCounts(poly, parts).values()];
      const n = counts.reduce((s, v) => s + v, 0);
      minority += n - Math.max(...counts);
      total += n;
    }
    expect(minority).toBeLessThanOrEqual(0.03 * total);
  });

  it.each(ALGORITHMS.map((a) => a.value))('the thin bar gets pieces no wider than itself (%s)', (algorithm) => {
    const { shards } = run(algorithm);
    const inBar = shards.filter(({ poly }) => {
      const c = partCounts(poly, parts);
      const n = [...c.values()].reduce((s, v) => s + v, 0);
      return (c.get(BAR_PART) ?? 0) > n / 2;
    });
    expect(inBar.length).toBeGreaterThan(0);
    for (const { poly } of inBar) expect(shortAxis(poly)).toBeLessThanOrEqual(6);
  });

  it.each(ALGORITHMS.map((a) => a.value))('a part smaller than a minimum piece is one piece (%s)', (algorithm) => {
    const { shards } = run(algorithm);
    const covering = shards.filter(({ poly }) => (partCounts(poly, parts).get(SQUARE_PART) ?? 0) >= 0.8 * 9);
    expect(covering).toHaveLength(1);
  });

  it.each(ALGORITHMS.map((a) => a.value))('a large part is split into several pieces (%s)', (algorithm) => {
    const { p, shards } = run(algorithm);
    expect(Math.max(RECT[2] - RECT[0], RECT[3] - RECT[1])).toBeGreaterThanOrEqual(3 * p.sMax);
    const inRect = shards.filter(({ poly }) => {
      const c = partCounts(poly, parts);
      const n = [...c.values()].reduce((s, v) => s + v, 0);
      return (c.get(RECT_PART) ?? 0) > n / 2;
    });
    expect(inRect.length).toBeGreaterThan(1);
  });

  it.each(ALGORITHMS.map((a) => a.value))('overlayFocus leaves pieces outside the zone untouched (%s)', (algorithm) => {
    const p = { ...base, algorithm };
    const background = tessellate(img, lab, an, p, mulberry32(1)).shards;
    const out = overlayFocus(background, img, lab, an, p, mulberry32(3), [syntheticParts()]);
    expect(out.some((s) => s.intent)).toBe(true);
    const key = (poly) => JSON.stringify(poly);
    const result = new Set(out.map((s) => key(s.poly)));
    const [bx0, by0, bx1, by1] = [BOX[0] * W, BOX[1] * H, BOX[2] * W, BOX[3] * H];
    const outside = background.filter(({ poly }) => {
      const [x0, y0, x1, y1] = bbox(poly);
      return x1 < bx0 || x0 > bx1 || y1 < by0 || y0 > by1;
    });
    expect(outside.length).toBeGreaterThan(0);
    for (const { poly } of outside) expect(result.has(key(poly))).toBe(true);
    expect(overlayFocus(background, img, lab, an, p, mulberry32(3), [])).toBe(background);
  });

  it.each(ALGORITHMS.map((a) => a.value))('overlayFocus leaves no sliver of the background next to the zone (%s)', (algorithm) => {
    const p = { ...base, algorithm };
    const background = tessellate(img, lab, an, p, mulberry32(1)).shards;
    const out = overlayFocus(background, img, lab, an, p, mulberry32(3), [syntheticParts()]);
    const before = new Set(background.map((s) => JSON.stringify(s.poly)));
    // Background pieces the overlay re-traced, each with its own label.
    const redone = out.filter((s) => !s.intent && !before.has(JSON.stringify(s.poly)));
    expect(redone.length).toBeGreaterThan(0);
    const labels = new Int32Array(W * H).fill(-1);
    redone.forEach(({ poly }, id) => rasterize(poly, W, H, (x, y) => { labels[y * W + x] = id; }));
    for (const width of regionWidths(labels, W, H).values()) expect(width).toBeGreaterThanOrEqual(0.25 * p.sMax);
  });

  it.each(ALGORITHMS.map((a) => a.value))('rows trimmed by a "more" zone stay rows (%s)', (algorithm) => {
    const p = { ...base, algorithm };
    // A drawn guide across the middle of the image, through the zone.
    const guides = [[[0.05, 0.5], [0.95, 0.5]]];
    const zones = [{ mode: 'more', parts: syntheticParts() }];
    const rowsOnly = tessellate(img, lab, an, p, mulberry32(1), guides).shards;
    const out = tessellate(img, lab, an, p, mulberry32(1), guides, null, zones).shards;
    expect(out.some((s) => s.intent)).toBe(true);
    // The pixels the rows cover without the zone.
    const rowMask = new Uint8Array(W * H);
    rowsOnly.filter((s) => s.row).forEach(({ poly }) => rasterize(poly, W, H, (x, y) => { rowMask[y * W + x] = 1; }));
    const [bx0, by0, bx1, by1] = [BOX[0] * W, BOX[1] * H, BOX[2] * W, BOX[3] * H];
    // Pieces centred outside the zone box and lying mostly on those rows.
    const onRows = out.filter(({ poly, intent }) => {
      if (intent) return false;
      const [cx, cy] = centroid(poly);
      if (cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1) return false;
      let n = 0, on = 0;
      rasterize(poly, W, H, (x, y) => { n++; on += rowMask[y * W + x]; });
      return on > n / 2;
    });
    expect(onRows.length).toBeGreaterThan(0);
    for (const s of onRows) expect(s.row).toBe(true);
  });

  it('focusSize: half the part width, at most the analysis size, at least sMin / 2', () => {
    const { labels, count } = partMap(syntheticParts(), W, H, base.simplify);
    const widths = regionWidths(labels, W, H);
    const size = focusSize(an, labels, count, base);
    let lowest = Infinity, inside = 0;
    for (let i = 0; i < size.length; i++) {
      if (labels[i] < 0) {
        expect(size[i]).toBe(an.size[i]);
        continue;
      }
      inside++;
      if (size[i] < lowest) lowest = size[i];
      expect(size[i]).toBeCloseTo(Math.max(base.sMin / 2, Math.min(an.size[i], widths.get(labels[i]) / 2)), 5);
    }
    expect(inside).toBeGreaterThan(0);
    expect(lowest).toBeGreaterThanOrEqual(base.sMin / 2 - 1e-6);
    // The wide rectangle: pieces about half its thickness, smaller than the
    // flat photo's analysis size.
    const rectPixel = (Y0 + 30) * W + X0 + 50;
    expect(labels[rectPixel]).toBe(RECT_PART);
    expect(size[rectPixel]).toBeCloseTo(widths.get(RECT_PART) / 2, 5);
    expect(size[rectPixel]).toBeLessThan(an.size[rectPixel]);
    // The bar is 4 px thick: half of that is below sMin / 2, so it gets
    // sMin / 2, below the usual minimum piece.
    const barPixel = (Y0 + 58) * W + X0 + 50;
    expect(labels[barPixel]).toBe(BAR_PART);
    expect(size[barPixel]).toBeCloseTo(base.sMin / 2, 5);
    expect(size[barPixel]).toBeLessThan(base.sMin);
  });

  it('focusSize never goes above the analysis size', () => {
    const { labels, count } = partMap(syntheticParts(), W, H, base.simplify);
    const small = { ...an, size: new Float32Array(an.size.length).fill(base.sMin) };
    const size = focusSize(small, labels, count, base);
    const rectPixel = (Y0 + 30) * W + X0 + 50;
    expect(size[rectPixel]).toBeCloseTo(base.sMin, 5);
  });
});
