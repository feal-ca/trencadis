# Trencadís v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guided and direct UI with simple/advanced modes, real-time WebGL finish, faster analysis, Barcelona-flavoured calm look.

**Architecture:** The worker keeps analysis, tessellation and colour stats and sends shard polygons plus colours to the main thread. A WebGL2 renderer (id pass, jump flood, shading) draws the final mosaic in real time, with the existing CPU renderer as fallback. React views (entry, quick, steps) are driven by a declarative step/macro schema.

**Tech Stack:** Vite 8, React 19, d3-delaunay, earcut, WebGL2, Vitest, @fontsource/gloock, @fontsource-variable/figtree.

**Spec:** `docs/superpowers/specs/2026-10-18-trencadis-v2-design.md`

## Global Constraints

- Static site on GitHub Pages; no server.
- UI copy in Spanish, dry and descriptive, no slogans; param help follows «Más alto: …; más bajo: …».
- Colours: `#f7f6f2` background, `#25221e` text, `#6b655c` secondary; ceramic colours only in the trencadís strip and small details. Dark mode warm greys, never blue.
- Barcelona elements once each: chaflán on panels/buttons, panot de flor only in the upload box, Eixample grid only behind the image.
- No long scrolling control column.
- Targets (Vermeer, 800 px): finish ≥30 fps, colour <150 ms, preview tessellation <400 ms, full result <1.5 s.

## Review Focus

- A 12-megapixel phone photo: must be resized before analysis and the export clamped to `gl.MAX_TEXTURE_SIZE`; no crash.
- No WebGL2 (or context lost): the app falls back to the CPU render and still shows and exports a mosaic.
- Dragging a slider fast: results arrive in order; a stale run never overwrites a newer one.
- 60 000 shards: the colour data texture must be 2D (rows of 1024), not one row.
- A tiny image (64×64) with sMax larger than the image: pipeline still returns ≥1 shard.

---

### Task 1: Fast blur and percentile

**Files:**
- Modify: `src/core/image.js` (`blur`, `normalizePercentile`)
- Create: `scripts/bench.mjs`
- Test: `test/image.test.js`

**Interfaces:**
- Produces: `blur(src, w, h, sigma)` unchanged signature, now box-blur ×3 with Kovesi widths; `gaussianBlur(src, w, h, sigma)` kept for tests; `normalizePercentile(a, pct)` via 2048-bin histogram.

- [ ] Step 1: tests `box blur stays within 3% of gaussian` (σ ∈ {1, 2.5, 6} on random-noise + step image, max |box − gauss| < 0.03·range) and `percentile via histogram matches sort within 1/2048`; plus `tiny image 64x64 runs the pipeline` returning ≥1 shard.
- [ ] Step 2: run `npx vitest run test/image.test.js`, expect FAIL (`gaussianBlur` not exported).
- [ ] Step 3: implement; Kovesi: `wIdeal = sqrt(12σ²/n + 1)`, `wl` = largest odd ≤ wIdeal, `wu = wl + 2`, `m = round((12σ² − n·wl² − 4n·wl − 3n)/(−4wl − 4))`; running-sum box per row/column with clamped edges.
- [ ] Step 4: `scripts/bench.mjs` prints per-stage ms for each algorithm on `public/samples/vermeer.jpg` decoded… (Node has no JPEG decoder: use the synthetic image at 800×947). Run before and after; record both in the commit message.
- [ ] Step 5: all tests pass; commit.

### Task 2: Preview resolution

**Files:** Modify `src/core/pipeline.js`, `src/worker.js`; Test `test/pipeline.test.js`

**Interfaces:**
- Produces: `pipeline.setImage(img)` also builds `previewImg` (2× box downsample); `pipeline.run(p, onStage, isStale, yieldFn, onStart, { preview })`; with `preview: true` it uses `previewImg` and scales `sMin, sMax, grout, bevel` by 0.5; cache keys include the preview flag. Worker message `{ type:'run', id, params, preview }`.

- [ ] Step 1: tests `preview run uses half-size image` (render/analysis `w` equals ⌈w/2⌉) and `preview and full results are cached separately` (full run after preview recomputes, second full run does not).
- [ ] Step 2–4: fail, implement, pass.
- [ ] Step 5: commit.

### Task 3: Macros

**Files:** Create `src/core/macros.js`; Test `test/macros.test.js`

**Interfaces:**
- Produces: `MACROS` (ids `size`, `fidelity`, `gloss`); `applyMacro(params, id, value) -> params` (new object); `readMacro(params, id) -> number | null` (null = personalizado, i.e. no value reproduces the current params within 1e-3 relative); `STYLES` = 4 presets `{ id, label, params }` exactly as in the spec table.

