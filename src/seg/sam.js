// "Segment everything" in the browser with SlimSAM.
// Used by the app's segmentation worker.
// SlimSAM embeds the image once; its small decoder then turns each prompt
// point of a grid into three candidate masks. Candidates are kept when the
// model is confident (predicted IoU) and the mask is stable (it barely
// changes when the threshold moves), then duplicates are dropped (NMS),
// as in SAM's automatic mask generator.
import { AutoProcessor, env, RawImage, SamModel, Tensor } from '@huggingface/transformers';
import { analyze } from '../core/analysis.js';
import { fromImageData } from '../core/image.js';
import { applyMacroDefaults } from '../core/macros.js';
import { DEFAULTS, toWorkPx } from '../core/params.js';
import { mulberry32 } from '../core/rng.js';
import { poissonVariable } from '../core/sampling.js';
import { chooseMask } from './chooseMask.js';
import { partition } from './partition.js';

export { partition };

env.allowLocalModels = false;
const MODEL = 'Xenova/slimsam-77-uniform';
// Segmentation settings. The coarse pass asks about 64 prompt points in
// batches of 32, with no zoomed crops (crops: 0; cropPoints is the points
// per crop when there are crops).
export const opts = {
  points: 64, cropPoints: 160, crops: 0, iou: 0.86, stability: 0.9, nms: 0.7,
  skip: true, batch: 32,
  device: typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm',
  dtype: undefined,
};

let model, processor;
// One load at a time: a call made while the model is loading waits for the
// same load, and from then on the progress and log go to its callbacks.
let loading = null, listeners = {};
// `onProgress({ loaded, total })` reports the bytes of the model downloaded so
// far. The library sizes every file of the model before it starts, so
// `total` stays put; the processor's files are tiny and not counted.
export function load(onProgress, log = () => {}) {
  listeners = { onProgress, log };
  loading ??= loadModel().catch((e) => { loading = null; throw e; });
  return loading;
}

async function loadModel() {
  // Each half loads only if missing, so a processor that failed after the
  // model loaded is tried again on the next call.
  if (model && processor) return;
  const t = performance.now();
  const log = (text) => listeners.log(text);
  const progress_callback = (e) => {
    if (e.status === 'progress_total' && e.total) listeners.onProgress?.({ loaded: e.loaded, total: e.total });
  };
  // fp16 was fastest on WebGPU (24 s vs 44 s fp32, 121 s q8 on an Intel
  // Gen12 laptop); q8 is fastest on the CPU.
  opts.dtype ??= opts.device === 'webgpu' ? 'fp16' : 'q8';
  if (!model) {
    try {
      model = await SamModel.from_pretrained(MODEL, { device: opts.device, dtype: opts.dtype, progress_callback });
    } catch (e) {
      log(`${opts.device} failed (${e.message}), using wasm`);
      opts.device = 'wasm';
      opts.dtype = 'q8';
      model = await SamModel.from_pretrained(MODEL, { device: 'wasm', dtype: opts.dtype, progress_callback });
    }
  }
  processor ??= await AutoProcessor.from_pretrained(MODEL);
  log(`model loaded on ${opts.device} (${opts.dtype}) in ${Math.round(performance.now() - t)} ms`);
  // Which GPU WebGPU got: a software ("fallback") adapter is slower than WASM.
  const adapter = await navigator.gpu?.requestAdapter();
  const info = adapter?.info ?? {};
  log(`webgpu adapter: ${adapter ? `${info.vendor || '?'} ${info.architecture || ''} ${info.description || ''}${adapter.isFallbackAdapter || info.isFallbackAdapter ? ' (SOFTWARE fallback)' : ''}` : 'none'}`);
  log(`wasm threads: ${crossOriginIsolated ? navigator.hardwareConcurrency : '1 (page not cross-origin isolated)'}`);
}

