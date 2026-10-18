// Per-stage timings for every algorithm on a synthetic 800x947 image.
// Usage: node scripts/bench.mjs
import { createPipeline } from '../src/core/pipeline.js';
import { ALGORITHMS, DEFAULTS } from '../src/core/params.js';
import { syntheticImage } from '../test/helpers.js';

const img = syntheticImage(800, 947);
for (const { value } of ALGORITHMS) {
  const pipe = createPipeline();
  pipe.setImage(img);
  const r = await pipe.run({ ...DEFAULTS, algorithm: value }, () => {});
  const t = Object.entries(r.timings).map(([k, v]) => `${k} ${v.toFixed(0)}`).join('  ');
  console.log(`${value.padEnd(14)} ${String(r.shards).padStart(5)} trozos  ${t}`);
}
