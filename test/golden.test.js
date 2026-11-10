import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPipeline } from '../src/core/pipeline.js';
import { ALGORITHMS, DEFAULTS } from '../src/core/params.js';
import { applyMacroDefaults } from '../src/core/macros.js';
import { syntheticImage } from './helpers.js';

// Reference hashes of the mosaic geometry, one per method. A
// refactor that changes any piece, or its order, changes a hash. Run
// `npm run golden:update` only when a change of geometry is intended.
const GOLDEN = new URL('./golden.json', import.meta.url);
const updating = !!process.env.UPDATE_GOLDEN;
const golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
const written = {};

afterAll(() => {
  if (updating) writeFileSync(GOLDEN, JSON.stringify(written, null, 2) + '\n');
});

// FNV-1a over the pieces in order, vertices rounded to hundredths. Any
// change to a piece, or to the order, changes it.
function geometryHash(shards) {
  let text = '';
  for (const s of shards) {
    text += s.poly.map(([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`).join(';');
    text += '\n';
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

async function tessellation(algorithm) {
  const pipe = createPipeline();
  pipe.setImage(syntheticImage(240, 160));
  let shards = null;
  const params = { ...applyMacroDefaults(DEFAULTS), algorithm, seed: 7 };
  await pipe.run(params, (name, value) => { if (name === 'tessellation') shards = value.shards; }, undefined, undefined, undefined, { cpuRender: false });
  return shards;
}

describe('geometry reference hashes', () => {
  it.each(ALGORITHMS.map((a) => a.value))('%s', async (algorithm) => {
    const hash = geometryHash(await tessellation(algorithm));
    if (updating) written[algorithm] = hash;
    else expect(hash).toBe(golden[algorithm]);
  });
});
