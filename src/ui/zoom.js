import { clamp } from './geometry.js';

// The zoom { k, x, y } of the image in a w × h box after scaling by `factor`
// around the box point (px, py), which stays where it is. k stays in [1, 8]
// and the translation keeps the image covering the box.
export function zoomAt({ k, x, y }, factor, px, py, w, h) {
  const k2 = clamp(k * factor, 1, 8);
  const nx = px - ((px - x) * k2) / k, ny = py - ((py - y) * k2) / k;
  return { k: k2, x: clamp(nx, w * (1 - k2), 0), y: clamp(ny, h * (1 - k2), 0) };
}
