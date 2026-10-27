// Finds the objects of a photo with SlimSAM, off the main thread. The coarse
// pass: one encoding of the whole photo and about 64 prompt points, no zoomed
// crops, enough for the outlines of the big objects. Then the touches on the
// photo: a shape from the kept encoding, and the parts inside a shape.
//
// In:  { type: 'coarse', id, image, device?, batch?, points? }
//      { type: 'encode', id, image, device? }
//      { type: 'pick', id, points: [[u, v, 1 | 0]] }
//      { type: 'parts', id, region }
// Out: { type: 'progress', id, phase: 'download' | 'encode' | 'decode', done, total, found? }
//      { type: 'encoded', id }
//      { type: 'segments', id, segments: { w, h, labels }, count, ms }
//      { type: 'shape', id, region } (region null where there is no shape)
//      { type: 'parts', id, parts }
//      { type: 'log', id, text }
//      { type: 'timing', id, entry: { seg: 'download' | 'encode' | 'decode' | 'pick' | 'parts', ms, device, dtype, batch, points, photo: { id, w, h }, found? (decode), waited? (pick, parts) } }
//      { type: 'error', id, message }
// `image` is an ImageData, the photo at a long side of up to 1024 px. `encode`
// is the coarse pass without the segmenting, for photos whose segments are
// already known: it loads the model and encodes the photo for the touches.
// A pick or parts request waits for the encoding of the photo in flight.
import { RawImage } from '@huggingface/transformers';
import { embedImage, load, opts, partition, pickMask, segmentEverything, segmentParts } from './sam.js';

// The photo of the last coarse pass and the promise of its encoding.
let photo = null;

// A timing for the debug page (?debug), tagged with the settings in use and
// the photo it belongs to (the id of its coarse pass and the size of the
// encoded image), so pasted entries can be told apart. Timings of a pass
// that a newer photo replaced are not posted. A pick or parts time includes
// `waited`, the wait for the photo's encoding.
function timing(cur, id, seg, ms, extra) {
  if (photo !== cur) return;
  const entry = {
    seg, ms, ...extra, device: opts.device, dtype: opts.dtype, batch: opts.batch, points: opts.points,
    photo: { id: cur.id, w: cur.image?.width, h: cur.image?.height },
  };
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

// Loads the model and encodes the photo, reporting download and encode
// progress. Returns the pass `current` (the photo for the touches), or null
// when a newer photo replaced this one on the way.
async function loadAndEncode({ id, image, device, batch, points }, report) {
  if (device) opts.device = device;
  if (batch) opts.batch = batch;
  if (points) opts.points = points;
  const t = performance.now();
  const current = { id, image: null, encoded: null };
  let ready;
  current.encoded = new Promise((resolve, reject) => { ready = { resolve, reject }; });
  // A pick that fails along with the encoding is answered by its own error.
  current.encoded.catch(() => {});
  photo = current;
  try {
    let size = 0;
    await load(({ loaded, total }) => { size = total; report('download', loaded, total); }, (text) => self.postMessage({ type: 'log', id, text }));
    if (size) report('download', size, size);
    const downloadMs = performance.now() - t;
    current.image = new RawImage(image.data, image.width, image.height, 4).rgb();
    // A newer photo arrived while the model loaded: stop before encoding.
    if (photo !== current) throw new Error('photo changed');
    timing(current, id, 'download', downloadMs);
    report('encode', 0, 1);
    const tEncode = performance.now();
    await embedImage(current.image);
    if (photo !== current) throw new Error('photo changed');
    timing(current, id, 'encode', performance.now() - tEncode);
    ready.resolve(current.image);
    report('encode', 1, 1);
    return current;
  } catch (e) {
    ready.reject(e);
    throw e;
  }
}

async function coarse(msg) {
  const { id } = msg;
  const t = performance.now();
  const report = progress(id);
  try {
    const current = await loadAndEncode(msg, report);
    // A newer photo stops this pass at its next batch.
    const tDecode = performance.now();
    const res = await segmentEverything(current.image, 512, { onBatch: (done, total, found) => {
      if (photo !== current) throw new Error('photo changed');
      report('decode', done, total, found);
    } });
    timing(current, id, 'decode', performance.now() - tDecode, { found: res.masks.length });
    const labels = partition(res);
    self.postMessage({
      type: 'segments', id, segments: { w: res.w, h: res.h, labels }, count: res.masks.length, ms: performance.now() - t,
    }, [labels.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', id, message: e?.message || String(e) });
  }
}

async function encodeOnly(msg) {
  try {
    await loadAndEncode(msg, progress(msg.id));
    self.postMessage({ type: 'encoded', id: msg.id });
  } catch (e) {
    self.postMessage({ type: 'error', id: msg.id, message: e?.message || String(e) });
  }
}

self.onmessage = async ({ data }) => {
  if (data.type === 'coarse') return coarse(data);
  if (data.type === 'encode') return encodeOnly(data);
  const { id } = data;
  const t = performance.now();
  try {
    if (!photo) throw new Error('no photo');
    const p = photo;
    const image = await p.encoded;
    const waited = performance.now() - t;
    // A newer photo replaced this one while it was encoding.
    if (p !== photo) throw new Error('photo changed');
    if (data.type === 'pick') {
      // No shape there is an answer, not an error: the app tells them apart.
      const region = await pickMask(data.points, image);
      timing(p, id, 'pick', performance.now() - t, { waited });
      self.postMessage({ type: 'shape', id, region }, region ? [region.data.buffer] : []);
    } else if (data.type === 'parts') {
      const parts = await segmentParts(image, data.region);
      timing(p, id, 'parts', performance.now() - t, { waited });
      self.postMessage({ type: 'parts', id, parts }, [parts.labels.buffer]);
    }
  } catch (e) {
    self.postMessage({ type: 'error', id, message: e?.message || String(e) });
  }
};
