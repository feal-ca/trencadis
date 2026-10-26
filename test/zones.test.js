import { describe, expect, it } from 'vitest';
import { analyze } from '../src/core/analysis.js';
import { DEFAULTS } from '../src/core/params.js';
import { zonesDetailMask } from '../src/core/zones.js';
import { textureAndEdge } from './helpers.js';

const zone = (mode, box) => ({ id: 1, mode, region: { box, w: 8, h: 8, data: new Uint8Array(64).fill(1) }, parts: null });

describe('zonesDetailMask', () => {
  it('less zones become -1 in the detail mask', () => {
    const m = zonesDetailMask([zone('less', [0, 0, 0.5, 1])], 32, 16);
    expect(m.w).toBe(32);
    expect(m.h).toBe(16);
    expect(m.data[8 * 32 + 3]).toBe(-1);
    expect(m.data[8 * 32 + 12]).toBe(-1);
    expect(m.data[8 * 32 + 16]).toBe(0);
    expect(m.data[8 * 32 + 30]).toBe(0);
  });

  it('more zones become +1 in the detail mask', () => {
    const m = zonesDetailMask([zone('more', [0.5, 0, 1, 1])], 32, 16);
    expect(m).not.toBeNull();
    expect(m.data[8 * 32 + 3]).toBe(0);
    expect(m.data[8 * 32 + 15]).toBe(0);
    expect(m.data[8 * 32 + 16]).toBe(1);
    expect(m.data[8 * 32 + 30]).toBe(1);
  });

  it('only the shape inside the box counts', () => {
    const z = zone('more', [0, 0, 1, 1]);
    z.region.data = new Uint8Array(64);
    z.region.data[0] = 1;
    const m = zonesDetailMask([z], 16, 16);
    expect(m.data[0]).toBe(1);
    expect(m.data[15 * 16 + 15]).toBe(0);
  });

  it('where a more and a less zone overlap, more wins', () => {
    for (const zs of [[zone('less', [0, 0, 1, 1]), zone('more', [0, 0, 0.5, 1])], [zone('more', [0, 0, 0.5, 1]), zone('less', [0, 0, 1, 1])]]) {
      const m = zonesDetailMask(zs, 32, 16);
      expect(m.data[8 * 32 + 3]).toBe(1);
      expect(m.data[8 * 32 + 20]).toBe(-1);
    }
  });

  it('no zone, or none with a mode and a shape, gives null', () => {
    expect(zonesDetailMask(null)).toBeNull();
    expect(zonesDetailMask([])).toBeNull();
    expect(zonesDetailMask([{ ...zone(null, [0, 0, 1, 1]) }])).toBeNull();
    expect(zonesDetailMask([{ ...zone('more', [0, 0, 1, 1]), region: null }])).toBeNull();
  });

  it('a more zone makes the pieces smaller inside it after analysis', () => {
    const img = textureAndEdge();
    // The flat band between the texture and the edge: little detail, large pieces.
    const z = zone('more', [0.52, 0.2, 0.7, 0.8]);
    const p = { ...DEFAULTS, exactAnalysis: true };
    const plain = analyze(img, p, zonesDetailMask([]));
    const more = analyze(img, p, zonesDetailMask([z]));
    const i = 80 * img.w + Math.round(0.61 * img.w);
    expect(more.size[i]).toBeLessThan(0.7 * plain.size[i]);
    // Far from the zone nothing changes.
    const j = 80 * img.w + 10;
    expect(more.size[j]).toBeCloseTo(plain.size[j], 3);
  });
});