// Detail map of the photo (the app's own analysis, at 400 px), to decide
// where to ask the model.
function detailMap(image) {
  const s = 400 / Math.max(image.width, image.height);
  const cv = new OffscreenCanvas(Math.round(image.width * s), Math.round(image.height * s));
  const ctx = cv.getContext('2d');
  ctx.drawImage(image.toCanvas(), 0, 0, cv.width, cv.height);
  const img = fromImageData(ctx.getImageData(0, 0, cv.width, cv.height));
  const an = analyze(img, toWorkPx({ ...applyMacroDefaults(DEFAULTS), workLong: 400 }));
  return { an, s };
}

// About `target` prompt points inside `box` (image px), denser where the
// detail map says there is detail.
function promptPoints({ an, s }, box, target, seed) {
  const inBox = (pts) => pts.filter(([x, y]) => x / s >= box[0] && x / s <= box[2] && y / s >= box[1] && y / s <= box[3]);
  const n0 = inBox(poissonVariable(an, 1, mulberry32(seed))).length || 1;
  const spacing = Math.sqrt(n0 / target);
  const rng = mulberry32(seed + 7);
  const pts = inBox(poissonVariable(an, spacing, mulberry32(seed))).map(([x, y]) => {
    const d = an.detail[Math.min(an.h - 1, Math.floor(y)) * an.w + Math.min(an.w - 1, Math.floor(x))];
    return [x / s, y / s, d];
  });
  // Random order, so the first batches already cover the whole photo.
  for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pts[i], pts[j]] = [pts[j], pts[i]]; }
  return pts;
}

// The model's encoding of an image: the embeddings, the scale `k` from image
// px to model input px, and the size of the mask grid (model px / 4).
async function encode(image) {
  const inputs = await processor(image);
  const emb = await model.get_image_embeddings(inputs);
  const [rh, rw] = inputs.reshaped_input_sizes[0];
  return { emb, k: rw / image.width, mw: Math.ceil(rw / 4), mh: Math.ceil(rh / 4) };
}

// The encoding of the whole photo, kept for the touches on it (pickMask) and
// reused by the first pass of segmentEverything on the same image.
let embedded = null;
export async function embedImage(image) {
  embedded = null;
  embedded = { image, ...await encode(image) };
  return embedded;
}

// Bilinear upsampling of one mask's logits, over mask cells [x0, y0, x1, y1]
// (with a cell of margin), to display px at scale `ds` of the image. `origin`
// is where the encoded image (or crop) sits in the image, in image px. Returns
// { box: display px box, inclusive, data, area }, or null if nothing is on.
function upsample(logits, off, W, enc, cells, origin, ds, W0, H0) {
  const { k, mw, mh } = enc;
  const [x0, y0, x1, y1] = cells;
  const toImg = (mx) => mx * 4 / k;
  const dx0 = Math.max(0, Math.floor((origin[0] + toImg(x0 - 1)) * ds)), dx1 = Math.min(W0 - 1, Math.ceil((origin[0] + toImg(x1 + 2)) * ds));
  const dy0 = Math.max(0, Math.floor((origin[1] + toImg(y0 - 1)) * ds)), dy1 = Math.min(H0 - 1, Math.ceil((origin[1] + toImg(y1 + 2)) * ds));
  const bw = dx1 - dx0 + 1, bh = dy1 - dy0 + 1;
  if (bw <= 0 || bh <= 0) return null;
  const data = new Uint8Array(bw * bh);
  let area = 0;
  for (let y = 0; y < bh; y++) {
    const my = Math.min(mh - 1.001, Math.max(0, (((dy0 + y + 0.5) / ds - origin[1]) * k) / 4 - 0.5));
    const yi = Math.floor(my), fy = my - yi;
    for (let x = 0; x < bw; x++) {
      const mx = Math.min(mw - 1.001, Math.max(0, (((dx0 + x + 0.5) / ds - origin[0]) * k) / 4 - 0.5));
      const xi = Math.floor(mx), fx = mx - xi, o = off + yi * W + xi;
      const v = (logits[o] * (1 - fx) + logits[o + 1] * fx) * (1 - fy) + (logits[o + W] * (1 - fx) + logits[o + W + 1] * fx) * fy;
      if (v > 0) { data[y * bw + x] = 1; area++; }
    }
  }
  return area ? { box: [dx0, dy0, dx1, dy1], data, area } : null;
}

