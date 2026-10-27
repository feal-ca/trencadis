// Smoke test of the built site in headless Chromium: it loads, a method can be
// switched, a photo uploaded and the mosaic downloaded, with no page errors.
// Usage: npm run build && node scripts/smoke.mjs
//   CHROMIUM=/path/to/chromium to use a system browser; otherwise Playwright's
//   own (npx playwright-core install chromium).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { port: 5191, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  // Software WebGL, so it runs on CI machines without a GPU.
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
// This Chromium exposes navigator.gpu even without a GPU, which would make
// segmentation start by itself on an uploaded photo; hiding it gives the
// 'ask' policy of browsers without WebGPU.
await page.addInitScript(() => { delete Navigator.prototype.gpu; });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// While a request is aborted on purpose, the browser's log of that very
// request is expected; anything else is still an error.
let abortedUrl = null;
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (abortedUrl && m.location().url.endsWith(abortedUrl)) return;
  errors.push(m.text());
});

// Requests to the model's hosts (Hugging Face) and the ONNX runtime's
// (jsDelivr): the sample and a photo uploaded here, with segmentation asking
// first (no WebGPU in headless), must make none.
const modelRequests = [];
page.on('request', (r) => { if (/(^|\.)(hf\.co|huggingface\.co|jsdelivr\.net)$/.test(new URL(r.url()).hostname)) modelRequests.push(r.url()); });

// The keys of the engine's API (window.__trencadis, on with ?debug): a refactor
// of useEngine must keep them all. A task that adds one adds it here.
const API_KEYS = ('addGuide autoGrout bitmap busy canRedo canUndo clearGuides download dragEnd dragStart error estimate glCanvas gpu '
  + 'guides hasImage images info isDefault labels lines loadBlob loadSample macros mosaicReady params photoName pickShape redo '
  + 'refineShape removeZone resetAll restore seg segAccept segDecline segRetry segments setMacro setManual setParam '
  + 'setParams setStyle setViewport setWanted setZoneMode share style undo undoGuide zones').split(' ');

const idle = (pg) => pg.waitForFunction(
  () => !document.querySelector('.is-busy') && !document.querySelector('.download[disabled]'),
  null, { timeout: 120000 },
);
const ready = () => idle(page);
const status = () => page.locator('.status').textContent();
const step = async (name, fn) => {
  const t = performance.now();
  await fn();
  console.log(`ok  ${name} (${Math.round(performance.now() - t)} ms): ${await status()}`);
};

