import { describe, expect, it } from 'vitest';
import { createPipeline } from '../src/core/pipeline.js';
import { ALGORITHMS, DEFAULTS } from '../src/core/params.js';
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