// The cells of one mask with a positive logit: their box, count, and the
// counts above +1 and -1 (for the stability score).
function maskStats(logits, off, W, mw, mh) {
  let hi = 0, lo = 0, area = 0, x0 = mw, y0 = mh, x1 = -1, y1 = -1;
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const v = logits[off + y * W + x];
      if (v > 1) hi++;
      if (v > -1) lo++;
      if (v > 0) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
  }
  return { area, box: [x0, y0, x1, y1], stab: lo ? hi / lo : 0 };
}

// One pass of the model over `box` (image px, inclusive) of the photo with
// prompt points in image px. Candidates come back as masks at display scale
// `ds`, each with its display-pixel box. In a crop, masks that touch an
// inner edge of the crop are dropped: they are cut-off pieces of something
// larger, which the full-image pass sees whole.
async function decodePass(image, box, points, ds, T, name, onBatch) {
  let t = performance.now();
  const full = box[0] === 0 && box[1] === 0 && box[2] === image.width - 1 && box[3] === image.height - 1;
  const enc = full && embedded?.image === image ? embedded : full ? await embedImage(image) : await encode(await image.crop(box));
  const { emb, k, mw, mh } = enc;
  T[`${name} encoder`] = performance.now() - t;
  t = performance.now();
  const inner = { l: box[0] > 0, t: box[1] > 0, r: box[2] < image.width - 1, b: box[3] < image.height - 1 };
  const W0 = Math.round(image.width * ds), H0 = Math.round(image.height * ds);
  const cands = [];
  const B = opts.batch;
  // A point in a flat area (low detail) inside a large object already found
  // adds nothing: skip it. Points on detail always run (an eye in a face).
  const covered = ([x, y, d]) => opts.skip && d < 0.25 && cands.some((c) => {
    if (c.area < 0.01 * W0 * H0) return false;
    const X = Math.floor(x * ds) - c.box[0], Y = Math.floor(y * ds) - c.box[1], bw = c.box[2] - c.box[0] + 1;
    return X >= 0 && Y >= 0 && X < bw && Y <= c.box[3] - c.box[1] && c.data[Y * bw + X];
  });
  let modelMs = 0, used = 0;
  for (let s = 0; s < points.length;) {
    const batch = [];
    while (batch.length < B && s < points.length) {
      const pt = points[s++];
      if (!covered(pt)) batch.push([(pt[0] - box[0]) * k, (pt[1] - box[1]) * k]);
    }
    // Every point left may have been skipped; progress still reaches the end.
    if (!batch.length) { onBatch?.(s, points.length, cands.length); continue; }
    used += batch.length;
    const input_points = new Tensor('float32', batch.flat(), [1, batch.length, 1, 2]);
    const input_labels = new Tensor('int64', batch.map(() => 1n), [1, batch.length, 1]);
    const tm = performance.now();
    const out = await model({ ...emb, input_points, input_labels });
    const logits = out.pred_masks.data, ious = out.iou_scores.data;
    modelMs += performance.now() - tm;
    const [, nb, nm, H, W] = out.pred_masks.dims;
    for (let b = 0; b < nb; b++) {
      for (let m = 0; m < nm; m++) {
        const iou = ious[b * nm + m];
        if (iou < opts.iou) continue;
        const off = (b * nm + m) * H * W;
        const { area, box: [x0, y0, x1, y1], stab } = maskStats(logits, off, W, mw, mh);
        if (stab < opts.stability || area < 6 || area > 0.95 * mw * mh) continue;
        // Two cells of margin: mask edges are padded and rounded.
        if ((inner.l && x0 <= 1) || (inner.t && y0 <= 1) || (inner.r && x1 >= mw - 3) || (inner.b && y1 >= mh - 3)) continue;
        const up = upsample(logits, off, W, enc, [x0, y0, x1, y1], box, ds, W0, H0);
        if (up) cands.push({ ...up, score: iou * stab, pass: name });
      }
    }
    onBatch?.(s, points.length, cands.length);
  }
  T[`${name} decoder (${used} of ${points.length} pts; model ${Math.round(modelMs)} ms)`] = performance.now() - t;
  return cands;
}

