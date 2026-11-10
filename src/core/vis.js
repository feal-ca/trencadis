// Images for the intermediate stages. Uses OffscreenCanvas, so worker-only.

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
  const { structure } = tess;
  if (structure.kind === 'regions') {
    // Each region in its mean colour.
    const { w, h, rgb } = img, sum = new Float64Array(structure.count * 4);
    for (let i = 0; i < w * h; i++) {
      const r = structure.regions[i] * 4;
      sum[r]++; sum[r + 1] += rgb[i * 3]; sum[r + 2] += rgb[i * 3 + 1]; sum[r + 3] += rgb[i * 3 + 2];
    }
    return imageFromRgb(w, h, (i) => {
      const r = structure.regions[i] * 4;
      return [sum[r + 1] / sum[r], sum[r + 2] / sum[r], sum[r + 3] / sum[r]];
    });
  }
  return originalImage(img);
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
