import { centroid } from './polygon.js';
import { mulberry32 } from './rng.js';

// "Colocación a mano": every piece is turned, nudged and shrunk a little, as
// if laid one by one, so cuts no longer line up across neighbours. The GPU
// renderer applies the same formula in its vertex shader.
export const PLACE = { angle: 6, offset: 1.2, shrink: 0.06 }; // degrees, working px, fraction

// Per-piece unit randoms: a in [-1, 1] for the angle, (dx, dy) in the unit disc.
export function placementRandoms(n, seed) {
  const rng = mulberry32(seed * 104729 + 17);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(rng()), t = rng() * 2 * Math.PI;
    out[i] = { a: rng() * 2 - 1, dx: r * Math.cos(t), dy: r * Math.sin(t) };
  }
  return out;
}

export function placePolygon(poly, r, amount) {
  if (!amount) return poly;
  const [cx, cy] = centroid(poly);
  const s = 1 - PLACE.shrink * amount;
  const ang = (r.a * PLACE.angle * amount * Math.PI) / 180;
  const c = Math.cos(ang) * s, sn = Math.sin(ang) * s;
  const ox = cx + r.dx * PLACE.offset * amount, oy = cy + r.dy * PLACE.offset * amount;
  return poly.map(([x, y]) => [ox + c * (x - cx) - sn * (y - cy), oy + sn * (x - cx) + c * (y - cy)]);
}
