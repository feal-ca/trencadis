// Synthetic test photo: sky gradient, a sun, a dark hill and a striped flag.
export function syntheticImage(w = 240, h = 160) {
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c = [0.35 + 0.4 * (y / h), 0.6 + 0.2 * (y / h), 0.95];
      if ((x - 60) ** 2 + (y - 45) ** 2 < 400) c = [1, 0.85, 0.2];
      if (y > h * 0.65 + 12 * Math.sin(x / 25)) c = [0.15, 0.35, 0.12];
      if (x > 150 && x < 210 && y > 30 && y < 70) c = Math.floor((y - 30) / 8) % 2 ? [0.8, 0.1, 0.1] : [0.95, 0.8, 0.1];
      rgb.set(c, (y * w + x) * 3);
    }
  }
  return { w, h, rgb };
}

// A flat grey image: the size field is sMax everywhere.
export function flatImage(w, h) {
  const rgb = new Float32Array(w * h * 3).fill(0.5);
  return { w, h, rgb };
}

// Left half: bright speckles on dark (texture without direction).
// Right half: a single vertical edge (structure with a clear direction).
export function textureAndEdge(w = 240, h = 160) {
  const rgb = new Float32Array(w * h * 3);
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v;
      if (x < w / 2) v = rnd() < 0.08 ? 1 : 0.15;
      else v = x < (3 * w) / 4 ? 0.2 : 0.9;
      rgb.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
    }
  }
  return { w, h, rgb };
}

// A dark disc on a light background: one strong closed contour.
export function discImage(w = 240, h = 200, r = 60) {
  const rgb = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) < r ? 0.15 : 0.85;
    rgb.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3);
  }
  return { w, h, rgb };
}
