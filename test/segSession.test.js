import { describe, expect, it } from 'vitest';
import { createSegSession, segOverrides, startPolicy } from '../src/ui/segSession.js';

// A session with a fake worker: `sent` keeps every message posted to it.
function setup(policy = 'auto') {
  const sent = [];
  const states = [];
  const s = createSegSession({ post: (m) => sent.push(m), onState: (st) => states.push(st), policy });
  return { s, sent, states, last: (type) => sent.filter((m) => m.type === type).at(-1) };
}
const region = { box: [0.4, 0.4, 0.5, 0.5], w: 2, h: 2, data: new Uint8Array([1, 1, 0, 1]) };

describe('startPolicy', () => {
  it('desktop with WebGPU starts by itself', () => {
    expect(startPolicy({ touch: false, webgpu: true, stored: null })).toBe('auto');
  });
  it('a touch device asks', () => {
    expect(startPolicy({ touch: true, webgpu: true, stored: null })).toBe('ask');
  });
  it('without WebGPU it asks', () => {
    expect(startPolicy({ touch: false, webgpu: false, stored: null })).toBe('ask');
  });
  it('a phone without WebGPU asks', () => {
    expect(startPolicy({ touch: true, webgpu: false, stored: undefined })).toBe('ask');
  });
  it('a stored yes starts by itself even on a phone without WebGPU', () => {
    expect(startPolicy({ touch: true, webgpu: false, stored: 'yes' })).toBe('auto');
  });
  it('a stored no stays off even on desktop with WebGPU', () => {
    expect(startPolicy({ touch: false, webgpu: true, stored: 'no' })).toBe('off');
  });
});

