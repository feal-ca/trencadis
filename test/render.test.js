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
