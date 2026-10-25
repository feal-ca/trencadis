// Smoke test of the built site in headless Chromium: it loads, a method can be
// switched, a photo uploaded and the mosaic downloaded, with no page errors.
// Usage: npm run build && node scripts/smoke.mjs
//   CHROMIUM=/path/to/chromium to use a system browser; otherwise Playwright's
//   own (npx playwright-core install chromium).
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
    await page.goto('http://localhost:5191/');
    await ready();
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
    // Toggle it off again so the next steps see the mosaic.
    await button.click();
    await page.waitForSelector('.viewer:not(.tool-shape)');
    await ready();
  });
  await step('upload', async () => {
    await page.locator('input[type=file]').setInputFiles('public/samples/barcas.webp');
    await page.waitForTimeout(300);
    await ready();
  });
  await step('download', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.download').click()]);
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
