import { area, centroid } from './polygon.js';

// Shared by the CPU finish (render.js) and the WebGL one (gl/shaders.js).

// Centroid and equivalent radius of each piece, in working px.
export function pieceShapes(shards) {
  return shards.map((s) => {
    const [cx, cy] = centroid(s.poly);
    return [cx, cy, Math.max(0.5, Math.sqrt(Math.abs(area(s.poly)) / Math.PI))];
  });
}

// How far the viewer is from the mosaic, in long sides. The highlight moves
// across the picture as it would in a photo of a wall, instead of every piece
// with the same tilt shining alike.
export const VIEW_DISTANCE = 1.5;

// Half the joint around a piece of equivalent radius r, in working px: in
// proportion to the piece, at most half of `grout`. A fixed joint fills an
// area of small pieces with mortar.
export const GROUT_MIN = 0.3;
export const groutHalf = (p, r) => 0.5 * Math.min(p.grout, Math.max(GROUT_MIN, (p.groutRel ?? 1e9) * r));

// The rounded edge of a piece, at most a fifth of its radius.
export const BEVEL_SHARE = 0.22;
export const bevelWidth = (p, r) => Math.max(1e-3, Math.min(p.bevel, BEVEL_SHARE * r));

// A broad, faint reflection on pieces tilted towards the light: zero on a
// flat piece, 1 on one that faces the half vector. `flat` is n.h of a flat piece.
export const SHEEN_POWER = 10;
export const softSheen = (ndh, flat) => {
  const f = flat ** SHEEN_POWER;
  return Math.max(0, ndh ** SHEEN_POWER - f) / Math.max(1e-3, 1 - f);
};
