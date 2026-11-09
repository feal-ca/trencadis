import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/core/params.js';
import { createPipeline } from '../src/core/pipeline.js';
import { renderMosaic } from '../src/core/render.js';
import { syntheticImage } from './helpers.js';

describe('renderMosaic', () => {
  it('renders at the long side it is given', async () => {
    const pipe = createPipeline();
    const img = syntheticImage(240, 160);
    pipe.setImage(img);
    const p = { ...DEFAULTS, supersample: 1 };
    await pipe.run(p, () => {}, undefined, undefined, undefined, { cpuRender: false });
    const { shards } = pipe.cached('tessellation');
    const { colors } = pipe.cached('color');
    const out = renderMosaic(shards, colors, img.w, img.h, p, 120);
    expect([out.width, out.height]).toEqual([120, 80]);
    const full = renderMosaic(shards, colors, img.w, img.h, { ...p, outLong: 90 });
    expect(full.width).toBe(90);
  });
});

describe('dome', () => {
  // One grey square filling the image, lit from the left, with no grout,
  // bevel, tilt, grain or highlight: only the dome can shade it.
  const shards = [{ poly: [[0, 0], [60, 0], [60, 60], [0, 60]] }];
  const colors = new Float32Array([0.5, 0.5, 0.5]);
  const p = {
    ...DEFAULTS, supersample: 1, grout: 0, bevel: 0, tilt: 0, glazeNoise: 0, specular: 0, place: 0,
    ambient: 0.3, lightAz: 180, lightEl: 40,
  };
  const at = (img, x, y) => img.data[(y * img.width + x) * 4];

  it('leaves a flat piece evenly lit', () => {
    const img = renderMosaic(shards, colors, 60, 60, { ...p, dome: 0 }, 60);
    expect(at(img, 10, 30)).toBe(at(img, 50, 30));
  });

  it('lights the side of the piece that faces the light', () => {
    const img = renderMosaic(shards, colors, 60, 60, { ...p, dome: 0.3 }, 60);
    expect(at(img, 10, 30)).toBeGreaterThan(at(img, 50, 30) + 10);
    // Across the light, both sides match.
    expect(Math.abs(at(img, 30, 10) - at(img, 30, 50))).toBeLessThanOrEqual(1);
  });
});
