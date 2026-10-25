// LAB SPIKE: paints important areas on a sample with ?lab and screenshots the
// side-by-side comparison. Usage: npm run build && node scripts/lab-shot.mjs <out-dir> [sample] [u,v,...]
import { chromium } from 'playwright-core';
import { preview } from 'vite';

// mode 'all' ticks "Toda la imagen" instead of painting; the spots are then only close-ups.
const [out = '.', sample = 'vermeer', spots = '0.343,0.371,0.463,0.393,0.625,0.541', mode = 'mark'] = process.argv.slice(2);
const pts = spots.split(',').map(Number);
const server = await preview({
  // Cross-origin isolation, so the model's WASM can use threads.
  preview: { port: 5192, strictPort: true, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  logLevel: 'error',
})
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (m.text().startsWith('DBG')) console.log(m.text()); });
const ready = () => page.waitForFunction(() => !document.querySelector('.is-busy') && !document.querySelector('.busy-mark'), null, { timeout: 120000 });
try {
  await page.goto(`http://localhost:5192/?lab${mode === 'seg' ? '&samDevice=wasm' : ''}`);
  await ready();
  if (sample.includes('/')) {
    await page.locator('input[type=file]').setInputFiles(sample);
    await page.waitForTimeout(500);
    await ready();
  } else if (sample !== 'vermeer') {
    await page.locator('.samples button', { hasText: sample }).click();
    await page.waitForTimeout(500);
    await ready();
  }
  await page.locator('.section-title b', { hasText: /^Trozos$/ }).click();
  if (mode === 'seg') {
    // Objects from the segmentation model: wait for them, then the mosaic
    // with and without their hileras.
    await page.waitForFunction(() => /objetos en|Error/.test(document.body.innerText), null, { timeout: 600000 });
    console.log('seg:', await page.locator('.lab-block .help').first().textContent());
    await page.waitForTimeout(500);
    await ready();
    await page.waitForTimeout(1500);
    await page.locator('.viewer').screenshot({ path: `${out}/seg-on.png` });
    await page.locator('#p-segCuts').uncheck();
    await page.waitForTimeout(500);
    await ready();
    await page.waitForTimeout(1500);
    await page.locator('.viewer').screenshot({ path: `${out}/seg-nocuts.png` });
    await page.locator('#p-segGuides').uncheck();
    await page.waitForTimeout(500);
    await ready();
    await page.waitForTimeout(1500);
    await page.locator('.viewer').screenshot({ path: `${out}/seg-off.png` });
  } else {
  if (mode === 'all') {
    await page.locator('#p-intentAll').check();
  } else {
    await page.locator('button', { hasText: 'Marcar importante' }).click();
    const cv = page.locator('.brush-canvas');
    await cv.waitFor();
    await page.waitForTimeout(800);
    for (let i = 0; i < pts.length; i += 2) {
      // Measured per stroke: the layout can still move after the brush turns on.
      const box = await cv.boundingBox();
      const { w, h } = await cv.evaluate((c) => ({ w: c.width, h: c.height }));
      const s = Math.min(box.width / w, box.height / h);
      const ox = box.x + (box.width - w * s) / 2, oy = box.y + (box.height - h * s) / 2;
      const x = ox + pts[i] * w * s, y = oy + pts[i + 1] * h * s;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let k = 0; k < 12; k++) await page.mouse.move(x + 3 * Math.cos(k), y + 3 * Math.sin(k));
      await page.mouse.up();
      await page.waitForTimeout(200);
    }
    await page.screenshot({ path: `${out}/lab-mask.png` });
    await page.locator('button', { hasText: 'Marcar importante' }).click();
  }
  await page.waitForTimeout(500);
  await ready();
  await page.waitForTimeout(1500);
  await page.locator('.viewer').screenshot({ path: `${out}/lab-split.png` });
  // Close-ups around each spot, before (top) and after (bottom).
  const hosts = page.locator('.lab-split .viewer-canvas');
  for (let k = 0; k < 2; k++) {
    const b = await hosts.nth(k).boundingBox();
    const { w, h } = await hosts.nth(k).evaluate((c) => ({ w: c.width, h: c.height }));
    const s = Math.min(b.width / w, b.height / h);
    const ox = b.x + (b.width - w * s) / 2, oy = b.y + (b.height - h * s) / 2;
    for (let i = 0; i < pts.length; i += 2) {
      const r = 0.07 * Math.max(w, h) * s;
      await page.screenshot({ path: `${out}/lab-zoom-${i / 2}-${k ? 'after' : 'before'}.png`, clip: { x: ox + pts[i] * w * s - r, y: oy + pts[i + 1] * h * s - r, width: 2 * r, height: 2 * r } });
    }
  }
  console.log('status:', await page.locator('.status').textContent());
  if (errors.length) console.log('page errors:', errors.join(' | '));
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
