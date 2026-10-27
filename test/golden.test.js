import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPipeline } from '../src/core/pipeline.js';
import { ALGORITHMS, DEFAULTS } from '../src/core/params.js';
import { applyMacroDefaults } from '../src/core/macros.js';
import { syntheticImage } from './helpers.js';

// Reference hashes of the mosaic geometry, one per method and scenario. A
// refactor that changes any piece, or its order, changes a hash. Run
// `npm run golden:update` only when a change of geometry is intended.
const GOLDEN = new URL('./golden.json', import.meta.url);
const updating = !!process.env.UPDATE_GOLDEN;
const golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
const written = {};

afterAll(() => {
  if (updating) writeFileSync(GOLDEN, JSON.stringify(written, null, 2) + '\n');
});

// FNV-1a over the pieces in order: vertices rounded to hundredths, then the
// row and intent flags. Any change to a piece, or to the order, changes it.
function geometryHash(shards) {
  let text = '';
  for (const s of shards) {
    text += s.poly.map(([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`).join(';');
    text += `|${+!!s.row}${+!!s.intent}\n`;
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// A disc-shaped object on a 60 x 40 label grid, as in seglines.test.js.
function discSegments() {
  const w = 60, h = 40, labels = new Int32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) labels[y * w + x] = Math.hypot(x - 30, y - 20) < 12 ? 1 : 0;
  return { w, h, labels };
}

// The disc as a touched shape: its region is the disc cropped to its box, and
// its parts are the left and right halves on a 64 x 64 grid over that box.
function discZone() {
  const seg = discSegments();
  const { w, h, labels } = seg;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!labels[y * w + x]) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const rw = x1 - x0 + 1, rh = y1 - y0 + 1;
  const data = new Uint8Array(rw * rh);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) data[y * rw + x] = labels[(y0 + y) * w + x0 + x];
  const box = [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h];
  const parts = new Int32Array(64 * 64).fill(-1);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const rx = Math.floor(((x + 0.5) / 64) * rw), ry = Math.floor(((y + 0.5) / 64) * rh);
    if (!data[ry * rw + rx]) continue;
    const u = box[0] + ((x + 0.5) / 64) * (box[2] - box[0]);
    parts[y * 64 + x] = u < 0.5 ? 0 : 1;
  }
  return { id: 'z1', mode: 'more', region: { box, w: rw, h: rh, data }, parts: { box, w: 64, h: 64, labels: parts, count: 2 } };
}

// The scenarios: plain, with a hand-drawn row, and with segments and a zone.
const SCENARIOS = {
  '': () => {},
  '+rows': (pipe) => pipe.setGuides([{ points: [[0.1, 0.5], [0.9, 0.5]], mode: 'points', snap: false }]),
  '+seg': (pipe) => {
    pipe.setSegments(discSegments());
    pipe.setZones([discZone()]);
  },
};

async function tessellation(algorithm, setup) {
  const pipe = createPipeline();
  pipe.setImage(syntheticImage(240, 160));
  setup(pipe);
  let shards = null;
  const params = { ...applyMacroDefaults(DEFAULTS), algorithm, seed: 7 };
  await pipe.run(params, (name, value) => { if (name === 'tessellation') shards = value.shards; }, undefined, undefined, undefined, { cpuRender: false });
  return shards;
}

describe('geometry reference hashes', () => {
  const cases = ALGORITHMS.flatMap(({ value }) => Object.entries(SCENARIOS).map(([suffix, setup]) => [value + suffix, value, setup]));

  it.each(cases)('%s', async (key, algorithm, setup) => {
    const hash = geometryHash(await tessellation(algorithm, setup));
    if (updating) written[key] = hash;
    else expect(hash).toBe(golden[key]);
  });
});
