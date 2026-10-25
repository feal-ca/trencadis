// Finds the objects of a photo with SlimSAM, off the main thread. Only the
// coarse pass: one encoding of the whole photo and about 64 prompt points,
// no zoomed crops. Enough for the outlines of the big objects.
//
// In:  { type: 'coarse', id, blob, device? }
// Out: { type: 'progress', id, phase: 'download' | 'encode' | 'decode', done, total, found? }
//      { type: 'segments', id, segments: { w, h, labels }, count, ms }
//      { type: 'error', id, message }
import { RawImage } from '@huggingface/transformers';
import { load, opts, partition, segmentEverything } from './sam.js';

opts.crops = 0;
opts.points = 64;

self.onmessage = async ({ data }) => {
  if (data.type !== 'coarse') return;
  const { id, blob, device } = data;
  if (device) opts.device = device;
  const t = performance.now();
  const progress = (phase, done, total, found) => self.postMessage({ type: 'progress', id, phase, done, total, found });
  try {
    await load(({ loaded, total }) => progress('download', loaded, total), (text) => self.postMessage({ type: 'log', id, text }));
    const image = await RawImage.fromBlob(blob);
    progress('encode', 0, 1);
    const res = await segmentEverything(image, 512, { onBatch: (done, total, found) => progress('decode', done, total, found) });
    const labels = partition(res);
    self.postMessage({
      type: 'segments', id, segments: { w: res.w, h: res.h, labels }, count: res.masks.length, ms: performance.now() - t,
    }, [labels.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', id, message: e?.message || String(e) });
  }
};
