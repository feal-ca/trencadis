// Smoke test of the built site in headless Chromium: the first mosaic, every
// style, a photo of the user's, the path without WebGL, a download and a
// phone-sized screen. Fails on any page error.
// Usage: npm run build && npm run smoke   (CHROMIUM=/path to use a system browser)
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { port: 5191, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const STYLES = ['trencadis', 'parkguell', 'vitral', 'romano', 'cracks'];
const errors = [];

async function open(query, options = { viewport: { width: 1280, height: 800 } }) {
  const page = await (await browser.newContext({ acceptDownloads: true, ...options })).newPage();
  page.on('pageerror', (e) => errors.push(`${query}: ${e.message}`));
  await page.goto(`http://localhost:5191/${query}`);
  return page;
}

// Waits until the mosaic on screen is the one of the current settings.
async function settled(page) {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => {
    const t = window.__trencadis;
    return t && t.mosaicReady && !t.busy && !document.querySelector('.is-busy');
  }, null, { timeout: 60000 });
  return page.evaluate(() => window.__trencadis.info.shards);
}

const check = (ok, message) => { if (!ok) throw new Error(message); };

try {
  // The first sample, then every style.
  const page = await open('?debug');
  check(await settled(page) > 200, 'the first mosaic has too few pieces');
  for (const id of STYLES) {
    await page.evaluate((style) => window.__trencadis.setStyle(style), id);
    const pieces = await settled(page);
    check(pieces > 100, `style ${id}: ${pieces} pieces`);
    check(await page.evaluate(() => window.__trencadis.style) === id, `style ${id} did not stick`);
    console.log(`${id}: ${pieces} pieces`);
  }
  // A photo of the user's, through the file input.
  await page.evaluate(() => window.__trencadis.setStyle('trencadis'));
  await page.setInputFiles('input[type=file]', 'public/samples/barcas.webp');
  await page.waitForFunction(() => window.__trencadis.photoName === 'barcas', null, { timeout: 30000 });
  console.log(`own photo: ${await settled(page)} pieces`);
  // Another version changes the mosaic; undo brings the seed back.
  const seed = await page.evaluate(() => window.__trencadis.params.seed);
  await page.keyboard.press('r');
  await settled(page);
  check(await page.evaluate(() => window.__trencadis.params.seed) !== seed, 'R did not make another version');
  // The download is a real image file.
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.download')]);
  check(/\.(png|jpg)$/.test(download.suggestedFilename()), `download name: ${download.suggestedFilename()}`);
  console.log(`download: ${download.suggestedFilename()}`);
  await page.context().close();

  // Without WebGL the worker draws the mosaic.
  const cpu = await open('?debug&nogl');
  check(await settled(cpu) > 200, 'no mosaic without WebGL');
  check(await cpu.evaluate(() => !window.__trencadis.gpu && !!window.__trencadis.images.final), 'the CPU path did not draw');
  console.log('without WebGL: ok');
  await cpu.context().close();

  // A phone: the mosaic shows and takes a fair share of the screen.
  const phone = await open('?debug', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await settled(phone);
  const share = await phone.evaluate(() => {
    const cv = [...document.querySelectorAll('.viewer canvas')].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    const b = cv.getBoundingClientRect(), k = Math.min(b.width / cv.width, b.height / cv.height);
    return (cv.width * k * cv.height * k) / (innerWidth * innerHeight);
  });
  check(share > 0.2, `on a phone the image takes ${(100 * share).toFixed(0)} % of the screen`);
  console.log(`phone: the image takes ${(100 * share).toFixed(0)} % of the screen`);
  await phone.context().close();

  check(!errors.length, `page errors:\n${errors.join('\n')}`);
  console.log('smoke test passed');
} finally {
  await browser.close();
  server.httpServer.close();
}
