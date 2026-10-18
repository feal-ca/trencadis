import { Delaunay } from 'd3-delaunay';
import { combineGuides, drawnGuides, extractGuides, overlayRows } from './andamento.js';
import { growCracks } from './cracks.js';
import { fracture } from './fracture.js';
import { labelsToPolygons } from './polygonize.js';
import { labelAnisotropic, labelIsotropic, lloyd, poissonVariable } from './sampling.js';
import { slic } from './slic.js';
import { mergeSlivers } from './slivers.js';

// Every algorithm returns { shards, structure }:
//   shards     [{ poly, depth? }] in working-image pixels
//   structure  what to show in the "structure" stage:
//              { kind: 'seeds', seeds } | { kind: 'cracks', mask } | { kind: 'depth' }
//
// Rows along guide lines (automatic contours plus `guides`, the hand-drawn
// ones in normalised coordinates) are laid over whichever background.
export function tessellate(img, lab, an, p, rng, guides = null) {
  const base = tessellateBase(img, lab, an, p, rng);
  const drawn = drawnGuides(guides, an.w, an.h);
  const lines = combineGuides(drawn, extractGuides(img, an, p), an.w, an.h, p, an.size);
  if (!lines.length) return base;
  return {
    shards: overlayRows(base.shards, lines, an.w, an.h, p, an),
    structure: { kind: 'guides', guides: lines, drawn: drawn.length },
  };
}

function tessellateBase(img, lab, an, p, rng) {
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
