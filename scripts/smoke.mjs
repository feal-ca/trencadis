// Smoke test of the built site in headless Chromium: it loads, a method can be
// switched, a photo uploaded and the mosaic downloaded, with no page errors.
// Usage: npm run build && node scripts/smoke.mjs
//   CHROMIUM=/path/to/chromium to use a system browser; otherwise Playwright's
//   own (npx playwright-core install chromium).
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const server = await preview({ preview: { port: 5191, strictPort: true }, logLevel: 'error' });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  // Software WebGL, so it runs on CI machines without a GPU.
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
// This Chromium exposes navigator.gpu even without a GPU, which would make
// segmentation start by itself on an uploaded photo; hiding it gives the
// 'ask' policy of browsers without WebGPU.
await page.addInitScript(() => { delete Navigator.prototype.gpu; });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// While a request is aborted on purpose, the browser's log of that very
// request is expected; anything else is still an error.
let abortedUrl = null;
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (abortedUrl && m.location().url.endsWith(abortedUrl)) return;
  errors.push(m.text());
});

// Requests to the model's hosts (Hugging Face) and the ONNX runtime's
// (jsDelivr): the sample and a photo uploaded here, with segmentation asking
// first (no WebGPU in headless), must make none.
const modelRequests = [];
page.on('request', (r) => { if (/(^|\.)(hf\.co|huggingface\.co|jsdelivr\.net)$/.test(new URL(r.url()).hostname)) modelRequests.push(r.url()); });

// The keys of the engine's API (window.__trencadis, on with ?debug): a refactor
// of useEngine must keep them all. A task that adds one adds it here.
const API_KEYS = ('addGuide autoGrout bitmap busy canRedo canUndo clearGuides closeKofi download dragEnd dragStart error estimate format glCanvas gpu '
  + 'guides hasImage images info isDefault kofi labels lines loadBlob loadSample macros mosaicReady params photoName pickShape redo '
  + 'refineShape removeZone reseed resetAll restore seg segAccept segDecline segRetry segments setFormat setMacro setManual setParam '
  + 'setParams setSign setStyle setViewport setWanted setZoneMode share sign style undo undoGuide zones').split(' ');

const idle = (pg) => pg.waitForFunction(
  () => !document.querySelector('.is-busy') && !document.querySelector('.download[disabled]'),
  null, { timeout: 120000 },
);
const ready = () => idle(page);
// Polls the session kept in IndexedDB until `ok(snapshot)` holds. The store is
// created here if the page has not yet, as the app would.
const storedWhen = async (pg, ok) => {
  for (let i = 0; i < 60; i++) {
    const snap = await pg.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('trencadis', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('session');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        const get = db.transaction('session').objectStore('session').get('last');
        get.onsuccess = () => { db.close(); resolve(get.result ? { name: get.result.name, guides: get.result.guides } : null); };
        get.onerror = () => { db.close(); resolve(null); };
      };
    }));
    if (ok(snap)) return;
    await pg.waitForTimeout(250);
  }
  throw new Error('the session was never saved');
};
const status = () => page.locator('.status').textContent();
const step = async (name, fn) => {
  const t = performance.now();
  await fn();
  console.log(`ok  ${name} (${Math.round(performance.now() - t)} ms): ${await status()}`);
};