describe('segmentation session', () => {
  it('starts the coarse pass on a photo when the policy is auto', () => {
    const { s, sent } = setup('auto');
    s.photo('a');
    expect(sent).toEqual([{ type: 'coarse', id: expect.any(Number), image: 'a' }]);
    expect(s.state.phase).toBe('download');
  });

  it('asks first, and starts after accept', () => {
    const { s, sent } = setup('ask');
    s.photo('a');
    expect(sent).toEqual([]);
    expect(s.state.phase).toBe('ask');
    s.accept();
    expect(sent.map((m) => m.type)).toEqual(['coarse']);
  });

  it('drops results from a previous photo', () => {
    const { s, last } = setup();
    s.photo('a');
    const a = last('coarse').id;
    s.photo('b');
    expect(s.receive({ type: 'segments', id: a, count: 5, ms: 10 })).toBe(false);
    expect(s.state.phase).not.toBe('done');
    s.receive({ type: 'segments', id: last('coarse').id, count: 5, ms: 10 });
    expect(s.state).toMatchObject({ phase: 'done', found: 5, ms: 10 });
  });

  it('reports progress', () => {
    const { s, last, states } = setup();
    s.photo('a');
    const id = last('coarse').id;
    s.receive({ type: 'progress', id, phase: 'decode', done: 32, total: 64, found: 7 });
    expect(s.state).toMatchObject({ phase: 'decode', done: 32, total: 64, found: 7 });
    expect(states.at(-1)).toBe(s.state);
  });

  it('a pick while declined asks again and resolves after accept', async () => {
    const { s, sent, last } = setup('ask');
    s.photo('a');
    s.decline();
    expect(s.state.phase).toBe('off');
    const shape = s.pick([[0.42, 0.42, 1]]);
    expect(s.state.phase).toBe('ask');
    expect(sent).toEqual([]);
    s.accept();
    const pick = last('pick');
    expect(sent.map((m) => m.type)).toEqual(['coarse', 'pick']);
    expect(pick.points).toEqual([[0.42, 0.42, 1]]);
    s.receive({ type: 'shape', id: pick.id, region });
    await expect(shape).resolves.toBe(region);
  });

  it('a pick that is declined is rejected', async () => {
    const { s } = setup('ask');
    s.photo('a');
    const shape = s.pick([[0.5, 0.5, 1]]);
    s.decline();
    await expect(shape).rejects.toThrow();
    expect(s.state.phase).toBe('off');
  });

  it('a pick during encode waits and resolves when the shape arrives', async () => {
    const { s, last } = setup();
    s.photo('a');
    s.receive({ type: 'progress', id: last('coarse').id, phase: 'encode', done: 0, total: 1 });
    let got = null;
    const shape = s.pick([[0.42, 0.42, 1]]).then((r) => { got = r; return r; });
    const pick = last('pick');
    expect(pick).toMatchObject({ type: 'pick', points: [[0.42, 0.42, 1]] });
    await Promise.resolve();
    expect(got).toBeNull();
    // The coarse pass may finish first; the pick still waits for its shape.
    s.receive({ type: 'segments', id: last('coarse').id, count: 3, ms: 5 });
    s.receive({ type: 'shape', id: pick.id, region });
    await expect(shape).resolves.toBe(region);
  });

  it('parts of a region come back from the worker', async () => {
    const { s, last } = setup();
    s.photo('a');
    const parts = s.parts(region);
    const msg = last('parts');
    expect(msg.region).toBe(region);
    const res = { box: region.box, w: 1, h: 1, labels: new Int32Array([0]), count: 1 };
    s.receive({ type: 'parts', id: msg.id, parts: res });
    await expect(parts).resolves.toBe(res);
  });

  it('a new photo rejects picks of the previous one', async () => {
    const { s } = setup();
    s.photo('a');
    const shape = s.pick([[0.5, 0.5, 1]]);
    s.photo('b');
    await expect(shape).rejects.toThrow();
  });

  it('a worker error ends in phase error and retry starts again', () => {
    const { s, sent, last } = setup();
    s.photo('a');
    const first = last('coarse').id;
    s.receive({ type: 'error', id: first, message: 'no network' });
    expect(s.state).toMatchObject({ phase: 'error' });
    s.retry();
    const coarse = sent.filter((m) => m.type === 'coarse');
    expect(coarse).toHaveLength(2);
    expect(coarse[1].id).toBeGreaterThan(first);
    expect(coarse[1].image).toBe('a');
    expect(s.state.phase).not.toBe('error');
  });

  it('an error in a pick rejects only that pick', async () => {
    const { s, last } = setup();
    s.photo('a');
    const shape = s.pick([[0.5, 0.5, 1]]);
    s.receive({ type: 'error', id: last('pick').id, message: 'boom' });
    await expect(shape).rejects.toThrow('boom');
    expect(s.state.phase).toBe('download');
  });
});

describe('segmentation session across photos and crashes', () => {
  it('a reset drops results and picks of the previous photo before the next one arrives', async () => {
    const { s, sent, last } = setup();
    s.photo('a');
    const a = last('coarse').id;
    const old = s.pick([[0.5, 0.5, 1]]);
    const oldPick = last('pick').id;
    s.reset();
    await expect(old).rejects.toThrow();
    expect(s.receive({ type: 'segments', id: a, count: 5, ms: 10 })).toBe(false);
    expect(s.receive({ type: 'shape', id: oldPick, region })).toBe(false);
    expect(s.state.phase).toBe('idle');
    // A pick before the new photo is ready waits for it.
    const shape = s.pick([[0.3, 0.3, 1]]);
    const before = sent.length;
    expect(s.retry()).toBeUndefined();
    expect(sent.length).toBe(before);
    s.photo('b');
    expect(sent.slice(before).map((m) => m.type)).toEqual(['coarse', 'pick']);
    expect(last('coarse').image).toBe('b');
    s.receive({ type: 'shape', id: last('pick').id, region });
    await expect(shape).resolves.toBe(region);
  });

  it('a worker that dies ends in phase error, rejects pending picks, and retry starts again', async () => {
    const { s, sent } = setup();
    s.photo('a');
    const shape = s.pick([[0.5, 0.5, 1]]);
    s.fail('the worker did not load');
    expect(s.state).toMatchObject({ phase: 'error', message: 'the worker did not load' });
    await expect(shape).rejects.toThrow();
    s.retry();
    expect(sent.filter((m) => m.type === 'coarse')).toHaveLength(2);
    expect(s.state.phase).toBe('download');
  });

  it('a pick where there is no shape resolves to null', async () => {
    const { s, last } = setup();
    s.photo('a');
    const shape = s.pick([[0.5, 0.5, 1]]);
    s.receive({ type: 'shape', id: last('pick').id, region: null });
    await expect(shape).resolves.toBeNull();
  });

  it('a pick after a failure starts the coarse pass again before the pick', async () => {
    const { s, sent, last } = setup();
    s.photo('a');
    s.fail('the worker did not load');
    const before = sent.length;
    const shape = s.pick([[0.5, 0.5, 1]]);
    expect(sent.slice(before).map((m) => m.type)).toEqual(['coarse', 'pick']);
    expect(last('coarse').image).toBe('a');
    expect(s.state.phase).toBe('download');
    s.receive({ type: 'shape', id: last('pick').id, region });
    await expect(shape).resolves.toBe(region);
  });
});

