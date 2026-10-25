// LAB SPIKE (?lab): finds the objects of a photo with SlimSAM, off the main
// thread. Only the first pass (the whole photo, no zoomed crops): about 7 s
// on an Intel laptop GPU, and enough for the outlines of the big objects.
import { RawImage } from '@huggingface/transformers';
import { load, opts, partition, segmentEverything } from './sam.js';

opts.crops = 0;

self.onmessage = async ({ data }) => {
  const { id, blob, device } = data;
  if (device) opts.device = device;
  const t = performance.now();
  try {
    await load((text) => self.postMessage({ type: 'log', id, text }));
    const image = await RawImage.fromBlob(blob);
    const res = await segmentEverything(image, 512);
    const labels = partition(res);
    self.postMessage({
      type: 'segments', id, segments: { w: res.w, h: res.h, labels }, count: res.masks.length, ms: performance.now() - t,
    }, [labels.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', id, message: e?.message || String(e) });
  }
};
