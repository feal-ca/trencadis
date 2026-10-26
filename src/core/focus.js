// "Más detalle" on a touched shape: the parts the segmentation model found
// inside it are filled with the chosen method, with pieces about half as
// large as each part is thick (down to sMin / 2), and every border between
// parts is a piece edge.
import { overlayPieces } from './andamento.js';
import { area, rasterize } from './polygon.js';
import { labelsToPolygons } from './polygonize.js';
import { fillUnlabeled } from './slic.js';
import { mergeSlivers, regionWidths, splitComponents } from './slivers.js';
import { straightParts } from './straight.js';
import { tessellateBase } from './tessellate.js';

// `parts` is { box: [u0, v0, u1, v1] (normalised), w, h, labels, count }: the
// fine segmentation of a crop, at the crop's resolution (-1 = no part).
// Returns the same labels at working resolution (w x h), -1 outside the box,
// with straightened borders shared by both neighbours.
export function partMap(parts, w, h, eps) {
  const [u0, v0, u1, v1] = parts.box;
  const raw = new Int32Array(w * h).fill(-1);
  const xa = Math.max(0, Math.round(u0 * w)), xb = Math.min(w, Math.round(u1 * w));
  const ya = Math.max(0, Math.round(v0 * h)), yb = Math.min(h, Math.round(v1 * h));
  for (let y = ya; y < yb; y++) {
    const cy = Math.min(parts.h - 1, Math.floor((((y + 0.5) / h - v0) / (v1 - v0)) * parts.h));
    for (let x = xa; x < xb; x++) {
      const cx = Math.min(parts.w - 1, Math.floor((((x + 0.5) / w - u0) / (u1 - u0)) * parts.w));
      raw[y * w + x] = parts.labels[cy * parts.w + cx];
    }
  }
  // Larger parts first, so a part sitting in another's hole is drawn last.
  const rings = straightParts(raw, w, h, parts.count, eps)
    .sort((a, b) => area(b.outer) - area(a.outer));
  const labels = new Int32Array(w * h).fill(-1);
  for (const { label, outer, holes } of rings) {
    rasterize(outer, w, h, (x, y) => { labels[y * w + x] = label; });
    for (const hole of holes) {
      rasterize(hole, w, h, (x, y) => {
        if (labels[y * w + x] === label) labels[y * w + x] = -1;
      });
    }
  }
  return { labels, count: parts.count };
}

// The size field inside the parts: about half the part's thickness, so a
// part always splits into several pieces across, never above the usual
// piece size there and never below half the minimum piece (sMin / 2, the
// floor the user chose on 2026-10-26: "more" may go below sMin). Outside the
// parts the field is unchanged.
export function focusSize(an, labels, count, p) {
  const widths = regionWidths(labels, an.w, an.h);
  const floor = p.sMin / 2;
  const size = Float32Array.from(an.size);
  for (let i = 0; i < size.length; i++) {
    const l = labels[i];
    if (l >= 0) size[i] = Math.max(floor, Math.min(an.size[i], widths.get(l) / 2));
  }
  return size;
}