describe('segmentation session with precomputed shapes', () => {
  const segments = { w: 2, h: 2, labels: new Int32Array([0, 0, 1, -1]), count: 2 };

  it('a photo with preset segments posts nothing and is done', () => {
    const { s, sent } = setup('auto');
    s.photo('a', { segments });
    expect(sent).toEqual([]);
    expect(s.state).toEqual({ phase: 'done', found: 2, preset: true });
  });

  it('a pick on a preset photo with policy auto posts encode and then the pick', async () => {
    const { s, sent, last } = setup('auto');
    s.photo('a', { segments });
    const shape = s.pick([[0.5, 0.5, 1]]);
    expect(sent.map((m) => m.type)).toEqual(['encode', 'pick']);
    expect(sent[0]).toMatchObject({ image: 'a' });
    s.receive({ type: 'shape', id: last('pick').id, region });
    await expect(shape).resolves.toBe(region);
    // A second pick does not encode again.
    s.pick([[0.4, 0.4, 1]]);
    expect(sent.map((m) => m.type)).toEqual(['encode', 'pick', 'pick']);
  });

  it('a pick on a preset photo with policy ask asks first, and after accept posts encode and the pick', async () => {
    const { s, sent, last } = setup('ask');
    s.photo('a', { segments });
    expect(s.state.phase).toBe('done');
    const shape = s.pick([[0.5, 0.5, 1]]);
    expect(s.state.phase).toBe('ask');
    expect(sent).toEqual([]);
    s.accept();
    expect(sent.map((m) => m.type)).toEqual(['encode', 'pick']);
    s.receive({ type: 'shape', id: last('pick').id, region });
    await expect(shape).resolves.toBe(region);
  });

  it('encoded brings back the done state of the preset', () => {
    const { s, last } = setup('auto');
    s.photo('a', { segments });
    s.pick([[0.5, 0.5, 1]]);
    const id = last('encode').id;
    s.receive({ type: 'progress', id, phase: 'download', done: 1, total: 4 });
    expect(s.state.phase).toBe('download');
    expect(s.receive({ type: 'encoded', id })).toBe(true);
    expect(s.state).toEqual({ phase: 'done', found: 2, preset: true });
  });
});

describe('segOverrides', () => {
  it('reads the device, batch and points from the query', () => {
    expect(segOverrides('?debug&samDevice=wasm&segBatch=16&segPoints=48')).toEqual({ device: 'wasm', batch: 16, points: 48 });
  });
  it('ignores values that are not positive integers', () => {
    expect(segOverrides('?segBatch=0&segPoints=-3')).toEqual({});
    expect(segOverrides('?segBatch=abc&segPoints=1.5')).toEqual({});
    expect(segOverrides('?segBatch=&segPoints=')).toEqual({});
    expect(segOverrides('')).toEqual({});
  });
});
