// Renders public/favicon.svg to the PNG icons the manifest and iOS need.
// Usage: CHROMIUM=/path/to/chromium node scripts/icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser' });
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(`public/icon-${size}.png`, png);
  console.log(`public/icon-${size}.png`);
  await page.close();
}
await browser.close();
