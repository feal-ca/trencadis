// Float image helpers. An image is { w, h, rgb } with rgb a Float32Array of
// interleaved channels in [0, 1].

export function fromImageData({ width, height, data }) {
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    rgb[i * 3] = data[j] / 255;
    rgb[i * 3 + 1] = data[j + 1] / 255;
    rgb[i * 3 + 2] = data[j + 2] / 255;
  }
  return { w: width, h: height, rgb };
}

// Box-average resize so the long side is `long`; the same image if it fits.
// Each output pixel is the area-weighted mean of the source pixels it covers.
export function downscale(img, long) {
  const { w, h, rgb } = img;
  if (Math.max(w, h) <= long) return img;
  const s = long / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
  const rx = w / nw, ry = h / nh;
  // Columns first, into nw x h.
  const tmp = new Float32Array(nw * h * 3);
  for (let y = 0; y < h; y++) {
    for (let ox = 0; ox < nw; ox++) {
      const a = ox * rx, b = a + rx;
      const o = (y * nw + ox) * 3;
      for (let x = Math.floor(a); x < Math.min(w, Math.ceil(b)); x++) {
        const k = (Math.min(b, x + 1) - Math.max(a, x)) / rx;
        const i = (y * w + x) * 3;
        tmp[o] += rgb[i] * k;
        tmp[o + 1] += rgb[i + 1] * k;
        tmp[o + 2] += rgb[i + 2] * k;
      }
    }
  }
  const out = new Float32Array(nw * nh * 3);
  for (let oy = 0; oy < nh; oy++) {
    const a = oy * ry, b = a + ry;
    for (let y = Math.floor(a); y < Math.min(h, Math.ceil(b)); y++) {
      const k = (Math.min(b, y + 1) - Math.max(a, y)) / ry;
      for (let i = y * nw * 3, o = oy * nw * 3, e = i + nw * 3; i < e; i++, o++) out[o] += tmp[i] * k;
    }
  }
  return { w: nw, h: nh, rgb: out };
}

export function luminance(img) {
  const { w, h, rgb } = img;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  }
  return out;
}

function gaussKernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { k, r };
}

// Separable gaussian blur of a single-channel field, clamping at the borders.
// Kept as the reference for blur() and for very small sigmas.
export function gaussianBlur(src, w, h, sigma) {
  if (sigma <= 0) return Float32Array.from(src);
  const { k, r } = gaussKernel(sigma);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        s += src[row + xx] * k[i + r];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        s += tmp[yy * w + x] * k[i + r];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

// Widths of n box filters whose cascade has standard deviation sigma
// (Kovesi, "Fast almost-Gaussian filtering", 2010).
export function boxWidths(sigma, n = 3) {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

// One running-sum box pass over `len` samples spaced `stride` apart.
function boxLine(src, dst, start, stride, len, r) {
  const inv = 1 / (2 * r + 1);
  const at = (i) => src[start + (i < 0 ? 0 : i >= len ? len - 1 : i) * stride];
  let s = 0;
  for (let i = -r; i <= r; i++) s += at(i);
  for (let i = 0; i < len; i++) {
    dst[start + i * stride] = s * inv;
    s += at(i + r + 1) - at(i - r);
  }
}

// Almost-gaussian blur: three box passes per axis, cost independent of sigma.
// Stays within a few percent of the true gaussian (see test/image.test.js).
export function blur(src, w, h, sigma) {
  if (sigma <= 0) return Float32Array.from(src);
  if (sigma < 2) return gaussianBlur(src, w, h, sigma);
  const widths = boxWidths(sigma);
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  for (const bw of widths) {
    const r = (bw - 1) >> 1;
    for (let y = 0; y < h; y++) boxLine(a, b, y * w, 1, w, r);
    [a, b] = [b, a];
  }
  for (const bw of widths) {
    const r = (bw - 1) >> 1;
    for (let x = 0; x < w; x++) boxLine(a, b, x, w, h, r);
    [a, b] = [b, a];
  }
  return a;
}

export function sobel(g, w, h) {
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const at = (x, y) => g[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      gx[i] = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / 8;
      gy[i] = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)) / 8;
    }
  }
  return { gx, gy };
}

