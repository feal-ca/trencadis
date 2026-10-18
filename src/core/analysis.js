import { blur, luminance, normalizePercentile, sobel } from './image.js';

// Stage 0: the maps every tessellation reads.
//   detail    D(x) in [0,1], local high-frequency energy
//   size      s(x), desired shard diameter in working pixels
//   theta     edge tangent direction (radians, mod pi) from the structure tensor
//   coherence how strongly oriented the neighbourhood is, in [0,1]
//
// The maps are smooth (every blur has sigma >= 1), so large images are
// analysed at half resolution and interpolated back; p.exactAnalysis skips that.
export function analyze(img, p) {
  if (!p.exactAnalysis && img.w * img.h > 120000) {
    const half = analyzeLuminance(halveField(luminance(img), img.w, img.h), Math.ceil(img.w / 2), Math.ceil(img.h / 2), {
      ...p, detailSigma: p.detailSigma / 2, detailSmooth: p.detailSmooth / 2, tensorSigma: p.tensorSigma / 2, prefilter: 0.5,
    });
    return upsample(half, img.w, img.h);
  }
  return analyzeLuminance(luminance(img), img.w, img.h, p);
}

function analyzeLuminance(L, w, h, p) {
  const low = blur(L, w, h, p.detailSigma);
  const hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = Math.abs(L[i] - low[i]);
  const detail = normalizePercentile(blur(hf, w, h, p.detailSmooth));

  const size = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    size[i] = p.sMax - (p.sMax - p.sMin) * detail[i] ** p.gamma;
  }

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

  return { w, h, detail, size, theta, coherence };
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
function upsample(an, w, h) {
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
      size[i] = an.size[a] * wa + an.size[b] * wb + an.size[c] * wc + an.size[d] * wd;
      coherence[i] = an.coherence[a] * wa + an.coherence[b] * wb + an.coherence[c] * wc + an.coherence[d] * wd;
      const cc = c2[a] * wa + c2[b] * wb + c2[c] * wc + c2[d] * wd;
      const ss = s2[a] * wa + s2[b] * wb + s2[c] * wc + s2[d] * wd;
      theta[i] = 0.5 * Math.atan2(ss, cc);
    }
  }
  return { w, h, detail, size, theta, coherence };
}
