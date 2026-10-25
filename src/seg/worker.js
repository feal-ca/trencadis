// Finds the objects of a photo with SlimSAM, off the main thread. The coarse
// pass: one encoding of the whole photo and about 64 prompt points, no zoomed
// crops, enough for the outlines of the big objects. Then the touches on the
// photo: a shape from the kept encoding, and the parts inside a shape.
//
// In:  { type: 'coarse', id, blob, device?, batch?, points? }
//      { type: 'pick', id, points: [[u, v, 1 | 0]] }
//      { type: 'parts', id, region }
// Out: { type: 'progress', id, phase: 'download' | 'encode' | 'decode', done, total, found? }
//      { type: 'segments', id, segments: { w, h, labels }, count, ms }
//      { type: 'shape', id, region }
//      { type: 'parts', id, parts }
//      { type: 'log', id, text }
//      { type: 'timing', id, entry: { seg: 'download' | 'encode' | 'decode' | 'pick' | 'parts', ms, device, batch, points } }
//      { type: 'error', id, message }
// A pick or parts request waits for the encoding of the photo in flight.
import { RawImage } from '@huggingface/transformers';
import { embedImage, load, opts, partition, pickMask, segmentEverything, segmentParts } from './sam.js';

opts.crops = 0;
opts.points = 64;

// The photo of the last coarse pass and the promise of its encoding.
let photo = null;

// A timing for the debug page (?debug), tagged with the settings in use. A
// pick or parts time includes the wait for the photo's encoding, if any.
function timing(id, seg, since) {
  const entry = { seg, ms: performance.now() - since, device: opts.device, batch: opts.batch, points: opts.points };
  self.postMessage({ type: 'timing', id, entry });
}

// Progress messages, at most one every 100 ms per phase, plus the last one.
function progress(id) {
  const last = {};
  return (phase, done, total, found) => {
    const now = performance.now();
    if (done < total && now - (last[phase] ?? -Infinity) < 100) return;
    last[phase] = now;
    self.postMessage({ type: 'progress', id, phase, done, total, found });
  };
}

async function coarse({ id, blob, device, batch, points }) {
  if (device) opts.device = device;
  if (batch) opts.batch = batch;
  if (points) opts.points = points;
  const t = performance.now();
  const report = progress(id);
  const current = { image: null, encoded: null };
  let ready;
  current.encoded = new Promise((resolve, reject) => { ready = { resolve, reject }; });
  // A pick that fails along with the encoding is answered by its own error.
  current.encoded.catch(() => {});
  photo = current;
  try {
    let size = 0;
    await load(({ loaded, total }) => { size = total; report('download', loaded, total); }, (text) => self.postMessage({ type: 'log', id, text }));
    if (size) report('download', size, size);
    timing(id, 'download', t);
    current.image = await RawImage.fromBlob(blob);
    // A newer photo arrived while the model loaded: stop before encoding.
    if (photo !== current) throw new Error('photo changed');
    report('encode', 0, 1);
    const tEncode = performance.now();
    await embedImage(current.image);
    timing(id, 'encode', tEncode);
    if (photo !== current) throw new Error('photo changed');
    ready.resolve(current.image);
    report('encode', 1, 1);
    // A newer photo stops this pass at its next batch.
    const tDecode = performance.now();
    const res = await segmentEverything(current.image, 512, { onBatch: (done, total, found) => {
      if (photo !== current) throw new Error('photo changed');
      report('decode', done, total, found);
    } });
    timing(id, 'decode', tDecode);
    const labels = partition(res);
    self.postMessage({
      type: 'segments', id, segments: { w: res.w, h: res.h, labels }, count: res.masks.length, ms: performance.now() - t,
    }, [labels.buffer]);
  } catch (e) {
    ready.reject(e);
    self.postMessage({ type: 'error', id, message: e?.message || String(e) });
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'coarse') return coarse(data);
  const { id } = data;
  const t = performance.now();
  try {
    if (!photo) throw new Error('no photo');
    const p = photo;
    const image = await p.encoded;
    // A newer photo replaced this one while it was encoding.
    if (p !== photo) throw new Error('photo changed');
    if (data.type === 'pick') {
      const region = await pickMask(data.points, image);
      if (!region) throw new Error('no shape there');
      timing(id, 'pick', t);
      self.postMessage({ type: 'shape', id, region }, [region.data.buffer]);
    } else if (data.type === 'parts') {
      const parts = await segmentParts(image, data.region);
      timing(id, 'parts', t);
      self.postMessage({ type: 'parts', id, parts }, [parts.labels.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: 'error', id, message: e?.message || String(e) });
  }
};
