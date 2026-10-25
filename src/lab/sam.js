// LAB SPIKE: "segment everything" in the browser with SlimSAM. Throwaway.
// Used by lab/segment.html and, in ?lab, by the app's segmentation worker.
//
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

env.allowLocalModels = false;
const MODEL = 'Xenova/slimsam-77-uniform';
// Settings; the lab page overrides them from its URL.
export const opts = {
  points: 256, cropPoints: 160, crops: 2, iou: 0.86, stability: 0.9, nms: 0.7,
  skip: true, batch: 32,
  device: typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm',
  dtype: undefined,
};

let model, processor;
export async function load(log = () => {}) {
  if (model) return;
  const t = performance.now();
  // fp16 was fastest on WebGPU (24 s vs 44 s fp32, 121 s q8 on an Intel
  // Gen12 laptop); q8 is fastest on the CPU.
  opts.dtype ??= opts.device === 'webgpu' ? 'fp16' : 'q8';
  try {
    model = await SamModel.from_pretrained(MODEL, { device: opts.device, dtype: opts.dtype });
  } catch (e) {
    log(`${opts.device} failed (${e.message}), using wasm`);
    opts.device = 'wasm';
    opts.dtype = 'q8';
    model = await SamModel.from_pretrained(MODEL, { device: 'wasm', dtype: opts.dtype });
  }
  processor = await AutoProcessor.from_pretrained(MODEL);
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

// One pass of the model over `box` (image px, inclusive) of the photo with
// prompt points in image px. Candidates come back as masks at display scale
// `ds`, each with its display-pixel box. In a crop, masks that touch an
// inner edge of the crop are dropped: they are cut-off pieces of something
// larger, which the full-image pass sees whole.
async function decodePass(image, box, points, ds, T, name) {
  let t = performance.now();
  const full = box[0] === 0 && box[1] === 0 && box[2] === image.width - 1 && box[3] === image.height - 1;
  const sub = full ? image : await image.crop(box);
  const inputs = await processor(sub);
  const emb = await model.get_image_embeddings(inputs);
  T[`${name} encoder`] = performance.now() - t;
  t = performance.now();
  const [rh, rw] = inputs.reshaped_input_sizes[0];
  const k = rw / sub.width;
  const mw = Math.ceil(rw / 4), mh = Math.ceil(rh / 4);
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
    if (!batch.length) break;
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
        let hi = 0, lo = 0, area = 0, x0 = mw, y0 = mh, x1 = -1, y1 = -1;
        for (let y = 0; y < mh; y++) {
          for (let x = 0; x < mw; x++) {
            const v = logits[off + y * W + x];
            if (v > 1) hi++;
            if (v > -1) lo++;
            if (v > 0) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
          }
        }
        const stab = lo ? hi / lo : 0;
        if (stab < opts.stability || area < 6 || area > 0.95 * mw * mh) continue;
        // Two cells of margin: mask edges are padded and rounded.
        if ((inner.l && x0 <= 1) || (inner.t && y0 <= 1) || (inner.r && x1 >= mw - 3) || (inner.b && y1 >= mh - 3)) continue;
        // Display box of the mask, then bilinear upsampling of its logits.
        const toImg = (mx) => mx * 4 / k;
        const dx0 = Math.max(0, Math.floor((box[0] + toImg(x0 - 1)) * ds)), dx1 = Math.min(W0 - 1, Math.ceil((box[0] + toImg(x1 + 2)) * ds));
        const dy0 = Math.max(0, Math.floor((box[1] + toImg(y0 - 1)) * ds)), dy1 = Math.min(H0 - 1, Math.ceil((box[1] + toImg(y1 + 2)) * ds));
        const bw = dx1 - dx0 + 1, bh = dy1 - dy0 + 1;
        const data = new Uint8Array(bw * bh);
        let darea = 0;
        for (let y = 0; y < bh; y++) {
          const my = Math.min(mh - 1.001, Math.max(0, (((dy0 + y + 0.5) / ds - box[1]) * k) / 4 - 0.5));
          const yi = Math.floor(my), fy = my - yi;
          for (let x = 0; x < bw; x++) {
            const mx = Math.min(mw - 1.001, Math.max(0, (((dx0 + x + 0.5) / ds - box[0]) * k) / 4 - 0.5));
            const xi = Math.floor(mx), fx = mx - xi, o = off + yi * W + xi;
            const v = (logits[o] * (1 - fx) + logits[o + 1] * fx) * (1 - fy) + (logits[o + W] * (1 - fx) + logits[o + W + 1] * fx) * fy;
            if (v > 0) { data[y * bw + x] = 1; darea++; }
          }
        }
        if (darea) cands.push({ data, box: [dx0, dy0, dx1, dy1], area: darea, score: iou * stab, pass: name });
      }
    }
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
// the detail is. Pass 2: crops around the most detailed objects found,
// embedded again at full model resolution so small parts (eyes) get enough
// pixels.
export async function segmentEverything(image, outLong = 600) {
  const T = {};
  let t = performance.now();
  const dm = detailMap(image);
  T.detail = performance.now() - t;
  const ds = outLong / Math.max(image.width, image.height);
  const w = Math.round(image.width * ds), h = Math.round(image.height * ds);
  const all = [0, 0, image.width - 1, image.height - 1];
  let cands = await decodePass(image, all, promptPoints(dm, all, opts.points, 1), ds, T, 'pass 1');
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

// Partition: each pixel belongs to the smallest mask covering it (-1: none).
export function partition({ w, h, masks }) {
  const order = masks.map((m, i) => i).sort((a, b) => masks[b].area - masks[a].area);
  const label = new Int32Array(w * h).fill(-1);
  for (const i of order) {
    const d = masks[i].data;
    for (let k = 0; k < w * h; k++) if (d[k]) label[k] = i;
  }
  return label;
}

