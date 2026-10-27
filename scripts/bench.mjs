// Per-stage timings for every algorithm on a synthetic 800x947 image, then
// the timings of a piece-size change on the same pipeline.
// Usage: node scripts/bench.mjs
import { createPipeline } from '../src/core/pipeline.js';
import { applyMacro } from '../src/core/macros.js';
import { ALGORITHMS, DEFAULTS } from '../src/core/params.js';
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