// Drops candidates overlapping a better one by more than opts.nms (mask IoU).
function nms(cands) {
  cands.sort((a, b) => b.score - a.score);
  const kept = [];
  const iou = (a, b) => {
    const x0 = Math.max(a.box[0], b.box[0]), x1 = Math.min(a.box[2], b.box[2]);
    const y0 = Math.max(a.box[1], b.box[1]), y1 = Math.min(a.box[3], b.box[3]);
    if (x1 < x0 || y1 < y0) return 0;
    const aw = a.box[2] - a.box[0] + 1, bw = b.box[2] - b.box[0] + 1;
    let inter = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (a.data[(y - a.box[1]) * aw + x - a.box[0]] && b.data[(y - b.box[1]) * bw + x - b.box[0]]) inter++;
      }
    }
    return inter / (a.area + b.area - inter);
  };
  for (const c of cands) if (!kept.some((k) => iou(c, k) > opts.nms)) kept.push(c);
  return kept;
}

// Returns { w, h, masks: [{ data: Uint8Array(w*h), area, score }] } at the
// display size, plus timings. Pass 1: the whole photo, prompt points where
// the detail is. Pass 2 (only with opts.crops > 0): crops around the most
// detailed objects found, embedded again at full model resolution so small
// parts (eyes) get enough pixels. `onBatch(done, total, found)` is called after each batch of the
// first pass: prompt points tried, points in all, candidates kept so far.
export async function segmentEverything(image, outLong = 600, { onBatch } = {}) {
  const T = {};
  let t = performance.now();
  const dm = detailMap(image);
  T.detail = performance.now() - t;
  const ds = outLong / Math.max(image.width, image.height);
  const w = Math.round(image.width * ds), h = Math.round(image.height * ds);
  const all = [0, 0, image.width - 1, image.height - 1];
  let cands = await decodePass(image, all, promptPoints(dm, all, opts.points, 1), ds, T, 'pass 1', onBatch);
  const first = nms(cands.slice());

  // Crops: objects between 1 % and 30 % of the photo, densest detail
  // first, skipping ones mostly inside a crop already chosen. A crop is at
  // most half the photo across, so it is a real zoom.
  const { an } = dm;
  const detailIn = (c) => {
    let sum = 0;
    const bw = c.box[2] - c.box[0] + 1;
    for (let k = 0; k < c.data.length; k += 3) {
      if (!c.data[k]) continue;
      const x = c.box[0] + (k % bw), y = c.box[1] + Math.floor(k / bw);
      sum += an.detail[Math.min(an.h - 1, Math.floor((y / ds) * dm.s)) * an.w + Math.min(an.w - 1, Math.floor((x / ds) * dm.s))];
    }
    return sum / Math.max(1, c.area / 3);
  };
  const crops = [];
  for (const c of first.filter((c) => c.area > 0.01 * w * h && c.area < 0.3 * w * h).sort((a, b) => detailIn(b) - detailIn(a))) {
    if (crops.length >= opts.crops) break;
    let [x0, y0, x1, y1] = c.box.map((v) => v / ds);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const hw = Math.min(0.65 * (x1 - x0), image.width / 4), hh = Math.min(0.65 * (y1 - y0), image.height / 4);
    const [mx, my] = [0, 0];
    [x0, y0, x1, y1] = [cx - hw, cy - hh, cx + hw, cy + hh];
    const box = [Math.max(0, Math.floor(x0 - mx)), Math.max(0, Math.floor(y0 - my)), Math.min(image.width - 1, Math.ceil(x1 + mx)), Math.min(image.height - 1, Math.ceil(y1 + my))];
    const inside = crops.some((b) => Math.max(0, Math.min(b[2], box[2]) - Math.max(b[0], box[0])) * Math.max(0, Math.min(b[3], box[3]) - Math.max(b[1], box[1])) > 0.7 * (box[2] - box[0]) * (box[3] - box[1]));
    if (!inside) crops.push(box);
  }
  for (let i = 0; i < crops.length; i++) {
    cands = cands.concat(await decodePass(image, crops[i], promptPoints(dm, crops[i], opts.cropPoints, 2 + i), ds, T, `crop ${i + 1}`));
  }
  t = performance.now();
  const kept = nms(cands);
  const masks = kept.map((c) => {
    const data = new Uint8Array(w * h);
    const bw = c.box[2] - c.box[0] + 1;
    for (let k = 0; k < c.data.length; k++) if (c.data[k]) data[(c.box[1] + Math.floor(k / bw)) * w + c.box[0] + (k % bw)] = 1;
    return { data, area: c.area, score: c.score, pass: c.pass };
  });
  T.nms = performance.now() - t;
  return { w, h, masks, candidates: cands.length, crops: crops.map((b) => b.map((v) => Math.round(v * ds))), T };
}

