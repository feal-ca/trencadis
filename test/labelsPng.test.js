import { describe, expect, it } from 'vitest';
import { decodeLabels, encodeLabels } from '../src/seg/labelsPng.js';

describe('labelsPng', () => {
  it('round-trips a label map', () => {
    const labels = new Int32Array(24).fill(-1);
    labels[0] = 0; labels[1] = 0; labels[7] = 3; labels[8] = 3; labels[23] = 1;
    const rgba = encodeLabels({ w: 6, h: 4, labels });
    expect(rgba).toBeInstanceOf(Uint8ClampedArray);
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([1, 1, 1, 255]);
    expect([rgba[8], rgba[9], rgba[10], rgba[11]]).toEqual([0, 0, 0, 255]);
    const out = decodeLabels(rgba, 6, 4);
    expect(out).toMatchObject({ w: 6, h: 4, count: 4 });
    expect(Array.from(out.labels)).toEqual(Array.from(labels));
  });

  it('rejects a label above 254', () => {
    expect(() => encodeLabels({ w: 1, h: 1, labels: new Int32Array([255]) })).toThrow();
  });
});
