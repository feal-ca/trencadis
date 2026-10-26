// Touched shapes ("zones"). A zone is
//   { id, mode: 'more' | 'less', region: { box, w, h, data }, parts: Parts | null }
// in coordinates normalised to the photo: `region.data` is a Uint8Array mask
// over `region.box` ([u0, v0, u1, v1]) at region.w x region.h, and `parts` is
// the zone cut into pieces for the "more" mode (see focus.js).

// The zones as a detail brush for `analyze`: { w, h, data } in [-1, 1], +1
// inside "more" zones (finer pieces), -1 inside "less" zones (calmer) and 0
// elsewhere, or null when no zone has a mode and a shape. Where a "more" and
// a "less" zone overlap, "more" wins: it is usually the smaller shape picked
// inside the larger one, and it gets pieces with intention there anyway.
export function zonesDetailMask(zones, w = 256, h = 256) {
  const touched = (zones ?? []).filter((z) => (z.mode === 'more' || z.mode === 'less') && z.region);
  if (!touched.length) return null;
  const data = new Float32Array(w * h);
  // "Less" first, so "more" overwrites it.
  for (const mode of ['less', 'more']) {
    const value = mode === 'more' ? 1 : -1;
    for (const { region } of touched.filter((z) => z.mode === mode)) paint(data, w, h, region, value);
  }
  return { w, h, data };
}

function paint(data, w, h, region, value) {
  const [u0, v0, u1, v1] = region.box;
  const x0 = Math.max(0, Math.floor(u0 * w)), x1 = Math.min(w, Math.ceil(u1 * w));
  const y0 = Math.max(0, Math.floor(v0 * h)), y1 = Math.min(h, Math.ceil(v1 * h));
  for (let y = y0; y < y1; y++) {
    const ry = Math.min(region.h - 1, Math.floor(((y + 0.5) / h - v0) / (v1 - v0) * region.h));
    if (ry < 0) continue;
    for (let x = x0; x < x1; x++) {
      const rx = Math.min(region.w - 1, Math.floor(((x + 0.5) / w - u0) / (u1 - u0) * region.w));
      if (rx >= 0 && region.data[ry * region.w + rx]) data[y * w + x] = value;
    }
  }
}
