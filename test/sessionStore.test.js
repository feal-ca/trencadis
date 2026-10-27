import { describe, expect, it } from 'vitest';
import { fromSnapshot, openSessionStore, toSnapshot } from '../src/ui/engine/sessionStore.js';

const region = { box: [0.1, 0.1, 0.5, 0.5], w: 2, h: 2, data: new Uint8Array([1, 0, 1, 1]) };
const parts = { box: region.box, w: 2, h: 2, labels: new Int32Array([0, -1, 1, 1]), count: 2 };

describe('toSnapshot', () => {
  it('keeps typed arrays and drops zones without a mode', () => {
    const zones = [
      { id: 'z1', mode: 'more', points: [[0.2, 0.2, 1]] },
      { id: 'z2', mode: null, points: [[0.3, 0.3, 1]] },
      { id: 'z3', mode: 'less', points: [[0.4, 0.4, 1]] },
    ];
    const pixels = { z1: { region, parts }, z2: { region, parts: null } };
    const segments = { w: 2, h: 1, labels: new Uint8Array([3, 4]), count: 5 };
    const snap = toSnapshot({
      sample: null, photo: new Blob(['x']), name: 'barcas', guides: [{ mode: 'line', points: [[0, 0], [1, 1]], gen: 3 }],
      zones, pixelsOf: (z) => pixels[z.id], segments,
    });
    // z2 has no mode and z3 has no pixels.
    expect(snap.zones.map((z) => z.id)).toEqual(['z1']);
    const copy = structuredClone(snap);
    expect(copy.zones[0].region.data).toBeInstanceOf(Uint8Array);
    expect([...copy.zones[0].region.data]).toEqual([1, 0, 1, 1]);
    expect(copy.zones[0].parts.labels).toBeInstanceOf(Int32Array);
    expect(copy.segments.labels).toBeInstanceOf(Uint8Array);
    expect(copy.v).toBe(1);
    expect(fromSnapshot(copy)).not.toBeNull();
  });
});

describe('fromSnapshot', () => {
  const ok = { v: 1, sample: './samples/vermeer.webp', photo: null, name: 'vermeer', guides: [], zones: [], segments: null };
  it('rejects other versions and broken data', () => {
    expect(fromSnapshot(ok)).toEqual(ok);
    expect(fromSnapshot(null)).toBeNull();
    expect(fromSnapshot('x')).toBeNull();
    expect(fromSnapshot({ ...ok, v: 2 })).toBeNull();
    expect(fromSnapshot({ v: 1 })).toBeNull();
    expect(fromSnapshot({ ...ok, sample: null, photo: 'not a blob' })).toBeNull();
    expect(fromSnapshot({ ...ok, sample: null, photo: new Blob(['x']) })).not.toBeNull();
    expect(fromSnapshot({ ...ok, guides: {} })).toBeNull();
    expect(fromSnapshot({ ...ok, zones: [{ id: 'z1', mode: 'more', points: [], region: { ...region, data: [1, 0, 1, 1] } }] })).toBeNull();
    expect(fromSnapshot({ ...ok, zones: [{ id: 'z1', mode: 'more', points: [] }] })).toBeNull();
    expect(fromSnapshot({ ...ok, segments: { w: 1, h: 1, labels: [1], count: 1 } })).toBeNull();
  });
  it('rejects guides without a mode or with broken points', () => {
    const guide = { mode: 'line', points: [[0.1, 0.2], [0.5, 0.6]], gen: 1 };
    expect(fromSnapshot({ ...ok, guides: [guide] })).not.toBeNull();
    expect(fromSnapshot({ ...ok, guides: [{ ...guide, mode: undefined }] })).toBeNull();
    expect(fromSnapshot({ ...ok, guides: [{ ...guide, points: 'x' }] })).toBeNull();
    expect(fromSnapshot({ ...ok, guides: [{ ...guide, points: [[0, 0], [1]] }] })).toBeNull();
    expect(fromSnapshot({ ...ok, guides: [{ ...guide, points: [[0, NaN]] }] })).toBeNull();
    expect(fromSnapshot({ ...ok, guides: [{ ...guide, points: [['0', 1]] }] })).toBeNull();
    expect(fromSnapshot({ ...ok, guides: [null] })).toBeNull();
    // An erase has no mode or points of its own.
    expect(fromSnapshot({ ...ok, guides: [guide, { erase: [[0.3, 0.4]], radius: 0.02, gen: 1 }] })).not.toBeNull();
    expect(fromSnapshot({ ...ok, guides: [{ erase: [[0.3]], radius: 0.02 }] })).toBeNull();
    expect(fromSnapshot({ ...ok, guides: [{ erase: [[0.3, 0.4]] }] })).toBeNull();
  });
  it('rejects shapes whose sizes do not match their data', () => {
    const zone = (r, parts = null) => ({ id: 'z1', mode: 'more', points: [[0.2, 0.2, 1]], region: r, parts });
    expect(fromSnapshot({ ...ok, zones: [zone(region, parts)] })).not.toBeNull();
    expect(fromSnapshot({ ...ok, zones: [zone({ ...region, w: 3 })] })).toBeNull();
    expect(fromSnapshot({ ...ok, zones: [zone({ ...region, w: 0, h: 0, data: new Uint8Array(0) })] })).toBeNull();
    expect(fromSnapshot({ ...ok, zones: [zone({ ...region, box: [0, 0, 1] })] })).toBeNull();
    expect(fromSnapshot({ ...ok, zones: [zone({ ...region, box: [0, 0, 'a', 1] })] })).toBeNull();
    expect(fromSnapshot({ ...ok, zones: [zone(region, { ...parts, labels: new Int32Array(3) })] })).toBeNull();
    expect(fromSnapshot({ ...ok, zones: [zone(region, { ...parts, count: 'x' })] })).toBeNull();
    const seg = { w: 2, h: 1, labels: new Uint8Array([1, 2]), count: 2 };
    expect(fromSnapshot({ ...ok, segments: seg })).not.toBeNull();
    expect(fromSnapshot({ ...ok, segments: { ...seg, labels: new Uint8Array(5) } })).toBeNull();
    expect(fromSnapshot({ ...ok, segments: { ...seg, count: 0 } })).toBeNull();
    expect(fromSnapshot({ ...ok, segments: { ...seg, count: 1.5 } })).toBeNull();
  });
});

describe('openSessionStore', () => {
  it('gives null on load and ignores save when the database fails', async () => {
    const broken = { open: () => { throw new Error('private mode'); } };
    const store = openSessionStore(broken);
    expect(await store.load()).toBeNull();
    await expect(store.save({ v: 1 })).resolves.toBeUndefined();
    const none = openSessionStore(undefined);
    expect(await none.load()).toBeNull();
  });
});
