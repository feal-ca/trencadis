import { blur, luminance, normalizePercentile, sobel } from './image.js';

// Stage 0: the maps every tessellation reads.
//   detail    D(x) in [0,1], local high-frequency energy
//   size      s(x), desired shard diameter in working pixels
//   theta     edge tangent direction (radians, mod pi) from the structure tensor
//   coherence how strongly oriented the neighbourhood is, in [0,1]
export function analyze(img, p) {
  const { w, h } = img;
  const L = luminance(img);

  const low = blur(L, w, h, p.detailSigma);
  const hf = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hf[i] = Math.abs(L[i] - low[i]);
  const detail = normalizePercentile(blur(hf, w, h, p.detailSmooth));

  const size = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    size[i] = p.sMax - (p.sMax - p.sMin) * detail[i] ** p.gamma;
  }

  const { gx, gy } = sobel(blur(L, w, h, 1), w, h);
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
