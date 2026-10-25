// LAB SPIKE: runs lab/segment.html headless on a sample and saves the result.
// Usage: CHROMIUM=... node scripts/lab-segment-shot.mjs <out.png> [sample] [query]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const [out = 'segment.png', sample = 'vermeer', query = ''] = process.argv.slice(2);
const server = await createServer({
  // Cross-origin isolation, so WASM can use threads.
  server: { port: 5193, strictPort: true, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  logLevel: 'error',
});
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[error]', e.message));
try {
  await page.goto(`http://localhost:5193/lab/segment.html?src=../samples/${sample}.webp${query ? '&' + query : ''}`);
  console.log('isolated', await page.evaluate(() => crossOriginIsolated), 'threads', await page.evaluate(() => navigator.hardwareConcurrency), 'webgpu', await page.evaluate(async () => !!(await navigator.gpu?.requestAdapter())));
  await page.waitForFunction(() => window.__done, null, { timeout: 600000 });
  await page.locator('#out').screenshot({ path: out });
} finally {
  await browser.close();
  await server.close();
}
