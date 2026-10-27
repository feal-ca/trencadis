// Computes the segments of each sample photo with the model (on WASM) and
// writes them as public/samples/<name>.seg.png, the labels PNGs that the
// samples load instead of running the model (src/seg/labelsPng.js). Takes
// minutes the first time, with the model downloading.
// Usage: CHROMIUM=... node scripts/sample-segments.mjs
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const names = ['vermeer', 'vangogh', 'barcas'];
const server = await createServer({
  // Cross-origin isolation, so WASM can use threads.
  server: { port: 5194, strictPort: true, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', (e) => console.log('[error]', e.message));
  await page.goto('http://localhost:5194/?debug&samDevice=wasm');
  for (const name of names) {
    const t = Date.now();
    // Uploaded as a file, so the sample's own preset is not used.
    await page.locator('input[type=file]').setInputFiles(`public/samples/${name}.webp`);
    await page.waitForFunction((n) => window.__trencadis.photoName === n, name, { timeout: 60000 });
    // The new photo's own pass: the objects of the previous photo are gone
    // once its segments are cleared.
    await page.waitForFunction(() => !window.__trencadis.segments && ['download', 'encode', 'ask'].includes(window.__trencadis.seg.phase), null, { timeout: 60000 });
    if (await page.evaluate(() => window.__trencadis.seg.phase === 'ask')) await page.evaluate(() => window.__trencadis.segAccept());
    await page.waitForFunction(() => ['done', 'error'].includes(window.__trencadis.seg.phase), null, { timeout: 1800000 });
    if (await page.evaluate(() => window.__trencadis.seg.phase === 'error')) throw new Error(`segmentation of ${name} failed`);
    const png = await page.evaluate(async () => {
      const { encodeLabels } = await import('/src/seg/labelsPng.js');
      const { w, h, labels } = window.__trencadis.segments;
      const cv = new OffscreenCanvas(w, h);
      cv.getContext('2d').putImageData(new ImageData(encodeLabels({ w, h, labels }), w, h), 0, 0);
      const blob = await cv.convertToBlob({ type: 'image/png' });
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    writeFileSync(`public/samples/${name}.seg.png`, Buffer.from(png));
    const count = await page.evaluate(() => window.__trencadis.segments.count);
    console.log(`${name}: ${count} objects, ${png.length} bytes, ${((Date.now() - t) / 1000).toFixed(0)} s`);
    if (png.length >= 40000) failed = true;
  }
} finally {
  await browser.close();
  await server.close();
}
if (failed) { console.error('FAIL: a PNG is 40 KB or more'); process.exit(1); }