- [ ] Step 1: tests: `size 0.4 gives sMin 7 and sMax 36`; `fidelity 1 on fracture gives T≈0.0501, edgeAlign 0.8, angleNoise 10, gamma 0.5`; `fidelity on slic sets compactness 40−34f`; `readMacro round-trips applyMacro for each id`; `manual edit makes readMacro null`.
- [ ] Step 2–4: fail, implement (fidelity mapping depends on `params.algorithm`; readMacro inverts using the γ term, then checks the algorithm-specific terms), pass.
- [ ] Step 5: commit.

### Task 4: WebGL2 renderer

**Files:** Create `src/gl/triangulate.js`, `src/gl/renderer.js`, `src/gl/shaders.js`; Test `test/triangulate.test.js`; add dependency `earcut`.

**Interfaces:**
- Produces: `triangulate(shards) -> { positions: Float32Array, ids: Float32Array }` (largest area first); `createRenderer(canvas) -> { setShards(shards, w, h), setColors(colors: Float32Array, seed), render(params, size?), toBlob(params, outLong) -> Promise<Blob>, ok: boolean }`.
- Shader params read: `grout, groutColor, groutShadow, bevel, bevelStrength, tilt, lightAz, lightEl, ambient, specular, shininess, glazeNoise, seed`. Lengths in working px, scaled by output/working.

- [ ] Step 1: test `triangulated area equals polygon area` for a convex and an L-shaped polygon; `ids follow area-descending order`.
- [ ] Step 2–4: fail, implement, pass.
- [ ] Step 5: renderer: id pass into RGBA8 (id+1 in 24 bits); seed pass; JFA ping-pong in RG32F (needs `EXT_color_buffer_float`, else `ok=false`); shade pass with `smoothstep(g−fw, g+fw, d)` AA, inward direction `(p − seed)/d` for bevel, per-shard colour/tilt from an RGBA32F texture of width 1024; clamp export size to `MAX_TEXTURE_SIZE`.
- [ ] Step 6: verify in headless Chromium: final view visible and 60 frames of `render` with changing `lightAz` measured; report fps.
- [ ] Step 7: commit.

### Task 5: Worker protocol and fallback

**Files:** Modify `src/worker.js`, `src/core/pipeline.js`

**Interfaces:**
- Produces: stage `color` message now also carries `shards` (polygons only) and `colors` (Float32Array, transferred copy); stage `render` runs only when the request has `cpuRender: true` (fallback), returning the image as before.

- [ ] Step 1: pipeline test `cpuRender false skips render stage`.
- [ ] Step 2–4: fail, implement, pass. Commit.

### Task 6: New UI

**Files:** Replace `src/ui/App.jsx`, `src/ui/Controls.jsx`, `src/styles.css`, `src/main.jsx`; create `src/ui/steps.js` (copy: titles, explanations, formulas, per-param help, simple controls per step), `src/ui/Home.jsx`, `src/ui/Quick.jsx`, `src/ui/Steps.jsx`, `src/ui/Viewer.jsx` (GL canvas for final, 2D canvas for stages), `src/ui/Param.jsx`, `src/ui/useEngine.js` (worker + renderer + debounced runs + preview while dragging), `public/styles/*.jpg`, `scripts/thumbs.mjs`.

**Interfaces:**
- Consumes: Tasks 2–5.
- `steps.js` exports `STEPS = [{ id, title, explanation, formula, views: [{ key, label }], simple: [controlSpec], advanced: [paramKey] }]`; `controlSpec` is `{ macro }`, `{ param }`, `{ kind:'algorithm' }`, `{ kind:'reseed' }` or `{ kind:'upload' }`.
- Param help lives next to the schema in `src/core/params.js` as `help` on each param.

- [ ] Step 1: write `steps.js` and `help` texts in the spec's tone.
- [ ] Step 2: routes `#/`, `#/rapido`, `#/pasos/<id>`; mode Simple/Avanzado persisted in localStorage (try/catch).
- [ ] Step 3: styles per spec (fonts, chaflán `clip-path`, panot SVG only in upload box, Eixample SVG only behind viewer, warm-grey dark mode).
- [ ] Step 4: slider `pointerdown…pointerup` sends `preview: true`; on release a full run.
- [ ] Step 5: thumbnails: `scripts/thumbs.mjs` renders the 4 styles from Vermeer through the app in headless Chromium and writes `public/styles/<id>.jpg`.
- [ ] Step 6: verify with headless screenshots: entry, quick, each step in simple and advanced, mobile 390 px, dark mode; no control column needs scrolling at 1440×900.
- [ ] Step 7: commit.

### Task 7: Measure, document, deploy

- [ ] Step 1: measure the four targets in headless Chromium and write them in the final report.
- [ ] Step 2: update README (humanizer), commit, push, confirm the Pages run succeeds and the live site renders.
