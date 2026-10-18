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
