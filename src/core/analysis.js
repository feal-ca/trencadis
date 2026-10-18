import { blur, luminance, normalizePercentile, sobel } from './image.js';

// Stage 0: the maps every tessellation reads.
//   detail    D(x) in [0,1], local high-frequency energy
//   size      s(x), desired shard diameter in working pixels
//   theta     edge tangent direction (radians, mod pi) from the structure tensor
//   coherence how strongly oriented the neighbourhood is, in [0,1]
//
// The maps are smooth (every blur has sigma >= 1), so large images are
// analysed at half resolution and interpolated back; p.exactAnalysis skips that.
//
// `mask` is the detail brush, { w, h, data } in [-1, 1] at any resolution:
// negative removes detail, positive adds it.
export function analyze(img, p, mask = null) {
  if (!p.exactAnalysis && img.w * img.h > 120000) {
    const half = analyzeLuminance(halveField(luminance(img), img.w, img.h), Math.ceil(img.w / 2), Math.ceil(img.h / 2), {
      ...p, detailSigma: p.detailSigma / 2, detailSmooth: p.detailSmooth / 2, tensorSigma: p.tensorSigma / 2, prefilter: 0.5,
    }, mask);
    return upsample(half, img.w, img.h, p);
  }
  return analyzeLuminance(luminance(img), img.w, img.h, p, mask);
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function analyzeLuminance(L, w, h, p, mask) {
  const low = blur(L, w, h, p.detailSigma);
  const hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = Math.abs(L[i] - low[i]);
  const detail = normalizePercentile(blur(hf, w, h, p.detailSmooth));

  const { gx, gy } = sobel(blur(L, w, h, p.prefilter ?? 1), w, h);
  const jxx = new Float32Array(w * h), jxy = new Float32Array(w * h), jyy = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    jxx[i] = gx[i] * gx[i];
    jxy[i] = gx[i] * gy[i];
    jyy[i] = gy[i] * gy[i];
  }
  const sxx = blur(jxx, w, h, p.tensorSigma), sxy = blur(jxy, w, h, p.tensorSigma), syy = blur(jyy, w, h, p.tensorSigma);
  const theta = new Float32Array(w * h);
  const coherence = new Float32Array(w * h);
  const energy = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) energy[i] = Math.sqrt(sxx[i] + syy[i]);
  // Coherence alone is scale-free, so faint canvas texture would count as an
  // edge. Weight it by gradient strength relative to the image's strong edges.
  const strength = normalizePercentile(energy, 0.95);
  for (let i = 0; i < w * h; i++) {
    const a = sxx[i] - syy[i];
    // Dominant eigenvector is the gradient direction; the tangent is 90 degrees off.
    theta[i] = 0.5 * Math.atan2(2 * sxy[i], a) + Math.PI / 2;
    const tr = sxx[i] + syy[i];
    coherence[i] = tr > 1e-12 ? (Math.sqrt(a * a + 4 * sxy[i] * sxy[i]) / tr) * strength[i] : 0;
  }

  // Ignore texture: glints on water, leaves and grass are made of blobs,
  // outlines are not. The determinant of the Hessian is large where the
  // image curves both ways (a blob) and near zero along an edge; dividing by
  // the squared gradient makes it scale-free. Measured on Barcas: texture
  // 0.15-0.24, boats and horizon below 0.07.
  if (p.ignoreTexture > 0) {
    const sg = 0.75 * p.detailSigma;
    const g = blur(L, w, h, sg);
    const doh = new Float32Array(w * h), grad = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const lxx = g[i - 1] - 2 * g[i] + g[i + 1], lyy = g[i - w] - 2 * g[i] + g[i + w];
        const lxy = (g[i - w - 1] + g[i + w + 1] - g[i - w + 1] - g[i + w - 1]) / 4;
        doh[i] = Math.max(0, lxx * lyy - lxy * lxy) * sg ** 4;
        const gx = (g[i + 1] - g[i - 1]) / 2, gy = (g[i + w] - g[i - w]) / 2;
        grad[i] = (gx * gx + gy * gy) * sg * sg;
      }
    }
    const r = Math.max(2, 1.6 * p.detailSmooth);
    const B = blur(doh, w, h, r), G = blur(grad, w, h, r);
    const weight = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) weight[i] = 1 - smoothstep(0.07, 0.17, B[i] / (G[i] + 1e-9));
    const smooth = blur(weight, w, h, r);
    for (let i = 0; i < w * h; i++) detail[i] *= 1 - p.ignoreTexture + p.ignoreTexture * smooth[i];
  }

  if (mask) {
    // The brush is blurred over ~2% of the long side so painted areas fade
    // into the rest instead of ending at a visible line.
    const soft = blur(mask.data, mask.w, mask.h, 0.02 * Math.max(mask.w, mask.h) * 2);
    for (let y = 0; y < h; y++) {
      const my = Math.min(mask.h - 1, (((y + 0.5) / h) * mask.h) | 0);
      for (let x = 0; x < w; x++) {
        const m = soft[my * mask.w + Math.min(mask.w - 1, (((x + 0.5) / w) * mask.w) | 0)];
        const i = y * w + x;
        if (m < 0) detail[i] *= 1 + m;
        else if (m > 0) detail[i] += (1 - detail[i]) * m;
      }
    }
  }

  for (let i = 0; i < w * h; i++) detail[i] = detail[i] > 0 ? (detail[i] < 1 ? detail[i] : 1) : 0;
  const size = sizeFromDetail(detail, p);

  return { w, h, detail, size, theta, coherence };
}

