// Runs the app with ?debug&samDevice=wasm on a photo, waits for the coarse
// segmentation, then touches a shape (Vermeer's eye by default) through
// window.__trencadis, gives it more detail and saves the mosaic around it
// before and after. Exits 1 unless progress, segments, the shape and its
// parts all arrive.
// Usage: CHROMIUM=... node scripts/seg-shot.mjs [photo] [out.png] [u] [v]
// The pictures go to the system temp directory unless out.png says otherwise.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const [photo = 'public/samples/vermeer.webp', out = join(tmpdir(), 'seg-shot.png'), u = '0.345', v = '0.374'] = process.argv.slice(2);
const server = await createServer({
  // Cross-origin isolation, so WASM can use threads.
  server: { port: 5193, strictPort: true, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.text().startsWith('[sam]')) console.log(m.text()); });
page.on('pageerror', (e) => console.log('[error]', e.message));
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
let ok = false;
try {
  await page.goto('http://localhost:5193/?debug&samDevice=wasm');
  // The sample comes with its shapes; uploading the photo starts afresh.
  await page.waitForFunction(() => window.__trencadis?.mosaicReady, null, { timeout: 120000 });
  await page.evaluate(() => { window.__segStates = []; });
  await page.locator('input[type=file]').setInputFiles(photo);
  await page.waitForFunction(() => window.__segStates.some((s) => ['ask', 'download'].includes(s.phase)) && window.__trencadis.mosaicReady, null, { timeout: 120000 });
  if (await page.evaluate(() => window.__segStates.at(-1).phase === 'ask')) {
    console.log('policy asks; accepting');
    await page.evaluate(() => window.__trencadis.segAccept());
  }
  await page.waitForFunction(() => ['done', 'error'].includes(window.__segStates.at(-1).phase), null, { timeout: 900000 });
  // Every state of the session, as the engine reports it (not as it was drawn).
  const log = await page.evaluate(() => window.__segStates);
  const end = log.at(-1);
  const counts = {};
  for (const s of log) counts[s.phase] = (counts[s.phase] ?? 0) + 1;
  console.log(`seg ${end.phase} at ${secs()}:`, JSON.stringify(end), 'states per phase', JSON.stringify(counts));
  const lastDecode = log.filter((s) => s.phase === 'decode').at(-1);
  if (lastDecode) console.log('last decode progress', lastDecode.done, '/', lastDecode.total);
  const lastDownload = log.filter((s) => s.phase === 'download').at(-1);
  if (lastDownload) console.log('last download progress', lastDownload.done, '/', lastDownload.total);
  await page.waitForFunction(() => !window.__trencadis.busy, null, { timeout: 120000 });

  // The viewer's mosaic around the touched point.
  // The canvas is drawn with object-fit: contain, so the image sits inside it.
  const clip = async () => {
    const r = await page.evaluate(() => {
      const cv = document.querySelector('.viewer-host canvas, .viewer-canvas');
      const b = cv.getBoundingClientRect();
      const s = Math.min(b.width / cv.width, b.height / cv.height);
      return { x: b.left + (b.width - cv.width * s) / 2, y: b.top + (b.height - cv.height * s) / 2, width: cv.width * s, height: cv.height * s };
    });
    const size = 160;
    return { x: Math.max(0, r.x + r.width * +u - size / 2), y: Math.max(0, r.y + r.height * +v - size / 2), width: size, height: size };
  };
  await page.waitForTimeout(500);
  const before = out.replace(/\.png$/, '-before.png');
  await page.screenshot({ path: before, clip: await clip() });
  const piecesBefore = await page.evaluate(() => window.__trencadis.estimate);

  const runs = await page.evaluate(() => window.__runs?.length ?? 0);
  const id = await page.evaluate(([a, b]) => window.__trencadis.pickShape(a, b), [+u, +v]);
  const zone = await page.evaluate(() => window.__trencadis.zones[0] && { id: window.__trencadis.zones[0].id, box: window.__trencadis.zones[0].region?.box });
  console.log(`shape ${id} at ${secs()}`, JSON.stringify(zone));
  if (!id || id.error) throw new Error(`no shape${id?.error ? `: ${id.error}` : ''}`);
  await page.evaluate((z) => window.__trencadis.setZoneMode(z, 'more'), id);
  await page.waitForFunction(() => window.__trencadis.zones[0]?.parts, null, { timeout: 600000 });
  const parts = await page.evaluate(() => { const p = window.__trencadis.zones[0].parts; return { box: p.box, w: p.w, h: p.h, count: p.count }; });
  console.log(`parts at ${secs()}`, JSON.stringify(parts));
  await page.waitForFunction((n) => (window.__runs?.length ?? 0) > n && !window.__trencadis.busy, runs, { timeout: 120000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: out, clip: await clip() });
  console.log('pieces in the whole mosaic', piecesBefore, '->', await page.evaluate(() => window.__trencadis.estimate));
  await page.screenshot({ path: out.replace(/\.png$/, '-full.png') });
  // The segmentation timings that ?debug collects next to the pipeline runs.
  for (const e of await page.evaluate(() => (window.__runs ?? []).filter((r) => r.seg))) console.log('[timing]', JSON.stringify(e));
  console.log(`saved ${before}, ${out} at ${secs()}`);
  ok = end.phase === 'done' && !!lastDecode && lastDecode.done === lastDecode.total && parts.count > 0;
} finally {
  await browser.close();
  await server.close();
}
if (!ok) { console.error('FAIL: need decode progress reaching its total, segments, a shape and its parts'); process.exit(1); }
