import { analyze } from './analysis.js';
import { applyPalette, shardColors } from './color.js';
import { toLab } from './image.js';
import { keysForStage, STAGE_ORDER } from './params.js';
import { renderMosaic } from './render.js';
import { mulberry32 } from './rng.js';
import { tessellate } from './tessellate.js';

// Lengths measured in working pixels; a preview run halves them so the
// half-size result looks like the full one.
const LENGTHS = ['sMin', 'sMax', 'grout', 'bevel'];

// 2x box downsample, used for the preview image.
export function halve(img) {
  const w = Math.ceil(img.w / 2), h = Math.ceil(img.h / 2);
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0, n = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const xx = 2 * x + dx, yy = 2 * y + dy;
            if (xx < img.w && yy < img.h) { s += img.rgb[(yy * img.w + xx) * 3 + c]; n++; }
          }
        }
        rgb[(y * w + x) * 3 + c] = s / n;
      }
    }
  }
  return { w, h, rgb };
}

// Runs the four stages, reusing cached results whose inputs did not change.
// `onStage(name, result)` fires after each stage; `isStale()` lets the caller
// abandon a run when newer parameters arrive (checked between stages).
// With { preview: true } it runs on a half-size copy of the image, with its
// own cache, so dragging a slider stays responsive.
export function createPipeline() {
  let full = null, half = null, imgVersion = 0;
  const caches = { full: {}, preview: {} };

  const stageKey = (stage, p) => {
    const upto = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage) + 1);
    const vals = upto.flatMap((s) => keysForStage(s).map((k) => p[k]));
    return JSON.stringify([imgVersion, vals]);
  };

  return {
    setImage(next) {
      full = { img: next, lab: toLab(next) };
      const small = halve(next);
      half = { img: small, lab: toLab(small) };
      imgVersion++;
    },
    hasImage: () => !!full,
    async run(p, onStage, isStale = () => false, yieldFn = async () => {}, onStart = () => {}, opts = {}) {
      if (!full) return null;
      const { img, lab } = opts.preview ? half : full;
      const cache = opts.preview ? caches.preview : caches.full;
      if (opts.preview) {
        p = { ...p };
        for (const k of LENGTHS) p[k] *= 0.5;
      }
      const timings = {};
      const step = async (stage, fn) => {
        const key = stageKey(stage, p);
        if (cache[stage]?.key !== key) {
          await yieldFn();
          if (isStale()) throw new StaleRun();
          onStart(stage);
          const t0 = performance.now();
          cache[stage] = { key, value: fn() };
          timings[stage] = performance.now() - t0;
          onStage(stage, cache[stage].value, true);
        } else {
          onStage(stage, cache[stage].value, false);
        }
        return cache[stage].value;
      };
      try {
        const an = await step('analysis', () => analyze(img, p));
        const tess = await step('tessellation', () => tessellate(img, lab, an, p, mulberry32(p.seed)));
        const col = await step('color', () => {
          const flat = shardColors(tess.shards, img, p);
          const pal = applyPalette(flat, tess.shards, p, mulberry32(p.seed + 101));
          return { flat, ...pal };
        });
        await step('render', () => renderMosaic(tess.shards, col.colors, img.w, img.h, p));
        return { timings, shards: tess.shards.length };
      } catch (e) {
        if (e instanceof StaleRun) return null;
        throw e;
      }
    },
    get image() {
      return full?.img ?? null;
    },
    imageFor: (preview) => (preview ? half : full)?.img ?? null,
  };
}

export class StaleRun extends Error {}