// Detail is clamped to [0, 1] first: blurs built on running sums leave
// rounding noise like -3e-19, and a negative number to a fractional power
// is NaN.
export function sizeFromDetail(detail, p) {
  const size = new Float32Array(detail.length);
  for (let i = 0; i < detail.length; i++) {
    const d = detail[i] > 0 ? (detail[i] < 1 ? detail[i] : 1) : 0;
    size[i] = p.sMax - (p.sMax - p.sMin) * d ** p.gamma;
  }
  return size;
}

export const sample = (field, w, h, x, y) => {
  const xi = x < 0 ? 0 : x >= w ? w - 1 : x | 0;
  const yi = y < 0 ? 0 : y >= h ? h - 1 : y | 0;
  return field[yi * w + xi];
};

function halveField(f, w, h) {
  const W = Math.ceil(w / 2), H = Math.ceil(h / 2);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const x1 = Math.min(w - 1, 2 * x + 1), y1 = Math.min(h - 1, 2 * y + 1);
      out[y * W + x] = (f[2 * y * w + 2 * x] + f[2 * y * w + x1] + f[y1 * w + 2 * x] + f[y1 * w + x1]) / 4;
    }
  }
  return out;
}

// Bilinear upsampling of the half-size maps. The orientation is interpolated
// as the doubled-angle vector (cos 2θ, sin 2θ), since θ and θ+π are the same.
function upsample(an, w, h, p) {
  const { w: sw, h: sh } = an;
  const detail = new Float32Array(w * h), size = new Float32Array(w * h);
  const theta = new Float32Array(w * h), coherence = new Float32Array(w * h);
  const c2 = new Float32Array(sw * sh), s2 = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) { c2[i] = Math.cos(2 * an.theta[i]); s2[i] = Math.sin(2 * an.theta[i]); }
  const fx = sw / w, fy = sh / h;
  for (let y = 0; y < h; y++) {
    const v = Math.min(sh - 1, Math.max(0, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(v), y1 = Math.min(sh - 1, y0 + 1), ty = v - y0;
    for (let x = 0; x < w; x++) {
      const u = Math.min(sw - 1, Math.max(0, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(u), x1 = Math.min(sw - 1, x0 + 1), tx = u - x0;
      const a = y0 * sw + x0, b = y0 * sw + x1, c = y1 * sw + x0, d = y1 * sw + x1;
      const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, wd = tx * ty;
      const i = y * w + x;
      detail[i] = an.detail[a] * wa + an.detail[b] * wb + an.detail[c] * wc + an.detail[d] * wd;
      coherence[i] = an.coherence[a] * wa + an.coherence[b] * wb + an.coherence[c] * wc + an.coherence[d] * wd;
      const cc = c2[a] * wa + c2[b] * wb + c2[c] * wc + c2[d] * wd;
      const ss = s2[a] * wa + s2[b] * wb + s2[c] * wc + s2[d] * wd;
      theta[i] = 0.5 * Math.atan2(ss, cc);
    }
  }
  size.set(sizeFromDetail(detail, p));
  return { w, h, detail, size, theta, coherence };
}
