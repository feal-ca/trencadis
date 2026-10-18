import earcut from 'earcut';
import { area } from '../core/polygon.js';

// Flat triangle list for all shards, largest first so a region enclosed by
// another paints on top. Each vertex carries its shard index.
export function triangulate(shards) {
  const order = shards.map((s, id) => [area(s.poly), id]).sort((a, b) => b[0] - a[0]);
  const pos = [], ids = [];
  for (const [, id] of order) {
    const poly = shards[id].poly;
    const flat = poly.flat();
    const tri = earcut(flat);
    for (const v of tri) {
      pos.push(flat[v * 2], flat[v * 2 + 1]);
      ids.push(id);
    }
  }
  return { positions: Float32Array.from(pos), ids: Float32Array.from(ids) };
}
