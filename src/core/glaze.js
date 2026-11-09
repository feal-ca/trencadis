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
