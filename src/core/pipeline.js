import { analyzeMaps, withSize } from './analysis.js';
import { applyPalette, shardColors } from './color.js';
import { toLab } from './image.js';
import { keysForStage, MAP_KEYS, STAGE_ORDER, toWorkPx } from './params.js';
import { renderMosaic } from './render.js';
import { mulberry32 } from './rng.js';
import { resampleLabels } from './seglines.js';
import { tessellate } from './tessellate.js';
import { zonesDetailMask } from './zones.js';

// Runs the four stages, reusing cached results whose inputs did not change.
// `onStage(name, result)` fires after each stage; `isStale()` lets the caller
// abandon a run when newer parameters arrive (checked between stages).
// { cpuRender: false } stops after the colour stage, for when the GPU draws
// the mosaic. { cpuLong } is the long side the render stage draws at (the
// screen, when there is no GPU); without it the stage draws at outLong.
// A few results by key, the least recently used one leaving first.
function lru(limit) {
  const m = new Map();
  return {
    get(key) {
      if (!m.has(key)) return undefined;
      const v = m.get(key);
      m.delete(key);
      m.set(key, v);
      return v;
    },
    set(key, v) {
      m.delete(key);
      m.set(key, v);
      while (m.size > limit) m.delete(m.keys().next().value);
    },
    clear: () => m.clear(),
  };
}

// Results kept per stage. The maps are the biggest; the render stage holds
// a full-size canvas.
const LIMITS = { analysis: 2, tessellation: 4, color: 4, render: 1 };

export function createPipeline() {
  let full = null, imgVersion = 0, zones = null, zonesVersion = 0, guides = null, guidesVersion = 0;
  let segments = null, segmentsVersion = 0;
  const cache = Object.fromEntries(Object.entries(LIMITS).map(([stage, n]) => [stage, lru(n)]));
  const last = {};
  const mapsCache = lru(2);
  let segLabels = null;

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
      // Nothing cached can match the new photo, so free it now.
      for (const c of Object.values(cache)) c.clear();
      mapsCache.clear();
      segLabels = null;
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
        let value = cache[stage].get(key);
        const hit = value !== undefined;
        if (!hit) {
          await yieldFn();
          if (isStale()) throw new StaleRun();
          onStart(stage);
          const t0 = performance.now();
          value = fn();
          // The maps inside the analysis stage are timed on their own.
          timings[stage] = performance.now() - t0 - (stage === 'analysis' ? timings.maps ?? 0 : 0);
          cache[stage].set(key, value);
        }
        last[stage] = value;
        onStage(stage, value, !hit);
        return value;
      };
      const maps = () => {
        const key = JSON.stringify([imgVersion, zonesVersion, MAP_KEYS.map((k) => params[k])]);
        let value = mapsCache.get(key);
        if (!value) {
          const t0 = performance.now();
          value = analyzeMaps(img, p, zonesDetailMask(zones));
          timings.maps = performance.now() - t0;
          mapsCache.set(key, value);
        }
        return value;
      };
      // The segmentation labels at working resolution, once per size.
      const labelsAt = (w, h) => {
        if (!segments) return null;
        if (segLabels?.version !== segmentsVersion || segLabels.w !== w || segLabels.h !== h) {
          segLabels = { version: segmentsVersion, w, h, value: { w, h, labels: resampleLabels(segments, w, h) } };
        }
        return segLabels.value;
      };
      try {
        const an = await step('analysis', () => withSize(maps(), p));
        const tess = await step('tessellation', () => tessellate(img, lab, an, p, mulberry32(p.seed), guides, labelsAt(an.w, an.h), zones));
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
    cached: (stage) => last[stage] ?? null,
  };
}

export class StaleRun extends Error {}
