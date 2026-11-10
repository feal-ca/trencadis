import { applyPalette, shardColors } from './color.js';
import { keysForStage, STAGE_ORDER, toWorkPx } from './params.js';
import { renderMosaic } from './render.js';
import { mulberry32 } from './rng.js';
import { tessellate } from './tessellate.js';

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

// Results kept per stage; the render stage holds a full-size canvas.
const LIMITS = { analysis: 1, tessellation: 4, color: 4, render: 1 };

// Runs the stages, reusing cached results whose inputs did not change. The
// first one only hands the photo on (its structure is found, and kept, by the
// tessellation). `onStage(name, result)` fires after each stage; `isStale()`
// lets the caller abandon a run when newer parameters arrive (checked between
// stages). { cpuRender: false } stops after the colour stage, for when the GPU
// draws the mosaic. { cpuLong } is the long side the render stage draws at
// (the screen, when there is no GPU); without it the stage draws at outLong.
export function createPipeline() {
  let img = null, imgVersion = 0;
  const cache = Object.fromEntries(Object.entries(LIMITS).map(([stage, n]) => [stage, lru(n)]));
  const last = {};

  const stageKey = (stage, p, long) => {
    const upto = STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(stage) + 1);
    return JSON.stringify([imgVersion, upto.flatMap((s) => keysForStage(s).map((k) => p[k])), long]);
  };

  return {
    setImage(next) {
      img = next;
      imgVersion++;
      // Nothing cached can match the new photo, so free it now.
      for (const c of Object.values(cache)) c.clear();
    },
    hasImage: () => !!img,
    async run(params, onStage, isStale = () => false, yieldFn = async () => {}, onStart = () => {}, opts = {}) {
      if (!img) return null;
      // Cache keys use the settings as given; the stages get pixel lengths
      // scaled to the working resolution.
      const p = toWorkPx(params);
      const timings = {};
      const long = opts.cpuLong ?? params.outLong;
      const step = async (stage, fn) => {
        // Only the render stage depends on the size it is drawn at.
        const key = stageKey(stage, params, stage === 'render' ? long : null);
        let value = cache[stage].get(key);
        const hit = value !== undefined;
        if (!hit) {
          await yieldFn();
          if (isStale()) throw new StaleRun();
          onStart(stage);
          const t0 = performance.now();
          value = fn();
          timings[stage] = performance.now() - t0;
          cache[stage].set(key, value);
        }
        last[stage] = value;
        onStage(stage, value, !hit);
        return value;
      };
      try {
        await step('analysis', () => ({ w: img.w, h: img.h }));
        const tess = await step('tessellation', () => tessellate(img, p, mulberry32(p.seed)));
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
      return img;
    },
    // Latest result of a stage, for drawing views on demand.
    cached: (stage) => last[stage] ?? null,
  };
}

export class StaleRun extends Error {}