try {
  await step('load', async () => {
    await page.goto('http://localhost:5191/?debug');
    await ready();
    const keys = await page.evaluate(() => Object.keys(window.__trencadis).sort());
    if (JSON.stringify(keys) !== JSON.stringify(API_KEYS)) {
      throw new Error(`engine API changed: ${keys.join(' ')}`);
    }
    // The first sample comes with its shapes: done, without the model.
    await page.waitForFunction(() => window.__trencadis.seg.phase === 'done', null, { timeout: 30000 });
    const seg = await page.evaluate(() => window.__trencadis.seg);
    if (!seg.preset) throw new Error(`seg state of the sample: ${JSON.stringify(seg)}`);
  });
  await step('switch method', async () => {
    await page.locator('.algo', { hasText: 'Grietas' }).click();
    await page.waitForTimeout(300);
    await ready();
  });
  await step('shape tool', async () => {
    const button = page.locator('button', { hasText: 'Tocar una forma' });
    await button.click();
    await page.waitForSelector('.viewer.tool-shape');
    // The mosaic stays on screen with the tool on.
    await ready();
    const count = await status();
    if (!/trozos/.test(count)) throw new Error(`status with the shape tool on: ${count}`);
    await button.click();
    await page.waitForSelector('.viewer:not(.tool-shape)');
  });
  await step('undo a line', async () => {
    // History commits a step 500 ms after the last change, so the line is its own step.
    await page.evaluate(() => window.__trencadis.addGuide({ points: [[0.1, 0.5], [0.9, 0.5]], mode: 'points', snap: false }));
    await page.waitForFunction(() => window.__trencadis.guides.length === 1 && window.__trencadis.canUndo);
    await page.waitForTimeout(600);
    await ready();
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__trencadis.guides.length === 0, null, { timeout: 10000 });
    await ready();
  });
  await step('drag a slider', async () => {
    const before = await page.evaluate(() => window.__trencadis.info.shards);
    const runs = await page.evaluate(() => window.__runs.length);
    await page.locator('#m-size').scrollIntoViewIfNeeded();
    const box = await page.locator('#m-size').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box.x + 2 + ((box.width - 4) * i) / 10, y);
      // Longer than the debounce, so runs start while the control is held.
      await page.waitForTimeout(80);
    }
    // Held at the end until a draft has finished.
    await page.waitForFunction((n) => window.__runs.slice(n).some((r) => r.draft), runs, { timeout: 60000 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await ready();
    const after = await page.evaluate(() => window.__trencadis.info.shards);
    if (after === before) throw new Error(`piece count did not change after the drag: ${before}`);
    // A download after a release waits for the full run: asked right after the
    // release, and asked at the full tessellation, before its colours arrive.
    for (const atTessellation of [false, true]) {
      await page.evaluate(() => { window.__exports = []; });
      const runsBefore = await page.evaluate(() => window.__runs.length);
      await page.mouse.move(box.x + 2, y);
      await page.mouse.down();
      // Ends where the control was not, so the drag changes the settings.
      await page.mouse.move(box.x + box.width * (atTessellation ? 0.8 : 0.5), y);
      await page.waitForFunction((n) => window.__runs.slice(n).some((r) => r.draft), runsBefore, { timeout: 60000 });
      if (atTessellation) {
        await page.evaluate(() => {
          window.__onStage = (d) => {
            if (d.stage !== 'tessellation' || d.draft) return;
            window.__onStage = null;
            window.__trencadis.download();
          };
        });
      }
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.mouse.up().then(() => !atTessellation && page.locator('.download').click()),
      ]);
      const png = Buffer.concat(await (await dl.createReadStream()).toArray());
      const exp = await page.evaluate(() => window.__exports);
      if (exp.length !== 1 || exp[0].draft || exp[0].runs <= runsBefore + 1) throw new Error(`download did not wait for the full run (at tessellation: ${atTessellation}): ${JSON.stringify(exp)}`);
      const side = Math.max(png.readUInt32BE(16), png.readUInt32BE(20));
      if (side !== 2000) throw new Error(`download is ${side} px on its long side`);
      await ready();
    }
    // Drafts while the control was held, and the last run is the full one.
    const drafts = await page.evaluate((n) => window.__runs.slice(n).map((r) => !!r.draft), runs);
    if (!drafts.includes(true) || drafts.at(-1)) throw new Error(`runs during the drag (draft or not): ${drafts.join(' ')}`);
  });
  await step('upload', async () => {
    await page.locator('input[type=file]').setInputFiles('public/samples/barcas.webp');
    await page.waitForTimeout(300);
    await ready();
    if (modelRequests.length) throw new Error(`requests to the model before any pick: ${modelRequests.join(' ')}`);
  });
  await step('drop on the panel', async () => {
    const b64 = readFileSync('public/samples/barcas.webp').toString('base64');
    const dt = await page.evaluateHandle(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const t = new DataTransfer();
      t.items.add(new File([bytes], 'barcas.webp', { type: 'image/webp' }));
      return t;
    }, b64);
    const side = page.locator('.side');
    for (const type of ['dragenter', 'dragover', 'drop']) await side.dispatchEvent(type, { dataTransfer: dt });
    await page.waitForTimeout(300);
    await ready();
    const name = await page.evaluate(() => window.__trencadis.photoName);
    if (name !== 'barcas') throw new Error(`photoName after the drop: ${name}`);
  });
  await step('sample offline', async () => {
    abortedUrl = '/samples/vangogh.webp';
    await page.route('**/samples/vangogh.webp', (r) => r.abort());
    await page.locator('button.link', { hasText: 'Van Gogh' }).click();
    await page.waitForSelector('.status .err');
    const msg = await page.locator('.status .err').textContent();
    if (!/No se ha podido cargar el ejemplo/.test(msg)) throw new Error(`error text: ${msg}`);
    // Let the browser's console event for the aborted request arrive while it is still ignored.
    await page.waitForTimeout(300);
    abortedUrl = null;
    await page.unroute('**/samples/vangogh.webp');
  });
  await step('download', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.download').click()]);
    if (!dl.suggestedFilename().startsWith('trencadis-barcas-')) throw new Error(`file name: ${dl.suggestedFilename()}`);
    const size = (await (await dl.createReadStream()).toArray()).reduce((s, b) => s + b.length, 0);
    if (size < 50000) throw new Error(`download is only ${size} bytes`);
  });
  await step('webgl lost', async () => {
    // The status bar overlays the bottom of the canvas, so it is left out.
    const shot = async () => {
      const box = await page.locator('.viewer-host canvas').boundingBox();
      return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height - 100 } });
    };
    // Shots until two in a row agree, so a redraw still under way is not compared.
    const settled = async () => {
      let prev = await shot();
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(250);
        const next = await shot();
        if (next.equals(prev)) return next;
        prev = next;
      }
      throw new Error('the canvas never settled');
    };
    const gpu = (on) => page.waitForFunction((v) => window.__trencadis.gpu === v, on, { timeout: 30000 });
    await page.evaluate(() => {
      const gl = document.querySelector('.viewer-host canvas').getContext('webgl2');
      window.__lose = gl.getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await gpu(false);
    await ready();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('.download').click()]);
    const size = (await (await dl.createReadStream()).toArray()).reduce((s, b) => s + b.length, 0);
    if (size < 50000) throw new Error(`download after losing the context is only ${size} bytes`);
    // Change the tessellation while on the CPU; the GPU must show it after the restore.
    const runs = await page.evaluate(() => window.__runs.length);
    const before = await page.evaluate(() => window.__trencadis.params.algorithm);
    const [toName, toKey, fromName, fromKey] = before === 'fracture'
      ? ['Grietas', 'cracks', 'Cortes rectos', 'fracture']
      : ['Cortes rectos', 'fracture', 'Grietas', 'cracks'];
    await page.locator('.algo', { hasText: toName }).click();
    await page.waitForFunction((n) => window.__runs.length > n, runs, { timeout: 60000 });
    await ready();
    await page.evaluate(() => window.__lose.restoreContext());
    await gpu(true);
    await page.waitForSelector('.viewer-host canvas');
    await ready();
    const count = await status();
    if (!/trozos/.test(count)) throw new Error(`status after restoring the context: ${count}`);
    const after = await settled();
    // A blank canvas compresses to a few hundred bytes.
    if (after.length < 5000) throw new Error(`restored canvas looks blank (${after.length} bytes)`);
    // The same method drawn again with the GPU up is the reference.
    const pick = async (name, algorithm) => {
      await page.locator('.algo', { hasText: name }).click();
      await page.waitForFunction((a) => window.__trencadis.params.algorithm === a, algorithm);
      await page.waitForTimeout(300);
      await ready();
    };
    await pick(fromName, fromKey);
    await pick(toName, toKey);
    if (!after.equals(await settled())) throw new Error('restored canvas does not show the mosaic made while on the CPU');
  });
  await step('no webgl', async () => {
    // Its own page, so the main one keeps its state.
    const nogl = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    nogl.on('pageerror', (e) => errors.push(e.message));
    nogl.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await nogl.goto('http://localhost:5191/?debug&nogl');
      await idle(nogl);
      const gpu = await nogl.evaluate(() => window.__trencadis.gpu);
      if (gpu) throw new Error('?nogl still created a renderer');
      // The mosaic on screen is drawn at screen size, not at the download size.
      const sizes = await nogl.evaluate(() => [...document.querySelectorAll('canvas.viewer-canvas')]
        .map((c) => ({ c, r: c.getBoundingClientRect() }))
        .filter(({ c, r }) => r.width > 0 && r.height > 0 && getComputedStyle(c).visibility !== 'hidden' && !/seg-outline|shape-canvas|brush-canvas/.test(c.className))
        .map(({ c, r }) => ({ px: Math.max(c.width, c.height), box: Math.max(r.width, r.height) })));
      if (!sizes.length) throw new Error('no visible mosaic canvas');
      for (const { px, box } of sizes) {
        if (px > 2 * box) throw new Error(`mosaic canvas is ${px} px in a ${Math.round(box)} px box`);
      }
      const [dl] = await Promise.all([nogl.waitForEvent('download'), nogl.locator('.download').click()]);
      const size = (await (await dl.createReadStream()).toArray()).reduce((s, b) => s + b.length, 0);
      if (size < 50000) throw new Error(`download without WebGL is only ${size} bytes`);
    } finally {
      await nogl.close();
    }
  });
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  console.log('smoke test passed');
} catch (e) {
  console.error('smoke test FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.httpServer.close();
}
