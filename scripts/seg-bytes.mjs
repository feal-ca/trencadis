// Measures what the first segmentation downloads: serves the production build
// (vite preview), uploads a photo with ?samDevice=wasm and then =webgpu in
// fresh browser contexts, waits for the segmentation to end or fail, and
// adds up the response bodies of the requests to Hugging Face and jsDelivr. The larger
// total is behind SEG_DOWNLOAD_MB (src/ui/segStatusText.js).
// Usage: npm run build && CHROMIUM=... node scripts/seg-bytes.mjs
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { port: 5195, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'] });
const HOSTS = /(^|\.)(hf\.co|huggingface\.co|jsdelivr\.net)$/;
const MB = (n) => (n / 1e6).toFixed(1);
const totals = {};
try {
  for (const device of ['wasm', 'webgpu']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    // The context sees the requests of the workers too.
    const sizes = [];
    context.on('requestfinished', async (r) => {
      if (!HOSTS.test(new URL(r.url()).hostname)) return;
      sizes.push({ url: r.url(), bytes: (await r.sizes()).responseBodySize });
    });
    page.on('pageerror', (e) => console.log(`[${device} error]`, e.message));
    const t = Date.now();
    await page.goto(`http://localhost:5195/?debug&samDevice=${device}`);
    // The first sample comes with its shapes (done); the uploaded photo starts afresh.
    await page.waitForFunction(() => window.__trencadis?.mosaicReady, null, { timeout: 120000 });
    await page.evaluate(() => { window.__segStates = []; });
    await page.locator('input[type=file]').setInputFiles('public/samples/barcas.webp');
    await page.waitForFunction(() => window.__segStates.some((s) => ['ask', 'download'].includes(s.phase)), null, { timeout: 60000 });
    if (await page.evaluate(() => window.__segStates.at(-1).phase === 'ask')) await page.evaluate(() => window.__trencadis.segAccept());
    let end;
    try {
      await page.waitForFunction(() => ['done', 'error'].includes(window.__segStates.at(-1).phase), null, { timeout: 1200000 });
      end = await page.evaluate(() => window.__trencadis.seg);
    } catch (e) { end = { phase: `timeout (${e.message.split('\n')[0]})` }; }
    await page.waitForTimeout(500);
    // The device and dtype the worker really used (?debug keeps its timings).
    const used = await page.evaluate(() => (window.__runs ?? []).find((r) => r.seg)).catch(() => null);
    const fellBack = used && used.device !== device;
    const total = sizes.reduce((s, r) => s + r.bytes, 0);
    if (!fellBack) totals[device] = total;
    console.log(`${device}${used ? ` (ran on ${used.device} ${used.dtype})` : ''}${fellBack ? ' FELL BACK, not a ' + device + ' total' : ''}: segmentation ${end.phase}${end.message ? ` (${end.message})` : ''}${end.found != null ? `, ${end.found} found` : ''} in ${((Date.now() - t) / 1000).toFixed(0)} s; ${MB(total)} MB in ${sizes.length} requests`);
    for (const r of sizes.filter((x) => x.bytes > 100000)) console.log(`  ${MB(r.bytes)} MB ${r.url.split("?")[0]}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
if (!totals.webgpu) console.log('webgpu was not measured: add the fp16 model files (see SEG_DOWNLOAD_MB) by hand');
const max = Math.max(...Object.values(totals));
console.log(`largest measured total ${MB(max)} MB${totals.webgpu ? ` -> SEG_DOWNLOAD_MB ${Math.ceil(max / 1e6 / 5) * 5}` : ''}`);