// Touched shapes come back as a region normalised to the photo:
// { box: [u0, v0, u1, v1], w, h, data: Uint8Array(w*h) }, at a scale where
// the photo's long side is REGION_LONG px.
const REGION_LONG = 512;
// Parts of a shape are found at this long side of the crop around it.
const PARTS_LONG = 256;

// The mask the model gives for prompt points [[u, v, 1 | 0]] (normalised; 1
// is a point on the shape, 0 one off it) on `image`, with its kept encoding
// (encoded again if the kept one is of another image). Of the three
// candidate masks it keeps the smallest confident one for one point, and a
// larger one for each point added (chooseMask.js), so a tap on an iris gives
// the iris and touching it again grows it to the eye. Returns the region, or
// null if every mask is empty.
export async function pickMask(points, image) {
  const enc = embedded?.image === image ? embedded : await embedImage(image);
  const { emb, k } = enc;
  const input_points = new Tensor('float32', points.flatMap(([u, v]) => [u * image.width * k, v * image.height * k]), [1, 1, points.length, 2]);
  const input_labels = new Tensor('int64', points.map((p) => BigInt(p[2] ?? 1)), [1, 1, points.length]);
  const out = await model({ ...emb, input_points, input_labels });
  const [, , nm, H, W] = out.pred_masks.dims;
  const logits = out.pred_masks.data;
  const stats = Array.from({ length: nm }, (_, m) => maskStats(logits, m * H * W, W, enc.mw, enc.mh));
  const best = chooseMask(out.iou_scores.data, stats.map((st) => st.area), points.length);
  if (best < 0) return null;
  const off = best * H * W;
  const { box } = stats[best];
  const ds = REGION_LONG / Math.max(image.width, image.height);
  const W0 = Math.round(image.width * ds), H0 = Math.round(image.height * ds);
  const up = upsample(logits, off, W, enc, box, [0, 0], ds, W0, H0);
  if (!up) return null;
  const [x0, y0, x1, y1] = up.box;
  return { box: [x0 / W0, y0 / H0, (x1 + 1) / W0, (y1 + 1) / H0], w: x1 - x0 + 1, h: y1 - y0 + 1, data: up.data };
}