// Scale so the given percentile maps to 1, then clamp. Robust to a few hot
// pixels. The percentile comes from a 2048-bin histogram instead of a sort.
export function normalizePercentile(a, pct = 0.98) {
  let lo = Infinity, max = -Infinity;
  for (let i = 0; i < a.length; i++) {
    if (a[i] < lo) lo = a[i];
    if (a[i] > max) max = a[i];
  }
  const BINS = 2048, span = max - lo || 1e-6;
  const hist = new Uint32Array(BINS);
  for (let i = 0; i < a.length; i++) hist[Math.min(BINS - 1, ((a[i] - lo) / span) * BINS) | 0]++;
  const target = pct * a.length;
  let acc = 0, bin = 0;
  while (bin < BINS - 1 && acc + hist[bin] <= target) acc += hist[bin++];
  const hi = lo + ((bin + 1) / BINS) * span;
  const out = new Float32Array(a.length);
  const inv = 1 / (hi - lo || 1e-6);
  for (let i = 0; i < a.length; i++) out[i] = Math.min(1, Math.max(0, (a[i] - lo) * inv));
  return out;
}

// --- colour spaces -------------------------------------------------------

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fInv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export function rgbToLab(r, g, b, out = [0, 0, 0]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
  out[0] = 116 * fy - 16;
  out[1] = 500 * (fx - fy);
  out[2] = 200 * (fy - fz);
  return out;
}

export function labToRgb(L, a, b, out = [0, 0, 0]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const X = fInv(fx) * 0.95047, Y = fInv(fy), Z = fInv(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  out[0] = Math.min(1, Math.max(0, gam(Math.max(0, R))));
  out[1] = Math.min(1, Math.max(0, gam(Math.max(0, G))));
  out[2] = Math.min(1, Math.max(0, gam(Math.max(0, B))));
  return out;
}

export function toLab(img) {
  const { w, h, rgb } = img;
  const lab = new Float32Array(w * h * 3);
  const t = [0, 0, 0];
  for (let i = 0; i < w * h; i++) {
    rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2], t);
    lab[i * 3] = t[0];
    lab[i * 3 + 1] = t[1];
    lab[i * 3 + 2] = t[2];
  }
  return lab;
}

// sRGB <-> linear light, per channel. srgbToLinear reads a table with linear
// interpolation (error below 1e-6), since whole images go through it.
const LIN_STEPS = 1024;
const LIN_TABLE = Float32Array.from({ length: LIN_STEPS + 2 }, (_, i) => lin(Math.min(1, i / LIN_STEPS)));
export function srgbToLinear(c) {
  const x = (c <= 0 ? 0 : c >= 1 ? 1 : c) * LIN_STEPS;
  const i = x | 0;
  return LIN_TABLE[i] + (LIN_TABLE[i + 1] - LIN_TABLE[i]) * (x - i);
}
export const linearToSrgb = (c) => gam(Math.min(1, Math.max(0, c)));

// OKLab (Björn Ottosson, 2020) from linear-light sRGB: L in [0, 1], and a, b
// about ±0.3. Equal distances look about equally different, across hues too,
// which CIELab gets wrong for blues.
export function linearToOklab(r, g, b, out = [0, 0, 0]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return out;
}

// The inverse, to linear light. The result can fall outside [0, 1] when the
// colour is outside sRGB.
export function oklabToLinear(L, a, b, out = [0, 0, 0]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  out[0] = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  out[1] = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  out[2] = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return out;
}

export const rgbToOklab = (r, g, b, out = [0, 0, 0]) => linearToOklab(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), out);

const inGamut = (c) => c[0] >= -1e-4 && c[0] <= 1 + 1e-4 && c[1] >= -1e-4 && c[1] <= 1 + 1e-4 && c[2] >= -1e-4 && c[2] <= 1 + 1e-4;

// OKLab to sRGB in [0, 1]. A colour outside sRGB keeps its lightness and hue
// and loses chroma until it fits, so a strong saturation boost does not turn
// a hue into another one, as clipping each channel would.
export function oklabToRgb(L, a, b, out = [0, 0, 0]) {
  L = Math.min(1, Math.max(0, L));
  oklabToLinear(L, a, b, out);
  if (!inGamut(out)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
      const k = (lo + hi) / 2;
      if (inGamut(oklabToLinear(L, a * k, b * k, out))) lo = k;
      else hi = k;
    }
    oklabToLinear(L, a * lo, b * lo, out);
  }
  out[0] = linearToSrgb(out[0]);
  out[1] = linearToSrgb(out[1]);
  out[2] = linearToSrgb(out[2]);
  return out;
}

export function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue;
  if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return [hue / 6, s, l];
}

export function hslToRgb(hue, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(hue + 1 / 3), f(hue), f(hue - 1 / 3)];
}
