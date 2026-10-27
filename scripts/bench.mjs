// Per-stage timings for every algorithm on a synthetic 800x947 image, then
// the timings of a piece-size change on the same pipeline.
// Usage: node scripts/bench.mjs
import { downscale } from '../src/core/image.js';
import { createPipeline } from '../src/core/pipeline.js';
import { applyMacro } from '../src/core/macros.js';
import { ALGORITHMS, DEFAULTS, DRAFT_LONG } from '../src/core/params.js';
import { syntheticImage } from '../test/helpers.js';

const img = syntheticImage(800, 947);
const fmt = (timings) => Object.entries(timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join('  ');
for (const { value } of ALGORITHMS) {
  const pipe = createPipeline();
  pipe.setImage(img);
  // The mosaic itself is drawn on the GPU; the CPU render is only a fallback.
  const run = (p) => pipe.run(p, () => {}, undefined, undefined, undefined, { cpuRender: false });
  const p = { ...DEFAULTS, algorithm: value };
  const r = await run(p);
  console.log(`${value.padEnd(14)} ${String(r.shards).padStart(5)} trozos  ${fmt(r.timings)}`);
  // A change of piece size reuses the maps.
  const s = await run(applyMacro(p, 'size', 0.55));
  console.log(`${''.padEnd(14)} ${String(s.shards).padStart(5)} trozos  ${fmt(s.timings)}  (tamaño 0.55)`);
}

// A full run on the draft image against the same run at 800 px, per method:
// the draft shown while dragging should cost at most 40 % of it.
const total = (r) => Object.values(r.timings).reduce((a, b) => a + b, 0);
const timeRun = async (image, algorithm, workLong) => {
  const pipe = createPipeline();
  pipe.setImage(image);
  const r = await pipe.run({ ...DEFAULTS, algorithm, workLong }, () => {}, undefined, undefined, undefined, { cpuRender: false });
  return total(r);
};
const small = downscale(img, DRAFT_LONG);
console.log('\nBorrador (400 px) frente a completo (800 px):');
for (const { value } of ALGORITHMS) {
  await timeRun(img, value, 800); // warm-up
  const full = await timeRun(img, value, 800);
  const draft = await timeRun(small, value, DRAFT_LONG);
  console.log(`${value.padEnd(14)} borrador ${draft.toFixed(0).padStart(5)} ms  completo ${full.toFixed(0).padStart(5)} ms  (${((100 * draft) / full).toFixed(0)} %)`);
}
