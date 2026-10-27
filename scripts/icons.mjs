// Renders public/favicon.svg to the PNG icons the manifest and iOS need.
// Usage: CHROMIUM=/path/to/chromium node scripts/icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium-browser' });
for (const size of [180, 192, 512]) {
  // The iOS icon is opaque and full-bleed (iOS rounds it, and paints transparency black).
  const art = size === 180 ? svg.replace(/ rx="\d+"/, '') : svg;
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${art}`);
  const png = await page.screenshot({ omitBackground: size !== 180, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(`public/icon-${size}.png`, png);
  if (size === 180) {
    const corners = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 180;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return [[0, 0], [179, 0], [0, 179], [179, 179]].map(([x, y]) => g.getImageData(x, y, 1, 1).data[3]);
    }, png.toString('base64'));
    if (corners.some((a) => a !== 255)) throw new Error(`icon-180.png has transparent corners: ${corners}`);
  }
  console.log(`public/icon-${size}.png`);
  await page.close();
}
await browser.close();