// The parts of a touched shape, for "Más detalle": a crop around the region
// (15 % of margin) is encoded again at the model's full resolution and a grid
// of about 48 prompt points inside the region finds the parts in it (an iris,
// the white of an eye, an eyelid). Each pixel of the region takes the
// smallest part covering it; what no part covers is one more part, so the
// parts fill the shape. Returns { box, w, h, labels: Int32Array(w*h), count }
// over the crop, normalised to the photo, with the crop's long side at
// PARTS_LONG px and -1 outside the region.
export async function segmentParts(image, region) {
  const [u0, v0, u1, v1] = region.box;
  const mu = 0.15 * (u1 - u0), mv = 0.15 * (v1 - v0);
  const box = [
    Math.max(0, Math.floor((u0 - mu) * image.width)), Math.max(0, Math.floor((v0 - mv) * image.height)),
    Math.min(image.width - 1, Math.ceil((u1 + mu) * image.width) - 1), Math.min(image.height - 1, Math.ceil((v1 + mv) * image.height) - 1),
  ];
  const inRegion = (u, v) => {
    const rx = Math.floor(((u - u0) / (u1 - u0)) * region.w), ry = Math.floor(((v - v0) / (v1 - v0)) * region.h);
    return rx >= 0 && ry >= 0 && rx < region.w && ry < region.h && region.data[ry * region.w + rx] === 1;
  };
  // Grid spacing (image px) for about 48 points on the region's area.
  let on = 0;
  for (let i = 0; i < region.data.length; i++) on += region.data[i];
  const area = (on / (region.w * region.h)) * (u1 - u0) * image.width * (v1 - v0) * image.height;
  const step = Math.max(1, Math.sqrt(area / 48));
  const points = [];
  for (let y = v0 * image.height + step / 2; y < v1 * image.height; y += step) {
    for (let x = u0 * image.width + step / 2; x < u1 * image.width; x += step) {
      // Detail 1, so decodePass never skips a point.
      if (inRegion(x / image.width, y / image.height)) points.push([x, y, 1]);
    }
  }
  const cw = box[2] - box[0] + 1, ch = box[3] - box[1] + 1;
  const ds = PARTS_LONG / Math.max(cw, ch);
  const cands = points.length ? nms(await decodePass(image, box, points, ds, {}, 'parts')) : [];

  // The parts grid over the crop, in display px at scale ds.
  const ox = Math.round(box[0] * ds), oy = Math.round(box[1] * ds);
  const pw = Math.max(1, Math.round(cw * ds)), ph = Math.max(1, Math.round(ch * ds));
  const inside = new Uint8Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) inside[y * pw + x] = inRegion((ox + x + 0.5) / ds / image.width, (oy + y + 0.5) / ds / image.height) ? 1 : 0;
  }
  const masks = [];
  for (const c of cands) {
    const data = new Uint8Array(pw * ph);
    const bw = c.box[2] - c.box[0] + 1;
    let n = 0;
    for (let i = 0; i < c.data.length; i++) {
      if (!c.data[i]) continue;
      const x = c.box[0] + (i % bw) - ox, y = c.box[1] + Math.floor(i / bw) - oy;
      if (x < 0 || y < 0 || x >= pw || y >= ph || !inside[y * pw + x]) continue;
      data[y * pw + x] = 1;
      n++;
    }
    if (n) masks.push({ data, area: n });
  }
  const labels = partition({ w: pw, h: ph, masks });
  // Consecutive labels for the parts left, the uncovered rest included.
  const ids = new Map();
  for (let i = 0; i < labels.length; i++) {
    if (!inside[i]) { labels[i] = -1; continue; }
    if (!ids.has(labels[i])) ids.set(labels[i], ids.size);
    labels[i] = ids.get(labels[i]);
  }
  return {
    box: [ox / ds / image.width, oy / ds / image.height, (ox + pw) / ds / image.width, (oy + ph) / ds / image.height],
    w: pw, h: ph, labels, count: ids.size,
  };
}
