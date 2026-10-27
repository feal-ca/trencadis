// Shapes of the data that moves between the core modules, as JSDoc typedefs.
// There is no code here. Editors pick the types up with
// `@type {import('./types.js').Shard}`; nothing imports this file at run time.

/**
 * One piece of the mosaic, in working-image pixels (tessellate.js).
 * @typedef {object} Shard
 * @property {number[][]} poly Corners as [x, y].
 * @property {number} [depth] Cut depth, set by the straight-cut method.
 * @property {boolean} [row] True for a piece laid along a guide line.
 * @property {boolean} [intent] True for a piece made inside a "more detail" shape (focus.js).
 */

/**
 * The pixels of a touched shape, in coordinates normalised to the photo (zones.js).
 * @typedef {object} Region
 * @property {number[]} box [u0, v0, u1, v1], where the mask sits.
 * @property {number} w Mask width in pixels.
 * @property {number} h Mask height in pixels.
 * @property {Uint8Array} data w * h mask, non-zero inside the shape.
 */

/**
 * The fine segmentation of a crop, used to cut a "more detail" shape (focus.js).
 * @typedef {object} Parts
 * @property {number[]} box [u0, v0, u1, v1], normalised, the crop this covers.
 * @property {number} w Label map width, at the crop's resolution.
 * @property {number} h Label map height.
 * @property {Int32Array} labels One label per pixel, -1 for no part.
 * @property {number} count Number of parts.
 */

/**
 * A touched shape (zones.js).
 * @typedef {object} Zone
 * @property {string} id
 * @property {'more' | 'less' | null} mode Null until the user picks one.
 * @property {Region | null} region
 * @property {Parts | null} parts Set for the "more" mode once the model has cut the shape.
 */

/**
 * The objects a segmentation model found in the photo (seglines.js).
 * @typedef {object} Segments
 * @property {number} w Label map width, at any resolution.
 * @property {number} h Label map height.
 * @property {Int32Array} labels One label per object, -1 for no object.
 */

export {};
