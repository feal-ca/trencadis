import { analyze } from './analysis.js';
import { applyPalette, shardColors } from './color.js';
import { toLab } from './image.js';
import { keysForStage, STAGE_ORDER, toWorkPx } from './params.js';
import { renderMosaic } from './render.js';
import { mulberry32 } from './rng.js';
import { tessellate } from './tessellate.js';
import { zonesDetailMask } from './zones.js';

// Runs the four stages, reusing cached results whose inputs did not change.
// `onStage(name, result)` fires after each stage; `isStale()` lets the caller
// abandon a run when newer parameters arrive (checked between stages).
// { cpuRender: false } stops after the colour stage, for when the GPU draws
// the mosaic. { cpuLong } is the long side the render stage draws at (the
// screen, when there is no GPU); without it the stage draws at outLong.
export function createPipeline() {
  let full = null, imgVersion = 0, zones = null, zonesVersion = 0, guides = null, guidesVersion = 0;
  let segments = null, segmentsVersion = 0;
  const cache = {};

  const stageKey = (stage, p, long) => {
    const upto = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage) + 1);
    const vals = upto.flatMap((s) => keysForStage(s).map((k) => p[k]));
    const after = stage !== 'analysis';
    return JSON.stringify([imgVersion, zonesVersion, after ? guidesVersion : 0, after ? segmentsVersion : 0, vals, long]);
  };

  return {
    setImage(next) {
      full = { img: next, lab: toLab(next) };
      imgVersion++;
    },
    hasImage: () => !!full,
    // Touched shapes (zones.js), or null. "Less" zones calm the detail map;
    // "more" zones raise it and also get pieces with intention.
    setZones(next) {
      zones = next?.length ? next : null;
      zonesVersion++;
    },
    // Hand-drawn guide lines, polylines in normalised coordinates.
    setGuides(next) {
      guides = next;
      guidesVersion++;
    },
    // Objects from the segmentation model, { w, h, labels }, or null.
    setSegments(next) {
      segments = next;
      segmentsVersion++;
    },
    async run(params, onStage, isStale = () => false, yieldFn = async () => {}, onStart = () => {}, opts = {}) {
      if (!full) return null;
      // Cache keys use the settings as given; the stages get pixel lengths
      // scaled to the working resolution.
      const p = toWorkPx(params);
      const { img, lab } = full;
      const timings = {};
      const long = opts.cpuLong ?? params.outLong;
      const step = async (stage, fn, keyStage = stage) => {
        // Only the render stage depends on the size it is drawn at.
        const key = stageKey(keyStage, params, stage === 'render' ? long : null);
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
        const an = await step('analysis', () => analyze(img, p, zonesDetailMask(zones)));
        const tess = await step('tessellation', () => tessellate(img, lab, an, p, mulberry32(p.seed), guides, segments, zones));
        const col = await step('color', () => {
          const flat = shardColors(tess.shards, img, p);
          const pal = applyPalette(flat, tess.shards, p, mulberry32(p.seed + 101));
          return { flat, ...pal };
        });
        if (opts.cpuRender ?? true) await step('render', () => renderMosaic(tess.shards, col.colors, img.w, img.h, p, long));
        return { timings, shards: tess.shards.length };
      } catch (e) {
        if (e instanceof StaleRun) return null;
        throw e;
      }
    },
    get image() {
      return full?.img ?? null;
    },
    // Latest result of a stage, for drawing views on demand.
    cached: (stage) => cache[stage]?.value ?? null,
  };
}

export class StaleRun extends Error {}
