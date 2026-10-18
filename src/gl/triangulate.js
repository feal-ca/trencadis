import earcut from 'earcut';
import { area, centroid } from '../core/polygon.js';
import { placementRandoms } from '../core/placement.js';

// Flat triangle list for all shards, largest first so a region enclosed by
// another paints on top. Each vertex carries its shard index, the shard
// centroid and its placement randoms (see core/placement.js).
export function triangulate(shards, seed = 1) {
  const order = shards.map((s, id) => [area(s.poly), id]).sort((a, b) => b[0] - a[0]);
  const rand = placementRandoms(shards.length, seed);
  const pos = [], ids = [], centers = [], place = [];
  for (const [, id] of order) {
    const poly = shards[id].poly;
    const flat = poly.flat();
    const [cx, cy] = centroid(poly);
    const r = rand[id];
    for (const v of earcut(flat)) {
      pos.push(flat[v * 2], flat[v * 2 + 1]);
      ids.push(id);
      centers.push(cx, cy);
      place.push(r.a, r.dx, r.dy);
    }
  }
  return { positions: Float32Array.from(pos), ids: Float32Array.from(ids), centers: Float32Array.from(centers), place: Float32Array.from(place) };
}
