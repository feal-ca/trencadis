// Regenerates public/styles/*.jpg from the Vermeer sample.
// Usage: CHROMIUM=/path/to/chromium node scripts/thumbs.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error(e.message));
await page.goto('http://localhost:5198/test/browser/thumbs.html');
await page.waitForFunction(() => document.title === 'done', null, { timeout: 120000 });
const result = await page.evaluate(() => window.result);
mkdirSync('public/styles', { recursive: true });
for (const [name, url] of Object.entries(result)) {
  writeFileSync(`public/styles/${name}.jpg`, Buffer.from(url.split(',')[1], 'base64'));
  console.log('public/styles/' + name + '.jpg');
}
await browser.close();
await server.close();
