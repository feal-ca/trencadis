import { analyzeMaps } from './analysis.js';
import { growCracks } from './cracks.js';
import { makePieces } from './pieces.js';
import { labelsToPolygons } from './polygonize.js';
import { mergeSlivers } from './slivers.js';
import { structureOf, structureSize } from './structure.js';

// The four ways of laying pieces. All of them start from the structure of
// the photo (structure.js) and none lets a piece cross from one region into
// another, so the joints draw the outlines.
//   trencadis  broken tile: cells made convex and split with straight cuts
//   vitral     stained glass: few large panes, no cuts
//   romano     tesserae: small, even pieces in rows along the outlines
//   cracks     a slab cracked all over, the cracks bending along the edges
//
// Returns { shards, structure }: shards [{ poly }] in working pixels, and the
// regions for the "structure" view.
export function tessellate(img, p, rng) {
  const st = structureOf(img, p);
  const size = structureSize(st, p);
  return { shards: pieces(img, st, size, p, rng), structure: { kind: 'regions', regions: st.regions, count: st.count } };
}

function pieces(img, st, size, p, rng) {
  switch (p.algorithm) {
    case 'trencadis':
      return makePieces(st, size, p, rng, { cuts: p.pieceCuts });
    case 'vitral':
      return makePieces(st, size, p, rng, { coarse: 1.6, cuts: 0, lloyd: 2, rows: false, convex: false });
    case 'romano':
      return makePieces(st, size, p, rng, { coarse: 1.05, cuts: 0, lloyd: 3 });
    case 'cracks':
      return crackPieces(img, st, size, p, rng);
    default:
      throw new Error(`Método desconocido: ${p.algorithm}`);
  }
}

// Edge directions for the cracks, once per photo.
const mapsCache = new WeakMap();
function mapsOf(img, p) {
  let maps = mapsCache.get(img);
  if (!maps) {
    maps = analyzeMaps(img, p);
    mapsCache.set(img, maps);
  }
  return maps;
}

// Cracks grown over the whole photo, then cut along the region borders: a
// piece of crazed glaze that straddles two regions becomes two pieces.
function crackPieces(img, st, size, p, rng) {
  const { w, h, regions, count } = st;
  const { labels } = growCracks({ ...mapsOf(img, p), size }, p, rng);
  const ids = new Map(), group = [];
  for (let i = 0; i < w * h; i++) {
    const key = labels[i] * count + regions[i];
    let id = ids.get(key);
    if (id === undefined) { id = ids.size; ids.set(key, id); group.push(regions[i]); }
    labels[i] = id;
  }
  return labelsToPolygons(mergeSlivers(labels, w, h, size, p.minWidth, { group }), w, h, p.simplify);
}
