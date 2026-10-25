// LAB SPIKE: screenshots the zones view and the line eraser with ?lab.
// Usage: npm run build && node scripts/lab-zones-shot.mjs <out-dir>
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const [out = '.'] = process.argv.slice(2);
const server = await preview({
  preview: { port: 5193, strictPort: true, headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' } },
  logLevel: 'error',
});
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ready = () => page.waitForFunction(() => !document.querySelector('.is-busy') && !document.querySelector('.busy-mark'), null, { timeout: 120000 });
try {
  await page.goto('http://localhost:5193/?lab&samDevice=wasm');
  await ready();
  await page.locator('.section-title b', { hasText: /^Trozos$/ }).click();
  await page.waitForFunction(() => /objetos en|Error/.test(document.body.innerText), null, { timeout: 600000 });
  console.log('seg:', await page.locator('.lab-block .help').first().textContent());
  await ready();
  await page.getByRole('button', { name: 'Ver las zonas' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/zones.png` });
  const undo = page.getByRole('button', { name: /^Deshacer todo/ });
  await page.getByRole('button', { name: 'Borrar líneas' }).click();
  // A stroke across the middle of the image.
  const box = await page.locator('.brush-canvas').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.45);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width * (0.2 + 0.03 * i), box.y + box.height * 0.45);
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/erased.png` });
  await ready();
  await page.waitForTimeout(800);
  console.log('after erase:', await undo.textContent({ timeout: 5000 }));
  await page.screenshot({ path: `${out}/erased.png` });
  await page.getByRole('button', { name: 'Ocultar las zonas' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/erased-nozones.png` });
  console.log(errors.length ? `errors: ${errors.join('\n')}` : 'no page errors');
} finally {
  await browser.close();
  await server.close();
}
