// Hit tests and overlay labels for a touched shape's pixels (`region`:
// { box: [u0, v0, u1, v1] normalised, w, h, data: Uint8Array(w*h) }).

// The region as a label function over a W x H overlay, sampled at pixel
// centres: 0 inside, -1 outside.
export function regionAt(region, W, H) {
  const [u0, v0, u1, v1] = region.box;
  const sx = region.w / ((u1 - u0) * W), sy = region.h / ((v1 - v0) * H);
  const ox = u0 * W, oy = v0 * H;
  return (x, y) => {
    const i = Math.floor((x + 0.5 - ox) * sx), j = Math.floor((y + 0.5 - oy) * sy);
    return i >= 0 && j >= 0 && i < region.w && j < region.h && region.data[j * region.w + i] ? 0 : -1;
  };
}

// The overlay pixels to scan for a region, with `r` pixels of margin.
export function regionBox(region, W, H, r) {
  const [u0, v0, u1, v1] = region.box;
  return [Math.floor(u0 * W) - r, Math.floor(v0 * H) - r, Math.ceil(u1 * W) + r, Math.ceil(v1 * H) + r];
}

// Whether the normalised point (u, v) falls on the region's pixels.
export function inside(region, u, v) {
  const [u0, v0, u1, v1] = region.box;
  const i = Math.floor(((u - u0) / (u1 - u0)) * region.w), j = Math.floor(((v - v0) / (v1 - v0)) * region.h);
  return i >= 0 && j >= 0 && i < region.w && j < region.h && !!region.data[j * region.w + i];
}
