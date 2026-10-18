import { sample } from './analysis.js';
import { enforceConnectivity } from './slic.js';

// Crack growth in the spirit of Jared Tarbell's "Substrate": cracks grow in
// straight-ish lines and stop when they run into another crack, which gives
// T-junctions everywhere, the signature of something broken rather than grown.
// Each crack is born at an interior point and grows both ways, so it always
// splits the region it lands in. Birth points are drawn uniformly and accepted
// with probability (sMin / s(x))^2: big regions get hit more often, detailed
// areas get more cracks. Cracks can bend to follow image edges.
//
// Returns { mask, labels }: mask marks crack pixels; labels are the regions
// between cracks, grown over the crack pixels so the grout width stays even.
export function growCracks(an, p, rng) {
  const { w, h, size, theta, coherence } = an;
  const owner = new Int32Array(w * h).fill(-1);

  // The image border is crack 0.
  for (let x = 0; x < w; x++) { owner[x] = 0; owner[(h - 1) * w + x] = 0; }
  for (let y = 0; y < h; y++) { owner[y * w] = 0; owner[y * w + w - 1] = 0; }

  let sMin = Infinity, density = 0;
  for (let i = 0; i < w * h; i++) {
    density += 1 / (size[i] * size[i]);
    if (size[i] < sMin) sMin = size[i];
  }
  const target = Math.max(4, Math.round(p.crackDensity * density));

  let nextId = 1, born = 0;
  const active = [];
  // A birth can fail because the point is on a crack, is rejected by the
  // density test or is too close to another crack. Only several failed births
  // in a row mean the image is full.
  let failures = 0;
  const birth = () => {
    for (let t = 0; t < 2000; t++) {
      const x = 1 + rng() * (w - 2), y = 1 + rng() * (h - 2);
      const i = (y | 0) * w + (x | 0);
      if (owner[i] >= 0) continue;
      if (rng() > (sMin / size[i]) ** 2) continue;
      if (p.crackGap > 0 && nearCrack(owner, w, h, x, y, p.crackGap * size[i], rng)) continue;
      let a = rng() * Math.PI;
      if (rng() < p.crackFollow * coherence[i]) a = theta[i];
      a += (rng() * 2 - 1) * (p.crackAngleNoise * Math.PI) / 180;
      const id = nextId++;
      owner[i] = id;
      for (const dir of [0, Math.PI]) active.push({ x, y, a: a + dir, id, px: x | 0, py: y | 0, steps: 0 });
      born++;
      failures = 0;
      return;
    }
    if (++failures >= 5) born = target; // the image is full of cracks
  };

  const STEP = 0.4;
  let guard = 0;
  const maxIter = w * h * 40;
  while ((born < target || active.length) && guard++ < maxIter) {
    while (active.length < 2 * p.crackActive && born < target) birth();
    if (!active.length) break;
    for (let k = active.length - 1; k >= 0; k--) {
      const c = active[k];
      // Bend toward the local edge tangent (mod pi), plus a little wander.
      const coh = sample(coherence, w, h, c.x, c.y);
      if (p.crackFollow > 0 && coh > 0.05) {
        let t = sample(theta, w, h, c.x, c.y);
        let d = t - c.a;
        d = ((d + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
        c.a += d * p.crackFollow * coh * 0.12;
      }
      c.a += rng.normal() * p.crackCurl;
      c.x += Math.cos(c.a) * STEP;
      c.y += Math.sin(c.a) * STEP;
      const nx = c.x | 0, ny = c.y | 0;
      let dead = nx < 0 || ny < 0 || nx >= w || ny >= h;
      if (!dead && (nx !== c.px || ny !== c.py)) {
        // Mark a 4-connected path so regions cannot leak through diagonals.
        const cells = nx !== c.px && ny !== c.py ? [[nx, c.py], [nx, ny]] : [[nx, ny]];
        for (const [qx, qy] of cells) {
          const o = owner[qy * w + qx];
          if (o >= 0 && o !== c.id) { dead = true; break; }
          owner[qy * w + qx] = c.id;
        }
        c.px = nx; c.py = ny;
      }
      if (dead) active.splice(k, 1);
    }
  }

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = owner[i] >= 0 ? 1 : 0;
  return { mask, labels: enforceConnectivity(floodRegions(mask, w, h), w, h) };
}

function floodRegions(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let next = 0;
  for (let s = 0; s < w * h; s++) {
    if (mask[s] || labels[s] >= 0) continue;
    let top = 0;
    stack[top++] = s;
    labels[s] = next;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && !mask[i - 1] && labels[i - 1] < 0) { labels[i - 1] = next; stack[top++] = i - 1; }
      if (x < w - 1 && !mask[i + 1] && labels[i + 1] < 0) { labels[i + 1] = next; stack[top++] = i + 1; }
      if (y > 0 && !mask[i - w] && labels[i - w] < 0) { labels[i - w] = next; stack[top++] = i - w; }
      if (y < h - 1 && !mask[i + w] && labels[i + w] < 0) { labels[i + w] = next; stack[top++] = i + w; }
    }
    next++;
  }
  return labels;
}

// Is there a crack within radius r of (x, y)? Checks two rings of samples,
// which is enough to keep births away from existing cracks.
function nearCrack(owner, w, h, x, y, r, rng) {
  const t0 = rng() * Math.PI;
  for (const rr of [r, r * 0.5]) {
    const n = Math.max(8, Math.ceil(rr));
    for (let k = 0; k < n; k++) {
      const t = t0 + (k / n) * 2 * Math.PI;
      const qx = Math.round(x + Math.cos(t) * rr), qy = Math.round(y + Math.sin(t) * rr);
      if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
      if (owner[qy * w + qx] > 0) return true;
    }
  }
  return false;
}
