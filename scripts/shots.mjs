// Screenshots of the built site for a look by eye: desktop, phone and dark mode.
// They go to <tmpdir>/trencadis-shots/. For the phone it prints how much of the
// viewport the visible image takes.
// Usage: npm run build && node scripts/shots.mjs   (CHROMIUM=/path to use a system browser)
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const out = join(tmpdir(), 'trencadis-shots');
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 5192, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

// The canvas box with object-fit: contain applied, as a share of the viewport.
const imageShare = (pg) => pg.evaluate(() => {
  const cv = [...document.querySelectorAll('canvas.viewer-canvas')]
    .filter((c) => !/seg-outline|shape-canvas|brush-canvas/.test(c.className) && c.getBoundingClientRect().width > 0)
    .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  const b = cv.getBoundingClientRect();
  const k = Math.min(b.width / cv.width, b.height / cv.height);
  return (cv.width * k * cv.height * k) / (innerWidth * innerHeight);
});

const shoot = async (name, options, file) => {
  const ctx = await browser.newContext(options);
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { delete Navigator.prototype.gpu; });
  try {
    await pg.goto('http://localhost:5192/');
    await pg.waitForFunction(() => document.querySelector('canvas.viewer-canvas') && !document.querySelector('.is-busy') && !document.querySelector('.download[disabled]'), null, { timeout: 60000 });
    await pg.waitForTimeout(2500);
    await pg.screenshot({ path: join(out, file) });
    console.log(`${name}: ${join(out, file)}`);
    if (options.isMobile) console.log(`${name}: the image takes ${(100 * await imageShare(pg)).toFixed(1)} % of the viewport`);
  } finally {
    await ctx.close();
  }
};

try {
  await shoot('desktop', { viewport: { width: 1440, height: 900 } }, 'desktop.png');
  await shoot('phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 'phone.png');
  await shoot('dark', { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' }, 'dark.png');
} finally {
  await browser.close();
  server.httpServer.close();
}
