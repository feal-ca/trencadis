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
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

// The keys of the engine's API (window.__trencadis, on with ?debug): a refactor
// of useEngine must keep them all. A task that adds one adds it here.
const API_KEYS = ('addGuide autoGrout bitmap busy canRedo canUndo clearGuides download error estimate glCanvas gpu '
  + 'guides hasImage images info isDefault labels lines loadBlob loadSample macros mosaicReady params photoName pickShape redo '
  + 'refineShape removeZone resetAll restore seg segAccept segDecline segRetry segments setMacro setManual setParam '
  + 'setParams setStyle setViewport setWanted setZoneMode share style undo undoGuide zones').split(' ');

const ready = () => page.waitForFunction(
  () => !document.querySelector('.is-busy') && !document.querySelector('.download[disabled]'),
  null, { timeout: 120000 },
);
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
  await step('upload', async () => {
    await page.locator('input[type=file]').setInputFiles('public/samples/barcas.webp');
    await page.waitForTimeout(300);
    await ready();
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
    const seen = errors.length;
    await page.route('**/samples/vangogh.webp', (r) => r.abort());
    await page.locator('button.link', { hasText: 'Van Gogh' }).click();
    await page.waitForSelector('.status .err');
    const msg = await page.locator('.status .err').textContent();
    if (!/No se ha podido cargar el ejemplo/.test(msg)) throw new Error(`error text: ${msg}`);
    await page.unroute('**/samples/vangogh.webp');
    // The aborted request is logged by the browser; that one is expected.
    errors.splice(seen, errors.length, ...errors.slice(seen).filter((m) => !/ERR_FAILED/.test(m)));
  });
  await step('download', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.download').click()]);
    if (!dl.suggestedFilename().startsWith('trencadis-barcas-')) throw new Error(`file name: ${dl.suggestedFilename()}`);
    const size = (await (await dl.createReadStream()).toArray()).reduce((s, b) => s + b.length, 0);
    if (size < 50000) throw new Error(`download is only ${size} bytes`);
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
