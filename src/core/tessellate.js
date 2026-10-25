import { Delaunay } from 'd3-delaunay';
import { combineGuides, edgeMap, eraseGuides, overlayRows } from './andamento.js';
import { growCracks } from './cracks.js';
import { fracture } from './fracture.js';
import { overlayFocus } from './focus.js';
import { labelsToPolygons } from './polygonize.js';
import { labelAnisotropic, labelIsotropic, lloyd, poissonVariable } from './sampling.js';
import { slic } from './slic.js';
import { mergeSlivers } from './slivers.js';
import { cutBySegments } from './segcuts.js';
import { segmentGuides } from './seglines.js';

// Every algorithm returns { shards, structure }:
//   shards     [{ poly, depth? }] in working-image pixels
//   structure  what to show in the "structure" stage:
//              { kind: 'seeds', seeds } | { kind: 'cracks', mask } | { kind: 'depth' }
//
// Rows along guide lines (the outlines of the objects in `segments` plus
// `guides`, the hand-drawn ones in normalised coordinates) are laid over
// whichever background. `segments` is { w, h, labels } from the segmentation
// model, or null; pieces that straddle two objects are cut along their
// border. The "more" zones in `zones` (zones.js) then get pieces with
// intention on top, from their parts.
export function tessellate(img, lab, an, p, rng, guides = null, segments = null, zones = null) {
  const rows = tessellateRows(img, lab, an, p, rng, guides, segments);
  const cut = segments ? cutBySegments(rows.shards, segments, an.w, an.h, p) : rows.shards;
  const partsList = (zones ?? []).filter((z) => z.mode === 'more' && z.parts).map((z) => z.parts);
  return { ...rows, shards: overlayFocus(cut, img, lab, an, p, rng, partsList) };
}

function tessellateRows(img, lab, an, p, rng, guides, segments) {
  const base = tessellateBase(img, lab, an, p, rng);
  const wantsEdges = (guides ?? []).some((g) => g.snap);
  const edges = wantsEdges ? edgeMap(img, p) : null;
  const { drawn, keep } = eraseGuides(guides, an.w, an.h, edges, p);
  const auto = segmentGuides(segments, an.w, an.h, p).filter(keep);
  const lines = combineGuides(drawn, auto, an.w, an.h, p, an.size);
  if (!lines.length) return base;
  return {
    shards: overlayRows(base.shards, lines, an.w, an.h, p, an),
    structure: { kind: 'guides', guides: lines, drawn: drawn.length },
  };
}

// The chosen method alone, without rows or cuts. Also fills the parts of a
// touched shape (focus.js), with a size field bounded by their thickness.
export function tessellateBase(img, lab, an, p, rng) {
  const { w, h } = an;
  const iso = (s) => labelIsotropic(s, w, h);
  switch (p.algorithm) {
    case 'voronoi': {
      const seeds = lloyd(poissonVariable(an, p.spacing, rng), an, p.lloydIters, p.lloydWeighted, iso);
      return { shards: voronoiCells(seeds, w, h), structure: { kind: 'seeds', seeds } };
    }
    case 'voronoi-aniso': {
      const aniso = (s) => labelAnisotropic(s, an, p.anisotropy);
      const seeds = lloyd(poissonVariable(an, p.spacing, rng), an, p.lloydIters, p.lloydWeighted, aniso);
      const shards = labelsToPolygons(mergeSlivers(aniso(seeds), w, h, an.size, p.minWidth), w, h, p.simplify);
      return { shards, structure: { kind: 'seeds', seeds } };
    }
    case 'fracture': {
      // Break a base of irregular tiles rather than the whole image, so no
      // cut can run further than one tile.
      const base = p.tileSize > 0
        ? voronoiCells(poissonVariable(an, p.tileSize, rng), w, h).map((s) => s.poly)
        : [[[0, 0], [w, 0], [w, h], [0, h]]];
      const shards = fracture(base, img, lab, an, p, rng);
      return { shards, structure: { kind: 'depth' } };
    }
    case 'hybrid': {
      const seeds = lloyd(poissonVariable(an, p.spacing * p.hybridSpacing, rng), an, p.lloydIters, p.lloydWeighted, iso);
      const cells = voronoiCells(seeds, w, h).map((s) => s.poly);
      const forced = cells.map(() => {
        let n = 0;
        for (let k = 0; k < p.hybridCuts; k++) if (rng() < p.hybridCutProb) n++;
        return n;
      });
      const shards = fracture(cells, img, lab, an, p, rng, { forced, bySize: false });
      return { shards, structure: { kind: 'seeds', seeds } };
    }
    case 'slic': {
      const seeds = poissonVariable(an, p.spacing, rng);
      const labels = slic(seeds, lab, an, p.compactness, p.slicIters);
      return { shards: labelsToPolygons(mergeSlivers(labels, w, h, an.size, p.minWidth), w, h, p.simplify), structure: { kind: 'seeds', seeds } };
    }
    case 'cracks': {
      const { mask, labels } = growCracks(an, p, rng);
      return { shards: labelsToPolygons(mergeSlivers(labels, w, h, an.size, p.minWidth), w, h, p.simplify), structure: { kind: 'cracks', mask } };
    }
    default:
      throw new Error(`Algoritmo desconocido: ${p.algorithm}`);
  }
}

function voronoiCells(seeds, w, h) {
  const v = Delaunay.from(seeds).voronoi([0, 0, w, h]);
  const out = [];
  for (let i = 0; i < seeds.length; i++) {
    const c = v.cellPolygon(i);
    if (c && c.length > 3) out.push({ poly: c.slice(0, -1) });
  }
  return out;
}
