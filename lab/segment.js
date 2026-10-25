// LAB SPIKE: test page for src/lab/sam.js: does "segment everything" run
// fast enough in the browser, and does it find what matters?
import { RawImage } from '@huggingface/transformers';
import { load, opts, partition, segmentEverything } from '../src/lab/sam.js';

const q = new URLSearchParams(location.search);
for (const k of ['points', 'cropPoints', 'crops', 'iou', 'stability', 'nms', 'batch']) if (q.has(k)) opts[k] = Number(q.get(k));
if (q.has('device')) opts.device = q.get('device');
if (q.has('dtype')) opts.dtype = q.get('dtype');
if (q.get('skip') === '0') opts.skip = false;

const $ = (id) => document.getElementById(id);
const log = (s) => { $('log').textContent += s + '\n'; console.log(s); };

function draw(image, res) {
  const { w, h, masks } = res;
  const label = partition(res);
  const cv = $('out');
  cv.width = w * 2 + 12;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(image.toCanvas(), 0, 0, w, h);
  // Right: one flat colour per segment, black where segments meet, grey
  // where no segment covers the pixel.
  const hue = (i) => (i * 137.508) % 360;
  const rgb = masks.map((_, i) => hsl(hue(i), 0.6, 0.6));
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x, l = label[k];
      const edge = (x + 1 < w && label[k + 1] !== l) || (y + 1 < h && label[k + w] !== l);
      const c = edge ? [20, 20, 20] : l < 0 ? [200, 200, 200] : rgb[l];
      img.data.set([...c, 255], k * 4);
    }
  }
  ctx.putImageData(img, w + 12, 0);
  // Left: outlines of the segments over the photo.
  const ov = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x, l = label[k];
      if ((x + 1 < w && label[k + 1] !== l) || (y + 1 < h && label[k + w] !== l)) ov.data.set([255, 255, 255, 255], k * 4);
    }
  }
  ctx.putImageData(ov, 0, 0);
}

function hsl(hd, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + hd / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}

async function run(src) {
  $('log').textContent = '';
  await load(log);
  const image = await RawImage.read(src);
  log(`image ${image.width} x ${image.height}, ${opts.points} points + ${opts.crops} crops x ${opts.cropPoints}`);
  const t = performance.now();
  const res = await segmentEverything(image);
  for (const [k, v] of Object.entries(res.T)) log(`  ${k}: ${Math.round(v)} ms`);
  log(`${res.candidates} candidates, ${res.masks.length} segments (${res.masks.filter((m) => m.pass !== 'pass 1').length} from crops), total ${Math.round(performance.now() - t)} ms`);
  draw(image, res);
  // Crop boxes, dashed, over the photo.
  const ctx = $('out').getContext('2d');
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 2;
  for (const [x0, y0, x1, y1] of res.crops) ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  window.__done = true;
}

$('file').addEventListener('change', (e) => e.target.files[0] && run(URL.createObjectURL(e.target.files[0])));
for (const b of document.querySelectorAll('[data-src]')) b.addEventListener('click', () => run(b.dataset.src));
window.__run = run;
if (q.get('src')) run(q.get('src'));
