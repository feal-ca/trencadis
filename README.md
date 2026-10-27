# Trencadís

[Español](README.es.md)

Trencadís turns a photo into a broken-tile mosaic, like the benches of Park Güell in Barcelona. Everything is computed in your browser, and the photo never leaves your device.

Try it at https://feal-ca.github.io/trencadis/

![Trencadís showing Vermeer's Girl with a Pearl Earring as a mosaic](docs/screenshot.jpg)

## How to use it

The app opens with a sample painting already converted. Load your own photo with "Subir foto", by dragging it onto the image, or by pasting it with Ctrl+V.

### The panel

The panel on the right starts simple:

- Styles at the top (Natural, Park Güell, Romano, Vitral) replace all settings in one click, and you can undo that.
- "Tipo de trozos" picks the cutting method. Two are shown, and "métodos más" reveals the other four.
- "Tamaño de los trozos", "Parecido a la foto" and "Brillo del esmalte" each move several parameters at once. "Ajustar a mano" shows those parameters separately, and "Volver al control simple" undoes that.
- The palette, the saturation and the grout color complete the basics.

### Shapes

On your own photo, a segmentation model (SlimSAM) finds the objects in it. With "Tocar una forma" you tap an eye, a face or a bird, and choose more or less detail for that shape. The three sample photos come with their shapes already computed, so they need no download.

### Rows (hileras)

Rows are rectangular pieces laid in a line, like the black spiral on Gaudí's benches. They come from the contours of the shapes the model found. There are no automatic edge rows. You can also draw your own lines with "Dibujar hileras", freehand or point by point, and with "Pegar al contorno" a line snaps to the strongest edge near the cursor. "Ver las líneas" shows every line in use, and "Quitar la última" and "Quitar todas" remove the ones you drew.

### More settings

The "Más ajustes" section holds the four steps of the algorithm, each with its own controls, a "¿Qué hace?" explanation with the formula, and "Ver este paso", which swaps the big image for that step's partial result: 1 Detalle, 2 Trozos, 3 Colores and 4 Acabado. The ⓘ icon next to a control explains it, and ↺ (it appears only after a change) restores its default.

### Viewer

The wheel zooms (Ctrl + wheel when a tool is active), dragging pans, and there are zoom buttons in the bar. "Otra versión ↻" draws a new random layout, and holding "Mantén para ver la original" shows the sharp original. Keyboard: R for another version, space to see the original, + − 0 for zoom, D to download, Ctrl+Z and Ctrl+Shift+Z for undo and redo.

### Export

Download PNG or JPG at the size you choose (the size option's tooltip gives the equivalent printed size), or share it on phones. The image carries a small signature that you can turn off. The finish (grout, placement, bevel, light, gloss) is drawn on the graphics card and responds instantly. Changes to detail, pieces or color are recomputed in the background.

## Privacy

- The photo is processed in your browser and is never uploaded.
- The segmentation model comes from Hugging Face and its ONNX runtime from jsDelivr. Both are downloaded the first time you search for shapes on your own photo (desktop with WebGPU starts on its own; phones and other browsers ask first). Neither request carries the photo.
- The last session (photo, shapes and lines) is saved in this browser with IndexedDB, so a reload brings it back. Settings go to localStorage.
- Those two downloads are the only requests the app makes to other sites.

## How it works

1. Detail. The high-frequency energy D(x) = |L − blur(L, σ)| is measured, smoothed and normalized. "Ignorar texturas" lowers it where the image is made of blobs: the Hessian determinant divided by the squared gradient is high on bright points, leaves and grass and almost zero along a contour. Shapes you set to more or less detail raise or lower it there. From it comes the piece size s(x) = s_max − (s_max − s_min)·D(x)^γ, and the structure tensor gives the edge direction θ(x). The blurs are three box-blur passes with the exact σ (Kovesi). On large images the maps are computed at half resolution and interpolated, because they are smooth.
2. Pieces. Six methods:
   - Straight cuts: the image is divided into irregular tiles (Voronoi) about 3.5 times the piece size, and each tile is split with straight lines until it reaches the requested size, so no cut crosses the image. At each cut, N lines are tried and one is picked with probability ∝ exp(−cost/T), where the cost is the color variance left in the two halves plus a penalty for slivers. This gives T-junctions, as in real broken tile.
   - Cracks: inspired by Jared Tarbell's *Substrate*. Each crack starts at an interior point far from other cracks and grows both ways until it hits another. Pieces narrower than the minimum width join the neighbor they share the most border with (the same is done for elongated tiles and color patches).
   - Rounded tiles: Voronoi with variable-radius Poisson-disk seeds (Bridson) and Lloyd relaxation weighted by 1/s(x)².
   - Elongated tiles: Voronoi with a metric stretched along the edges, as in Hausner (2001).
   - Split tiles: large rounded tiles that get a few straight cuts.
   - Color patches: SLIC superpixels with spacing taken from s(x) and borders simplified with Douglas-Peucker.
   - Rows, over any of the above. The guides come from the outlines between the objects the segmentation model found, plus the lines you draw. Your lines go first. Automatic ones are processed from longest to shortest, and any stretch that falls inside the band of another guide is dropped. The ends of your lines near an automatic one snap to it. The piece width is a fraction of the piece size in each zone, smoothed along the guide. For each pixel near a guide, the signed distance and the position along it give the row and the piece, with neighboring rows offset by half a piece. The background is rasterized, the rows overwrite it, each loose fragment becomes a piece, and very narrow ones join their neighbor in the background. Pieces that no row touches keep their original polygon. Where a piece would straddle two objects it is cut along their border.
3. Color. One color per piece (mean, most vivid, most frequent, median or the center one), with an optional palette (k-means of the photo, or a fixed set of workshop tiles) and a small random variation.
4. Finish. In WebGL2: pieces are triangulated with earcut and drawn by index, each slightly rotated, shifted and shrunk according to "Colocación a mano". A jump flood gives every pixel its distance to the nearest edge, and the last pass paints the grout, the bevel, the tilt of each piece and a Blinn-Phong highlight. If the browser has no WebGL2, the same finish is computed on the CPU.

## Development

```
npm ci
npm run dev                  # local server
npm test                     # Vitest
npm run lint                 # ESLint with the React hooks rules, no warnings allowed
npm run build                # static site in dist/
npm run smoke                # end-to-end check in Chromium of the built site
npm run golden:update        # rewrite test/golden.json (only when the geometry changes on purpose)
node scripts/check-dist.mjs  # fails if dist/ has a WASM file or weighs more than 3 MB
node scripts/shots.mjs       # screenshots of the build (desktop, phone, dark) in the temp folder
node scripts/sample-segments.mjs  # recompute the segments of the samples (public/samples/*.seg.png)
node scripts/seg-bytes.mjs   # measure what the first shape search downloads
node scripts/bench.mjs       # time per stage on a synthetic image
node scripts/thumbs.mjs      # regenerate the method thumbnails
```

The scripts that drive a browser use `/usr/bin/chromium-browser`, or the path in the `CHROMIUM` variable.

Query parameters for the app:

- `?debug` exposes `window.__trencadis` and records the timing of each run in `window.__runs`.
- `?nogl` skips WebGL2, to try the CPU path.
- `?samDevice=wasm` (or `webgpu`) forces the device the segmentation model runs on. `?segBatch=N` and `?segPoints=N` change its batch size and number of prompt points.

`test/golden.json` holds a hash of the geometry for each method with a fixed seed, so any unintended change shows up as a failing test. CI (`.github/workflows/ci.yml`) runs lint, tests, build, the dist size check and the smoke test; the deploy workflow calls it and publishes to GitHub Pages only if it passes.

The image code is in `src/core/` and does not depend on the DOM, except `vis.js`, which draws the stages with OffscreenCanvas. The shapes of the main data (Shard, Zone, Region, Parts, Segments) are documented as JSDoc in `src/core/types.js`. Computation runs in a Web Worker (`src/worker.js`), rendering in `src/gl/` and segmentation in `src/seg/`. The React interface is in `src/ui/`; the steps and their texts are in `src/ui/steps.js` and the help for each parameter in `src/core/params.js`. The interface is in Spanish for now.

## Credits

- The sample paintings are public domain and come from Wikimedia Commons: *Girl with a Pearl Earring* by Johannes Vermeer (c. 1665) and *The Starry Night* by Vincent van Gogh (1889). The boat photo is "El Guamache Bay, Margarita island", also from Wikimedia Commons, under a CC0 license.
- A. Hausner, "Simulating Decorative Mosaics", SIGGRAPH 2001.
- R. Achanta et al., "SLIC Superpixels Compared to State-of-the-Art Superpixel Methods", IEEE TPAMI 2012.
- J. Tarbell, *Substrate* (2003).
- R. Bridson, "Fast Poisson Disk Sampling in Arbitrary Dimensions", SIGGRAPH 2007 sketches.
- P. Kovesi, "Fast Almost-Gaussian Filtering", DICTA 2010.
- G. Rong and T.-S. Tan, "Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform", I3D 2006.
- P. Felzenszwalb and D. Huttenlocher, "Distance Transforms of Sampled Functions", 2012 (CPU render).

MIT license.