// The pieces of every "más" zone in `partsList`: the chosen method run with
// the part-bounded size field, each piece then cut along the part borders.
// All of it runs in a window around the zones (plus a margin of the largest
// piece), as nothing outside them is kept.
// Returns [{ poly, intent: true }] or null when there are no parts.
export function focusShards(img, lab, an, p, rng, partsList) {
  if (!partsList?.length) return null;
  const m = Math.ceil(p.sMax);
  const x0 = Math.max(0, Math.floor(Math.min(...partsList.map((z) => z.box[0])) * an.w) - m);
  const y0 = Math.max(0, Math.floor(Math.min(...partsList.map((z) => z.box[1])) * an.h) - m);
  const x1 = Math.min(an.w, Math.ceil(Math.max(...partsList.map((z) => z.box[2])) * an.w) + m);
  const y1 = Math.min(an.h, Math.ceil(Math.max(...partsList.map((z) => z.box[3])) * an.h) + m);
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const win = windowOf([x0, y0, w, h], an.w, an.h);
  // The zones' boxes, normalised to the window.
  const local = (z) => ({
    ...z,
    box: [(z.box[0] * an.w - x0) / w, (z.box[1] * an.h - y0) / h, (z.box[2] * an.w - x0) / w, (z.box[3] * an.h - y0) / h],
  });

  const parts = new Int32Array(w * h).fill(-1);
  let count = 0;
  for (const zone of partsList) {
    const z = partMap(local(zone), w, h, p.simplify);
    for (let i = 0; i < w * h; i++) if (z.labels[i] >= 0) parts[i] = count + z.labels[i];
    count += z.count;
  }
  if (!count || !parts.some((l) => l >= 0)) return null;

  const wan = { ...win.fields(an), w, h };
  const size = focusSize(wan, parts, count, p);
  const wimg = { w, h, rgb: win.crop(img.rgb, 3) };
  // The methods follow the size field; only the hybrid's forced cuts stop at
  // a size of p.sMin, so they get the same lower floor.
  const { shards } = tessellateBase(wimg, win.crop(lab, 3), { ...wan, size }, { ...p, sMin: p.sMin / 2 }, rng);
  // Every pixel gets the piece it falls in (larger pieces first, so smaller
  // ones stay on top); pixels no polygon reached take a neighbour's.
  const pieces = new Int32Array(w * h).fill(-1);
  const order = shards.map((s, id) => [area(s.poly), id]).sort((a, b) => b[0] - a[0]);
  for (const [, id] of order) rasterize(shards[id].poly, w, h, (x, y) => { pieces[y * w + x] = id; });
  fillUnlabeled(pieces, w, h);
  // A final piece is one connected run of the same (piece, part) pair.
  const pairs = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) pairs[i] = parts[i] < 0 || pieces[i] < 0 ? -1 : pieces[i] * count + parts[i];
  const { labels, origin } = splitComponents(pairs, w, h);
  // Slivers join a piece of their own part, so part borders stay edges.
  const group = origin.map((pair) => pair % count);
  const merged = mergeSlivers(labels, w, h, size, p.minWidth, { group });
  return labelsToPolygons(merged, w, h, p.simplify)
    .map(({ poly }) => ({ poly: poly.map(([x, y]) => [x + x0, y + y0]), intent: true }));
}

// Cropping per-pixel arrays of a W x H image to the window [x0, y0, w, h].
function windowOf([x0, y0, w, h], W, H) {
  const crop = (a, k = 1) => {
    const out = new a.constructor(w * h * k);
    for (let y = 0; y < h; y++) out.set(a.subarray(((y + y0) * W + x0) * k, ((y + y0) * W + x0 + w) * k), y * w * k);
    return out;
  };
  // Every per-pixel field of the analysis (detail, size, theta, ...).
  const fields = (an) => Object.fromEntries(Object.entries(an)
    .filter(([, v]) => ArrayBuffer.isView(v) && v.length === W * H)
    .map(([k, v]) => [k, crop(v)]));
  return { crop, fields };
}

// The background `shards` with the pieces of the "más" zones on top.
export function overlayFocus(shards, img, lab, an, p, rng, partsList) {
  if (!partsList?.length) return shards;
  const pieces = focusShards(img, lab, an, p, rng, partsList);
  if (!pieces?.length) return shards;
  const { w, h } = an;
  const extra = new Int32Array(w * h).fill(-1);
  const order = pieces.map((s, id) => [area(s.poly), id]).sort((a, b) => b[0] - a[0]);
  for (const [, id] of order) rasterize(pieces[id].poly, w, h, (x, y) => { extra[y * w + x] = id; });
  return overlayPieces(shards, extra, w, h, an, { intent: true }, 0.8, pieces.map((s) => s.poly), { onlyCut: true });
}