try {
  await step('load', async () => {
    await page.goto('http://localhost:5191/?debug');
    await ready();
    const keys = await page.evaluate(() => Object.keys(window.__trencadis).sort());
    if (JSON.stringify(keys) !== JSON.stringify(API_KEYS)) {
      throw new Error(`engine API changed: ${keys.join(' ')}`);
    }
    // The first sample comes with its shapes: done, without the model.
    await page.waitForFunction(() => window.__trencadis.seg.phase === 'done', null, { timeout: 30000 });
    const seg = await page.evaluate(() => window.__trencadis.seg);
    if (!seg.preset) throw new Error(`seg state of the sample: ${JSON.stringify(seg)}`);
  });
  await step('about', async () => {
    await page.locator('.about-link').click();
    const text = await page.locator('dialog[open]').textContent();
    if (!/Hugging Face/.test(text)) throw new Error('the About dialog says nothing about Hugging Face');
    await page.keyboard.press('Escape');
    if (await page.locator('dialog[open]').count()) throw new Error('Esc did not close the About dialog');
  });
  await step('switch method', async () => {
    await page.locator('.algo', { hasText: 'Grietas' }).click();
    await page.waitForTimeout(300);
    await ready();
  });
  await step('shape tool', async () => {
    const button = page.locator('button', { hasText: 'Tocar una forma' });
    await button.click();
    await page.waitForSelector('.viewer.tool-shape');
    // The mosaic stays on screen with the tool on.
    await ready();
    const count = await status();
    if (!/trozos/.test(count)) throw new Error(`status with the shape tool on: ${count}`);
    await button.click();
    await page.waitForSelector('.viewer:not(.tool-shape)');
  });
  await step('undo a line', async () => {
    // History commits a step 500 ms after the last change, so the line is its own step.
    await page.evaluate(() => window.__trencadis.addGuide({ points: [[0.1, 0.5], [0.9, 0.5]], mode: 'points', snap: false }));
    await page.waitForFunction(() => window.__trencadis.guides.length === 1 && window.__trencadis.canUndo);
    await page.waitForTimeout(600);
    await ready();
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.__trencadis.guides.length === 0, null, { timeout: 10000 });
    await ready();
  });
  await step('drag a slider', async () => {
    const before = await page.evaluate(() => window.__trencadis.info.shards);
    const runs = await page.evaluate(() => window.__runs.length);
    await page.locator('#m-size').scrollIntoViewIfNeeded();
    const box = await page.locator('#m-size').boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box.x + 2 + ((box.width - 4) * i) / 10, y);
      // Longer than the debounce, so runs start while the control is held.
      await page.waitForTimeout(80);
    }
    // Held at the end until a draft has finished.
    await page.waitForFunction((n) => window.__runs.slice(n).some((r) => r.draft), runs, { timeout: 60000 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await ready();
    const after = await page.evaluate(() => window.__trencadis.info.shards);
    if (after === before) throw new Error(`piece count did not change after the drag: ${before}`);
    // A download after a release waits for the full run: asked right after the
    // release, and asked at the full tessellation, before its colours arrive.
    for (const atTessellation of [false, true]) {
      await page.evaluate(() => { window.__exports = []; });
      const runsBefore = await page.evaluate(() => window.__runs.length);
      await page.mouse.move(box.x + 2, y);
      await page.mouse.down();
      // Ends where the control was not, so the drag changes the settings.
      await page.mouse.move(box.x + box.width * (atTessellation ? 0.8 : 0.5), y);
      await page.waitForFunction((n) => window.__runs.slice(n).some((r) => r.draft), runsBefore, { timeout: 60000 });
      if (atTessellation) {
        await page.evaluate(() => {
          window.__onStage = (d) => {
            if (d.stage !== 'tessellation' || d.draft) return;
            window.__onStage = null;
            window.__trencadis.download();
          };
        });
      }
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.mouse.up().then(() => !atTessellation && page.locator('.download').click()),
      ]);
      const png = Buffer.concat(await (await dl.createReadStream()).toArray());
      const exp = await page.evaluate(() => window.__exports);
      if (exp.length !== 1 || exp[0].draft || exp[0].runs <= runsBefore + 1) throw new Error(`download did not wait for the full run (at tessellation: ${atTessellation}): ${JSON.stringify(exp)}`);
      const side = Math.max(png.readUInt32BE(16), png.readUInt32BE(20));
      if (side !== 2000) throw new Error(`download is ${side} px on its long side`);
      await ready();
    }
    // Drafts while the control was held, and the last run is the full one.
    const drafts = await page.evaluate((n) => window.__runs.slice(n).map((r) => !!r.draft), runs);
    if (!drafts.includes(true) || drafts.at(-1)) throw new Error(`runs during the drag (draft or not): ${drafts.join(' ')}`);
  });
  await step('upload', async () => {
    await page.locator('input[type=file]').setInputFiles('public/samples/barcas.webp');
    await page.waitForTimeout(300);
    await ready();
    if (modelRequests.length) throw new Error(`requests to the model before any pick: ${modelRequests.join(' ')}`);
  });
  await step('drop on the panel', async () => {
    const b64 = readFileSync('public/samples/barcas.webp').toString('base64');
    const dt = await page.evaluateHandle(async (data) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const t = new DataTransfer();
      t.items.add(new File([bytes], 'barcas.webp', { type: 'image/webp' }));
      return t;
    }, b64);
    const side = page.locator('.side');
    for (const type of ['dragenter', 'dragover', 'drop']) await side.dispatchEvent(type, { dataTransfer: dt });
    await page.waitForTimeout(300);
    await ready();
    const name = await page.evaluate(() => window.__trencadis.photoName);
    if (name !== 'barcas') throw new Error(`photoName after the drop: ${name}`);
  });
  await step('sample offline', async () => {
    abortedUrl = '/samples/vangogh.webp';
    await page.route('**/samples/vangogh.webp', (r) => r.abort());
    await page.locator('button.link', { hasText: 'Van Gogh' }).click();
    await page.waitForSelector('.status .err');
    const msg = await page.locator('.status .err').textContent();
    if (!/No se ha podido cargar el ejemplo/.test(msg)) throw new Error(`error text: ${msg}`);
    // Let the browser's console event for the aborted request arrive while it is still ignored.
    await page.waitForTimeout(300);
    abortedUrl = null;
    await page.unroute('**/samples/vangogh.webp');
  });
  await step('download', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.download').click()]);
    if (!dl.suggestedFilename().startsWith('trencadis-barcas-')) throw new Error(`file name: ${dl.suggestedFilename()}`);
    const size = (await (await dl.createReadStream()).toArray()).reduce((s, b) => s + b.length, 0);
    if (size < 50000) throw new Error(`download is only ${size} bytes`);
  });
  await step('kofi once', async () => {
    // The first download of this browser (the drag step's) left the note up; closing it works.
    await page.waitForSelector('.kofi-note a[href="https://ko-fi.com/fealca"]', { timeout: 5000 });
    await page.locator('.kofi-note button').click();
    if (await page.locator('.kofi-note').count()) throw new Error('the Ko-fi note stayed after ×');
    // A later download, even on a fresh page of the same browser, does not bring it back.
    // A copy of this browser's storage, as a reload would find it.
    const reloaded = await browser.newContext({ storageState: await page.context().storageState(), viewport: { width: 1280, height: 800 } });
    const again = await reloaded.newPage();
    again.on('pageerror', (e) => errors.push(e.message));
    again.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await again.goto('http://localhost:5191/?debug');
      await idle(again);
      const [dl] = await Promise.all([again.waitForEvent('download', { timeout: 60000 }), again.locator('.download').click()]);
      await dl.path();
      await again.waitForTimeout(500);
      if (await again.locator('.kofi-note').count()) throw new Error('the Ko-fi note came back after a reload');
    } finally {
      await reloaded.close();
    }
  });
  await step('keys', async () => {
    // With the focus on the page, R is another version.
    await page.evaluate(() => document.activeElement?.blur());
    const seed = () => page.evaluate(() => window.__trencadis.params.seed);
    const before = await seed();
    await page.keyboard.press('r');
    await page.waitForFunction((n) => window.__trencadis.params.seed !== n, before, { timeout: 10000 });
    await ready();
    // Typing in a control does not reseed.
    const typed = await seed();
    await page.locator('select.out-size').focus();
    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    if ((await seed()) !== typed) throw new Error('R reseeded while a select had the focus');
    await page.evaluate(() => document.activeElement?.blur());
    // Holding the space bar shows the decoded photo, not the 800 px working copy.
    await page.keyboard.down(' ');
    await page.waitForFunction(() => [...document.querySelectorAll('canvas.viewer-canvas')]
      .some((c) => c.width === window.__trencadis.bitmap.width && c.height === window.__trencadis.bitmap.height), null, { timeout: 10000 });
    await page.keyboard.up(' ');
  });
  await step('export size', async () => {
    await page.locator('select.out-size').selectOption('3000');
    await ready();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('.download').click()]);
    const png = Buffer.concat(await (await dl.createReadStream()).toArray());
    const side = Math.max(png.readUInt32BE(16), png.readUInt32BE(20));
    if (side !== 3000) throw new Error(`download is ${side} px on its long side, not 3000`);
    await page.locator('select.out-size').selectOption('2000');
    await ready();
  });
  await step('share encodes in the background', async () => {
    // A browser that can share files: the file is encoded once the mosaic is
    // still, without the visible canvas ever leaving its size, and the share
    // uses it. It must be the pixels a download gives.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const sp = await ctx.newPage();
    await sp.addInitScript(() => {
      navigator.canShare = () => true;
      navigator.share = async ({ files }) => { window.__shared = files; };
      window.__sizes = new Set();
      const sample = () => {
        const c = document.querySelector('canvas.viewer-canvas');
        if (c) window.__sizes.add(`${c.width}x${c.height}`);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    sp.on('pageerror', (e) => errors.push(e.message));
    sp.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await sp.goto('http://localhost:5191/?debug');
      await idle(sp);
      await sp.waitForFunction(() => window.__shareStats?.background >= 1, null, { timeout: 60000 });
      const [dl] = await Promise.all([sp.waitForEvent('download', { timeout: 60000 }), sp.locator('.download').click()]);
      const png = Buffer.concat(await (await dl.createReadStream()).toArray());
      await sp.evaluate(() => { window.__sizes.clear(); });
      await sp.getByRole('button', { name: 'Compartir' }).click();
      await sp.waitForFunction(() => window.__shared, null, { timeout: 60000 });
      const shared = await sp.evaluate(async () => {
        const f = window.__shared[0];
        return { name: f.name, type: f.type, stats: window.__shareStats, bytes: [...new Uint8Array(await f.arrayBuffer())] };
      });
      if (shared.stats.cached !== 1 || shared.stats.atShare) throw new Error(`share did not use the cached file: ${JSON.stringify(shared.stats)}`);
      if (!/^trencadis-.+\.png$/.test(shared.name) || shared.type !== 'image/png') throw new Error(`shared file: ${shared.name} ${shared.type}`);
      if (!Buffer.from(shared.bytes).equals(png)) throw new Error(`the shared file differs from the download (${shared.bytes.length} vs ${png.length} bytes)`);
      const sizes = await sp.evaluate(() => [...window.__sizes]);
      if (sizes.length > 1) throw new Error(`the visible canvas changed size: ${sizes.join(' ')}`);
    } finally {
      await ctx.close();
    }
  });
  await step('webgl lost', async () => {
    // The status bar overlays the bottom of the canvas, so it is left out.
    const shot = async () => {
      const box = await page.locator('.viewer-host canvas').boundingBox();
      return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height - 100 } });
    };
    // Shots until two in a row agree, so a redraw still under way is not compared.
    const settled = async () => {
      let prev = await shot();
      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(250);
        const next = await shot();
        if (next.equals(prev)) return next;
        prev = next;
      }
      throw new Error('the canvas never settled');
    };
    const gpu = (on) => page.waitForFunction((v) => window.__trencadis.gpu === v, on, { timeout: 30000 });
    await page.evaluate(() => {
      const gl = document.querySelector('.viewer-host canvas').getContext('webgl2');
      window.__lose = gl.getExtension('WEBGL_lose_context');
      window.__lose.loseContext();
    });
    await gpu(false);
    await ready();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.locator('.download').click()]);
    const size = (await (await dl.createReadStream()).toArray()).reduce((s, b) => s + b.length, 0);
    if (size < 50000) throw new Error(`download after losing the context is only ${size} bytes`);
    // Change the tessellation while on the CPU; the GPU must show it after the restore.
    const runs = await page.evaluate(() => window.__runs.length);
    const before = await page.evaluate(() => window.__trencadis.params.algorithm);
    const [toName, toKey, fromName, fromKey] = before === 'fracture'
      ? ['Grietas', 'cracks', 'Cortes rectos', 'fracture']
      : ['Cortes rectos', 'fracture', 'Grietas', 'cracks'];
    await page.locator('.algo', { hasText: toName }).click();
    await page.waitForFunction((n) => window.__runs.length > n, runs, { timeout: 60000 });
    await ready();
    await page.evaluate(() => window.__lose.restoreContext());
    await gpu(true);
    await page.waitForSelector('.viewer-host canvas');
    await ready();
    const count = await status();
    if (!/trozos/.test(count)) throw new Error(`status after restoring the context: ${count}`);
    const after = await settled();
    // A blank canvas compresses to a few hundred bytes.
    if (after.length < 5000) throw new Error(`restored canvas looks blank (${after.length} bytes)`);
    // The same method drawn again with the GPU up is the reference.
    const pick = async (name, algorithm) => {
      await page.locator('.algo', { hasText: name }).click();
      await page.waitForFunction((a) => window.__trencadis.params.algorithm === a, algorithm);
      await page.waitForTimeout(300);
      await ready();
    };
    await pick(fromName, fromKey);
    await pick(toName, toKey);
    if (!after.equals(await settled())) throw new Error('restored canvas does not show the mosaic made while on the CPU');
  });
  await step('reload keeps the photo', async () => {
    // Its own page (its own storage), so the main one keeps its state.
    const re = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await re.addInitScript(() => { delete Navigator.prototype.gpu; });
    re.on('pageerror', (e) => errors.push(e.message));
    re.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await re.goto('http://localhost:5191/?debug');
      await idle(re);
      await re.locator('input[type=file]').setInputFiles('public/samples/barcas.webp');
      await re.waitForFunction(() => window.__trencadis.photoName === 'barcas');
      await idle(re);
      await re.evaluate(() => window.__trencadis.addGuide({ points: [[0.1, 0.5], [0.9, 0.5]], mode: 'points', snap: false }));
      await re.waitForFunction(() => window.__trencadis.guides.length === 1);
      // The session is written 1 s after the last change.
      await storedWhen(re, (snap) => snap?.guides?.length === 1 && snap.name === 'barcas');
      await re.reload();
      await re.waitForFunction(() => window.__trencadis?.hasImage && window.__trencadis.guides.length === 1, null, { timeout: 30000 });
      await idle(re);
      const name = await re.evaluate(() => window.__trencadis.photoName);
      if (name !== 'barcas') throw new Error(`photoName after the reload: ${name}`);
    } finally {
      await re.close();
    }
  });
  await step('photo chosen during start-up wins', async () => {
    const early = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await early.addInitScript(() => { delete Navigator.prototype.gpu; });
    early.on('pageerror', (e) => errors.push(e.message));
    early.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await early.goto('http://localhost:5191/?debug', { waitUntil: 'commit' });
      await early.locator('input[type=file]').setInputFiles('public/samples/barcas.webp');
      await early.waitForFunction(() => window.__trencadis?.hasImage);
      await idle(early);
      // Time for a start-up load to land on top of the photo, if it were going to.
      await early.waitForTimeout(1500);
      await idle(early);
      const name = await early.evaluate(() => window.__trencadis.photoName);
      if (name !== 'barcas') throw new Error(`photoName after an upload during start-up: ${name}`);
    } finally {
      await early.close();
    }
  });
  await step('reload keeps shapes', async () => {
    const re = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await re.addInitScript(() => { delete Navigator.prototype.gpu; });
    re.on('pageerror', (e) => errors.push(e.message));
    re.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await re.goto('http://localhost:5191/?debug');
      await idle(re);
      // Wait for the sample's own save, so the seeded session is the last write.
      await re.waitForTimeout(1500);
      await re.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open('trencadis', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('session');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const box = [0.4, 0.4, 0.6, 0.6];
          const snap = {
            v: 1, sample: './samples/vermeer.webp', photo: null, name: 'vermeer', guides: [],
            zones: [{
              id: 'z7', mode: 'more', points: [[0.5, 0.5, 1]],
              region: { box, w: 4, h: 4, data: new Uint8Array(16).fill(1) },
              parts: { box, w: 4, h: 4, labels: new Int32Array(16).fill(0), count: 1 },
            }],
            segments: null,
          };
          const tx = open.result.transaction('session', 'readwrite');
          tx.objectStore('session').put(snap, 'last');
          tx.oncomplete = () => { open.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }));
      await re.reload();
      await re.waitForFunction(() => window.__trencadis?.zones.some((z) => z.id === 'z7' && z.mode === 'more'), null, { timeout: 30000 });
      await idle(re);
      // The restore is where the history starts: nothing to undo, and Ctrl+Z keeps the shape.
      await re.waitForTimeout(700);
      if (await re.evaluate(() => window.__trencadis.canUndo)) throw new Error('canUndo right after a restore');
      await re.evaluate(() => document.body.focus());
      await re.keyboard.press('Control+z');
      await re.waitForTimeout(300);
      const kept = await re.evaluate(() => window.__trencadis.zones.some((z) => z.id === 'z7' && z.mode === 'more'));
      if (!kept) throw new Error('Ctrl+Z after a restore removed the shape');
      await idle(re);
    } finally {
      await re.close();
    }
  });
  await step('no webgl', async () => {
    // Its own page, so the main one keeps its state.
    const nogl = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    nogl.on('pageerror', (e) => errors.push(e.message));
    nogl.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await nogl.goto('http://localhost:5191/?debug&nogl');
      await idle(nogl);
      const gpu = await nogl.evaluate(() => window.__trencadis.gpu);
      if (gpu) throw new Error('?nogl still created a renderer');
      // The mosaic on screen is drawn at screen size, not at the download size.
      const sizes = await nogl.evaluate(() => [...document.querySelectorAll('canvas.viewer-canvas')]
        .map((c) => ({ c, r: c.getBoundingClientRect() }))
        .filter(({ c, r }) => r.width > 0 && r.height > 0 && getComputedStyle(c).visibility !== 'hidden' && !/seg-outline|shape-canvas|brush-canvas/.test(c.className))
        .map(({ c, r }) => ({ px: Math.max(c.width, c.height), box: Math.max(r.width, r.height) })));
      if (!sizes.length) throw new Error('no visible mosaic canvas');
      for (const { px, box } of sizes) {
        if (px > 2 * box) throw new Error(`mosaic canvas is ${px} px in a ${Math.round(box)} px box`);
      }
      const [dl] = await Promise.all([nogl.waitForEvent('download'), nogl.locator('.download').click()]);
      const size = (await (await dl.createReadStream()).toArray()).reduce((s, b) => s + b.length, 0);
      if (size < 50000) throw new Error(`download without WebGL is only ${size} bytes`);
    } finally {
      await nogl.close();
    }
  });
  await step('phone', async () => {
    // Its own context: a touch phone, where the header is one line and the image gets the room.
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    });
    const ph = await ctx.newPage();
    await ph.addInitScript(() => { delete Navigator.prototype.gpu; });
    ph.on('pageerror', (e) => errors.push(e.message));
    ph.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await ph.goto('http://localhost:5191/?debug');
      await idle(ph);
      await ph.waitForFunction(() => window.__trencadis?.mosaicReady, null, { timeout: 60000 });
      // The sample's "N formas" line takes a row of the bar for two seconds; measure after it.
      await ph.waitForSelector('.seg-status', { state: 'detached', timeout: 10000 });
      // The sample's "N formas" line is up for two seconds after the mosaic: measure
      // with it on screen, then again without it. The visible image is the canvas
      // box with object-fit: contain applied.
      const measure = () => ph.evaluate(() => {
        const cv = [...document.querySelectorAll('canvas.viewer-canvas')]
          .filter((c) => !/seg-outline|shape-canvas|brush-canvas/.test(c.className) && c.getBoundingClientRect().width > 0)
          .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
        const b = cv.getBoundingClientRect();
        const k = Math.min(b.width / cv.width, b.height / cv.height);
        const w = cv.width * k, h = cv.height * k;
        const left = b.left + (b.width - w) / 2, top = b.top + (b.height - h) / 2;
        const st = document.querySelector('.seg-status')?.getBoundingClientRect();
        const cuts = !!st && st.left < left + w && st.right > left && st.top < top + h && st.bottom > top;
        return {
          share: (w * h) / (innerWidth * innerHeight), cuts, status: !!st, boxH: b.height,
          header: document.querySelector('header.top').getBoundingClientRect().height,
        };
      });
      // Loading the sample again (from the sheet's own links) brings the line back for two seconds.
      await ph.locator('.extras .link', { hasText: 'Vermeer' }).click();
      await ph.waitForSelector('.seg-status', { timeout: 10000 });
      const withStatus = await measure();
      if (!withStatus.status) throw new Error('the status line was gone before it was measured');
      await ph.waitForSelector('.seg-status', { state: 'detached', timeout: 10000 });
      const m = await measure();
      console.log(`    image ${(100 * withStatus.share).toFixed(1)} % of the viewport (${(100 * m.share).toFixed(1)} % after the status), header ${Math.round(m.header)} px`);
      if (withStatus.share < 0.28) throw new Error(`the image is only ${(100 * withStatus.share).toFixed(1)} % of the phone viewport`);
      if (withStatus.cuts) throw new Error('.seg-status covers the image');
      // «Otra versión ↻» and the status share one line with the hold button.
      const bar = await ph.evaluate(() => {
        const b = document.querySelector('.viewer-bar');
        return { h: b.getBoundingClientRect().height, other: !!b.querySelector('[title="Otra versión (R)"]'), zoomButtons: !!b.querySelector('.zoom-buttons') };
      });
      if (!bar.other || bar.zoomButtons || bar.h > 40) throw new Error(`phone viewer bar: ${JSON.stringify(bar)}`);
      if (Math.abs(withStatus.boxH - m.boxH) > 0.5) throw new Error(`the image box went from ${withStatus.boxH} to ${m.boxH} px when the status went`);
    } finally {
      await ctx.close();
    }
  });
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  console.log('smoke test passed');
} catch (e) {
  console.error('smoke test FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.httpServer.close();
}
