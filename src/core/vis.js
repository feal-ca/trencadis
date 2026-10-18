// Images for the intermediate stages. Uses OffscreenCanvas, so worker-only.
import { hslToRgb } from './image.js';

const RAMP = [[0.93, 0.94, 0.925], [0.43, 0.62, 0.84], [0.11, 0.3, 0.6], [0.086, 0.133, 0.231]];

function ramp(t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.floor(x), f = x - i;
  return RAMP[i].map((v, c) => v + (RAMP[i + 1][c] - v) * f);
}

function imageFromRgb(w, h, at) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = at(i);
    data[i * 4] = c[0] * 255; data[i * 4 + 1] = c[1] * 255; data[i * 4 + 2] = c[2] * 255; data[i * 4 + 3] = 255;
  }
  return new ImageData(data, w, h);
}

export const originalImage = (img) =>
  imageFromRgb(img.w, img.h, (i) => [img.rgb[i * 3], img.rgb[i * 3 + 1], img.rgb[i * 3 + 2]]);

export const detailImage = (an) => imageFromRgb(an.w, an.h, (i) => ramp(an.detail[i]));

export function sizeImage(an, p) {
  const span = Math.max(1e-6, p.sMax - p.sMin);
  return imageFromRgb(an.w, an.h, (i) => ramp(1 - (an.size[i] - p.sMin) / span));
}

// Hue encodes the edge tangent (mod pi), brightness the coherence.
export const orientationImage = (an) =>
  imageFromRgb(an.w, an.h, (i) => {
    const t = ((an.theta[i] % Math.PI) + Math.PI) % Math.PI;
    const c = Math.sqrt(an.coherence[i]);
    const [r, g, b] = hslToRgb(t / Math.PI, 0.75, 0.5);
    return [0.95 - (0.95 - r) * c, 0.95 - (0.95 - g) * c, 0.95 - (0.95 - b) * c];
  });

function faded(img, amount = 0.6) {
  const cv = new OffscreenCanvas(img.w, img.h);
  const ctx = cv.getContext('2d');
  ctx.putImageData(originalImage(img), 0, 0);
  ctx.fillStyle = `rgba(238,240,236,${amount})`;
  ctx.fillRect(0, 0, img.w, img.h);
  return { cv, ctx };
}

const path = (ctx, poly) => {
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
};

export function structureImage(img, tess) {
  const { structure, shards } = tess;
  if (structure.kind === 'cracks') {
    const { w, h } = img;
    const base = originalImage(img).data;
    return imageFromRgb(w, h, (i) =>
      structure.mask[i] ? [0.086, 0.133, 0.231] : [0.93 - (0.93 - base[i * 4] / 255) * 0.35, 0.94 - (0.94 - base[i * 4 + 1] / 255) * 0.35, 0.925 - (0.925 - base[i * 4 + 2] / 255) * 0.35]);
  }
  const { cv, ctx } = faded(img, 0.65);
  if (structure.kind === 'seeds') {
    ctx.fillStyle = '#1d4c9a';
    for (const [x, y] of structure.seeds) {
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const maxDepth = Math.max(1, ...shards.map((s) => s.depth || 0));
    for (const s of shards) {
      const c = ramp((s.depth || 0) / maxDepth);
      ctx.fillStyle = `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
      path(ctx, s.poly);
      ctx.fill();
    }
  }
  return ctx.getImageData(0, 0, img.w, img.h);
}

export function tessellationImage(img, tess) {
  const { cv, ctx } = faded(img, 0.45);
  ctx.strokeStyle = '#16223b';
  ctx.lineWidth = 0.8;
  ctx.lineJoin = 'round';
  for (const s of tess.shards) {
    path(ctx, s.poly);
    ctx.stroke();
  }
  return ctx.getImageData(0, 0, cv.width, cv.height);
}

export function flatImage(img, tess, colors, mortar = '#d9d5cb') {
  const cv = new OffscreenCanvas(img.w, img.h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, img.w, img.h);
  tess.shards.forEach((s, k) => {
    ctx.fillStyle = `rgb(${Math.round(colors[k * 3] * 255)},${Math.round(colors[k * 3 + 1] * 255)},${Math.round(colors[k * 3 + 2] * 255)})`;
    path(ctx, s.poly);
    ctx.fill();
  });
  return ctx.getImageData(0, 0, img.w, img.h);
}
