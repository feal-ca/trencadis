import { describe, expect, it } from 'vitest';
import { createPipeline } from '../src/core/pipeline.js';
import { ALGORITHMS, DEFAULTS, toWorkPx } from '../src/core/params.js';
import { area } from '../src/core/polygon.js';
import { syntheticImage } from './helpers.js';

describe('pipeline', () => {
  for (const { value } of ALGORITHMS) {
    it(`runs ${value} end to end`, async () => {
      const pipe = createPipeline();
      const img = syntheticImage();
      pipe.setImage(img);
      const stages = {};
      const p = { ...DEFAULTS, algorithm: value, outLong: 300, supersample: 1 };
      const res = await pipe.run(p, (name, v) => { stages[name] = v; });
      const { shards } = stages.tessellation;
      expect(shards.length).toBeGreaterThan(10);
      const covered = shards.reduce((s, sh) => s + area(sh.poly), 0);
      // Raster-traced methods lose a little area to simplification gaps.
      expect(covered / (img.w * img.h)).toBeGreaterThan(0.85);
      expect(covered / (img.w * img.h)).toBeLessThan(1.05);
      expect(stages.color.colors.length).toBe(shards.length * 3);
      expect(stages.render.width).toBe(300);
      expect(res.shards).toBe(shards.length);
    });
  }

  it('reuses cached stages when only render params change', async () => {
    const pipe = createPipeline();
    pipe.setImage(syntheticImage());
    const p = { ...DEFAULTS, outLong: 300, supersample: 1 };
    await pipe.run(p, () => {});
    const fresh = [];
    await pipe.run({ ...p, grout: 3 }, (name, _v, recomputed) => recomputed && fresh.push(name));
    expect(fresh).toEqual(['render']);
  });
});

describe('cpu render switch', () => {
  it('cpuRender false skips render stage', async () => {
    const pipe = createPipeline();
    pipe.setImage(syntheticImage());
    const seen = [];
    const res = await pipe.run({ ...DEFAULTS, outLong: 200 }, (n) => seen.push(n), undefined, undefined, undefined, { cpuRender: false });
    expect(seen).toEqual(['analysis', 'tessellation', 'color']);
    expect(res.shards).toBeGreaterThan(0);
  });
});

describe('working resolution', () => {
  // The engine always hands the pipeline the photo at workLong on its long
  // side; the same photo at 400 and 800 px should give the same mosaic, finer.
  for (const algorithm of ['fracture', 'voronoi', 'cracks']) {
    it(`changes quality, not the number of pieces (${algorithm})`, async () => {
      const count = async (long) => {
        const pipe = createPipeline();
        pipe.setImage(syntheticImage(long, Math.round(long * 2 / 3)));
        const res = await pipe.run({ ...DEFAULTS, algorithm, workLong: long }, () => {}, undefined, undefined, undefined, { cpuRender: false });
        return res.shards;
      };
      const [a, b] = [await count(400), await count(800)];
      expect(Math.abs(a - b) / b).toBeLessThan(0.2);
    });
  }
});

describe('zones', () => {
  const BOX = [0.25, 0.25, 0.75, 0.75];
  const region = (box) => ({ box, w: 16, h: 16, data: new Uint8Array(256).fill(1) });
  // One part filling the whole zone, at the crop resolution of a 240 x 160 photo.
  const parts = () => ({ box: BOX, w: 120, h: 80, labels: new Int32Array(120 * 80), count: 1 });
  const lessZone = { id: 1, mode: 'less', region: region(BOX), parts: null };
  const moreZone = { id: 2, mode: 'more', region: region(BOX), parts: parts() };
  const tess = async (zones, p = {}) => {
    const pipe = createPipeline();
    pipe.setImage(syntheticImage());
    pipe.setZones(zones);
    let value;
    await pipe.run({ ...DEFAULTS, outLong: 300, supersample: 1, ...p }, (n, v) => { if (n === 'tessellation') value = v; }, undefined, undefined, undefined, { cpuRender: false });
    return value.shards;
  };
  const inside = (s, w = 240, h = 160) => {
    const cx = s.poly.reduce((a, q) => a + q[0], 0) / s.poly.length / w;
    const cy = s.poly.reduce((a, q) => a + q[1], 0) / s.poly.length / h;
    return cx > BOX[0] && cx < BOX[2] && cy > BOX[1] && cy < BOX[3];
  };
  const meanArea = (shards) => shards.reduce((a, s) => a + area(s.poly), 0) / shards.length;

  it('a less zone makes its pieces larger', async () => {
    const without = (await tess(null)).filter((s) => inside(s));
    const withZone = (await tess([lessZone])).filter((s) => inside(s));
    expect(meanArea(withZone)).toBeGreaterThan(meanArea(without));
  });

  it('a more zone adds intent pieces', async () => {
    expect((await tess(null)).some((s) => s.intent)).toBe(false);
    expect((await tess([moreZone])).some((s) => s.intent)).toBe(true);
  });

  it('zones survive a change of working resolution and method', async () => {
    // Intent pieces stay on the zone at every resolution. They may reach past
    // its box only by the background slivers the overlay lets them absorb
    // (overlayPieces merges fragments narrower than 0.25 of the size field,
    // which is at most sMax), plus a pixel of tracing.
    const check = (shards, w, h) => {
      const intent = shards.filter((s) => s.intent);
      expect(intent.length).toBeGreaterThan(0);
      const m = 0.25 * toWorkPx({ ...DEFAULTS, workLong: w }).sMax + 1;
      const [x0, y0, x1, y1] = [BOX[0] * w - m, BOX[1] * h - m, BOX[2] * w + m, BOX[3] * h + m];
      for (const s of intent) for (const [x, y] of s.poly) expect(x >= x0 && x <= x1 && y >= y0 && y <= y1).toBe(true);
    };
    const pipe = createPipeline();
    pipe.setZones([moreZone]);
    const run = async (long, algorithm) => {
      pipe.setImage(syntheticImage(long, Math.round(long * 2 / 3)));
      let value;
      await pipe.run({ ...DEFAULTS, algorithm, workLong: long }, (n, v) => { if (n === 'tessellation') value = v; }, undefined, undefined, undefined, { cpuRender: false });
      return value.shards;
    };
    check(await run(800, 'fracture'), 800, 533);
    check(await run(600, 'voronoi'), 600, 400);
  });
});
