// Runs the app with ?lab&samDevice=wasm on a photo and checks that the
// segmentation worker reports download/decode progress and finds objects.
// Usage: CHROMIUM=... node scripts/seg-shot.mjs <photo> [out.png]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const [photo = 'public/samples/vermeer.webp', out] = process.argv.slice(2);
const server = await createServer({
  // Cross-origin isolation, so WASM can use threads.
  server: { port: 5193, strictPort: true, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const phases = { download: 0, encode: 0, decode: 0 };
let last = {};
page.on('console', (m) => {
  const t = m.text();
  const p = /^\[seg\] (\w+) (\S+) (\S+)/.exec(t);
  if (p) {
    phases[p[1]]++;
    // Print the first line of each phase, and every decode batch.
    if (p[1] !== 'download' || !phases.download || last.download !== p[1]) console.log('progress', p[1], p[2], p[3]);
    last.download = p[1];
  } else if (t.startsWith('[sam]')) console.log(t);
});
page.on('pageerror', (e) => console.log('[error]', e.message));
const t0 = Date.now();
let ok = false;
try {
  await page.goto('http://localhost:5193/?lab&samDevice=wasm');
  await page.locator('input[type=file]').setInputFiles(photo);
  // The status line lives in the collapsed "Trozos" section.
  await page.locator('.section-title b', { hasText: /^Trozos$/ }).click();
  await page.waitForFunction(() => /\d+ objetos en|Error al buscar/.test(document.body.innerText), null, { timeout: 900000 });
  const text = await page.evaluate(() => document.body.innerText);
  const m = /(\d+) objetos en ([\d.]+) s/.exec(text);
  const n = m ? +m[1] : 0;
  console.log(`segments ${n}`, m ? `(${m[2]} s in worker, ${((Date.now() - t0) / 1000).toFixed(1)} s total)` : text.match(/Error al buscar.*/)?.[0]);
  console.log('phase messages', JSON.stringify(phases));
  if (out) await page.screenshot({ path: out });
  ok = n > 0 && phases.decode > 0;
} finally {
  await browser.close();
  await server.close();
}
if (!ok) { console.error('FAIL: need at least one decode progress message and segments with count > 0'); process.exit(1); }
