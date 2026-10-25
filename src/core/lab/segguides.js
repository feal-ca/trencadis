// LAB SPIKE (?lab): hileras along the outlines of the objects a segmentation
// model found (src/lab/sam.js), instead of along strong edges only.
import { bridgeGaps, chainLength, smoothChain, traceChains } from '../andamento.js';

// `seg` is { w, h, labels } with one label per object (-1: no object), at
// any resolution. Returns polylines in working pixels (w x h): the borders
// between objects, joined across small gaps, smoothed, and without the
// short ones (shorter than `minLen` sizes of the largest piece).
export function segmentGuides(seg, w, h, p, minLen = 1.5) {
  if (!seg) return [];
  const at = (x, y) => seg.labels[Math.min(seg.h - 1, Math.floor(((y + 0.5) / h) * seg.h)) * seg.w + Math.min(seg.w - 1, Math.floor(((x + 0.5) / w) * seg.w))];
  const label = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) label[y * w + x] = at(x, y);
  // One-pixel border: a pixel whose right or lower neighbour is another object.
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, l = label[i];
      if ((x + 1 < w && label[i + 1] !== l) || (y + 1 < h && label[i + w] !== l)) edge[i] = 1;
    }
  }
  return bridgeGaps(traceChains(edge, w, h).filter((c) => c.length > 2), Math.max(6, p.sMin))
    .map(smoothChain)
    .filter((c) => c.length > 1 && chainLength(c) >= minLen * p.sMax);
}
