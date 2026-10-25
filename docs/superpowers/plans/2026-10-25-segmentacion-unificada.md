# Segmentación unificada y panel simple: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sacar la segmentación del `?lab` y hacer un solo flujo: segmentación gruesa automática que da hileras y cortes, "Tocar una forma" con más o menos detalle (las partes finas se rellenan con el método elegido) y un panel simple de cinco controles.

**Architecture:** SlimSAM corre en su propio worker (`src/seg/`). Este hace la pasada gruesa, guarda la codificación de la imagen para los toques y segmenta en partes un recorte cuando se pide más detalle. El worker del pipeline recibe dos cosas: `segments` (mapa de objetos, para hileras y cortes) y `zones` (formas tocadas). Una zona "menos" calma el mapa de detalle. Una zona "más" lleva un mapa de partes y `src/core/focus.js` la rellena: ejecuta el método normal con un campo de tamaño ajustado al grosor de cada parte y lo intersecta con el mapa de partes, de modo que cada borde de parte es arista de pieza. La UI pierde el pincel de detalle, el de importancia, la comparación y `autoGuides`, y gana un indicador de progreso, la herramienta de forma y el borrado por pulsación larga en el lápiz.

**Tech Stack:** JavaScript (ESM), React 18, Vite, Vitest, Web Workers, `@huggingface/transformers@4.3.1` (SlimSAM `Xenova/slimsam-77-uniform`), `d3-delaunay`, Playwright (`playwright-core`) para los scripts de navegador, `coi-serviceworker` para GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-25-segmentacion-unificada-design.md`. Léelo entero antes de empezar. Este plan argumenta desde él.

## Global Constraints

- Todo el texto de la interfaz va en español, con el tono de los textos actuales. Las traducciones quedan fuera.
- El primer mosaico nunca espera a la segmentación. Debe salir tan rápido como hoy.
- Sin segmentación (rechazada, sin red, error del modelo) la app funciona como hoy sin hileras automáticas. Ningún error del modelo llega a `engine.error`.
- Modelo: `Xenova/slimsam-77-uniform`. WebGPU con `fp16` si hay `navigator.gpu`, si no o si falla, WASM con `q8`.
- Pasada gruesa: una codificación, unos 64 puntos de petición, sin recortes (`crops: 0`).
- En móvil (`TOUCH` de `useMedia.js`) o sin `navigator.gpu`, la segmentación no arranca sola: se pregunta. La respuesta se recuerda en `localStorage` (`trencadis.seg.v1`). En escritorio con WebGPU arranca sola.
- Una sola herramienta para poner y quitar, tanto en las formas (menú "Más detalle / Menos detalle / Quitar") como en el lápiz (quitar = mantener pulsado sobre una línea).
- Los comentarios siguen el estilo del código: inglés, frases completas, densidad parecida. Los mensajes de commit van en español, como los anteriores, y terminan con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prohibido resucitar las partes por color (Felzenszwalb + ΔE). `src/core/lab/intentional.js` se borra.
- Tras cada tarea: `npm test` en verde y `npx vite build` sin errores.

## Review Focus

1. **Foto nueva a mitad de una segmentación o de un toque.** Los resultados de la foto anterior se descartan y no tocan ni `segments` ni `zones` de la nueva. Lo cubre la Tarea 5 (`segSession` descarta ids viejos).
2. **Tocar antes de que la pasada gruesa termine o tras rechazar la descarga.** Tocar con la segmentación rechazada vuelve a preguntar. Tocar mientras se codifica la imagen espera a la codificación y no falla. Lo cubre la Tarea 5 (`segSession`).
3. **Cambiar de método, de estilo, de tamaño o de resolución de trabajo con zonas puestas.** Las zonas siguen en su sitio (coordenadas normalizadas) y se rellenan con el método nuevo. Lo cubre la Tarea 4 (test del pipeline con `workLong` distinto y método distinto).
4. **Sin red o con un error del modelo.** El indicador dice que no se ha podido y ofrece "Reintentar". La app sigue y `engine.error` queda vacío. Lo cubre la Tarea 5 (`segSession` con un worker que falla).
5. **Pulsación larga en táctil compitiendo con pellizcar o arrastrar.** Un segundo dedo o un movimiento de más de 6 px cancela la pulsación larga, que nunca borra durante un zoom. Lo cubre la Tarea 7 (`createLongPress`).

---

### Task 1: Segmentación fuera del lab, con progreso

**Files:**
- Create: `src/seg/sam.js` (mover desde `src/lab/sam.js` con `git mv`)
- Create: `src/seg/worker.js` (mover desde `src/lab/segment-worker.js` con `git mv`)
- Create: `src/seg/partition.js`
- Create: `test/seg.test.js`
- Modify: `lab/segment.js` (import nuevo; la página se borra en la Tarea 8), `scripts/lab-segment-shot.mjs` → `git mv` a `scripts/seg-shot.mjs`
- Modify: `src/ui/useEngine.js` (solo la URL del worker: `../seg/worker.js`)

**Interfaces:**
- Produces: `partition({ w, h, masks }) -> Int32Array` en `src/seg/partition.js` (sin dependencias del modelo, para poder testearla; `sam.js` la reexporta).
- Produces: `load(onProgress?: ({ loaded, total }) => void, log?)` en `sam.js`. Pasa `progress_callback` a `SamModel.from_pretrained` y `AutoProcessor.from_pretrained` y suma `loaded`/`total` de todos los archivos.
- Produces: `segmentEverything(image, outLong, { onBatch?: (done, total, found) => void })`, con `found` = candidatos que pasan iou y estabilidad hasta ese lote.
- Produces: protocolo del worker (`src/seg/worker.js`):
  - entrada `{ type: 'coarse', id, blob, device? }`
  - salidas `{ type: 'progress', id, phase: 'download' | 'encode' | 'decode', done, total, found? }`, `{ type: 'segments', id, segments: { w, h, labels }, count, ms }`, `{ type: 'error', id, message }`
- Valores: en el worker, `opts.crops = 0` y `opts.points = 64`.

- [ ] **Step 1: Test de `partition`.** `test/seg.test.js`, `it('each pixel takes the smallest mask covering it')`: dos máscaras 4×4, una grande que cubre todo y una de 2×2 dentro. Assert: los 4 píxeles de la pequeña tienen su índice, el resto el de la grande, y un píxel sin máscara da `-1` cuando la grande no cubre la fila 3.
- [ ] **Step 2:** `npx vitest run test/seg.test.js` → FAIL (no existe `src/seg/partition.js`).
- [ ] **Step 3:** `git mv` de los dos archivos. Saca `partition` a `partition.js`, añade `onProgress` y `onBatch` y deja el worker con el protocolo de arriba. Actualiza la URL del worker en `useEngine.js` y el import de `lab/segment.js`.
- [ ] **Step 4:** `npx vitest run test/seg.test.js` → PASS, y `npm test` en verde.
- [ ] **Step 5: Comprobación en navegador.** Adapta `scripts/seg-shot.mjs` para que abra la app con `?samDevice=wasm` (sigue necesitando `?lab` hasta la Tarea 5), recoja los mensajes `progress` desde la consola (añade un `console.log('[seg]', phase, done, total)` temporal en `useEngine`, que se quita en la Tarea 5) y termine con error si no ve al menos un `decode` y un `segments` con `count > 0`.
  Run: `CHROMIUM=/usr/bin/chromium-browser node scripts/seg-shot.mjs public/samples/vermeer.webp`
  Expected: líneas `progress download …`, `progress decode …` y al final `segments N` con N > 0, y salida 0. Apunta en el commit el tiempo total con 64 puntos.
- [ ] **Step 6: Commit** "La segmentación sale del lab: src/seg, progreso de descarga y de puntos, pasada gruesa de 64 puntos".

### Task 2: Hileras y cortes solo desde la segmentación; fuera `autoGuides` y el teselado por colores

**Files:**
- Create: `src/core/seglines.js` (`git mv src/core/lab/segguides.js`), `src/core/segcuts.js` (`git mv src/core/lab/segcuts.js`), `src/core/straight.js` (`git mv src/core/lab/straight.js`)
- Delete: `src/core/lab/intentional.js`, `test/lab/intentional.test.js`
- Move tests: `test/lab/segguides.test.js` → `test/seglines.test.js`, `test/lab/segcuts.test.js` → `test/segcuts.test.js`
- Modify: `src/core/tessellate.js`, `src/core/params.js`, `src/core/andamento.js`, `test/andamento.test.js`, `src/core/pipeline.js`, `src/ui/Panel.jsx` (quitar `<Param k="autoGuides">`, `LabTools` y las casillas `segGuides`/`segCuts` de `SegmentTools`)
- Modify: `src/core/macros.js`: el estilo Romano lleva `autoGuides: 0.5`. Quítalo.

**Interfaces:**
- Produces: `tessellate(img, lab, an, p, rng, guides = null, segments = null, zones = null) -> { shards, structure }`. El parámetro `zones` se usa a partir de la Tarea 4; aquí se acepta y se ignora. Las hileras automáticas salen solo de `segmentGuides(segments, …)`. Los cortes `cutBySegments` se aplican siempre que haya `segments`. `edgeMap` se calcula solo si alguna guía dibujada tiene `snap`.
- Produces: `straightParts(labels, w, h, count, eps)` sin cambios. `straightPieces` se borra de `straight.js` junto con lo que solo usaba ella.
- Removes from `params.js`: `autoGuides`, `segGuides`, `segCuts`, `intent`, `intentDE`, `intentAll`, `intentScale`, `intentRim`, `intentStraight` y el campo `lab` de `isVisible`. `LAB` se queda hasta la Tarea 8 porque la UI aún lo usa.
- Removes from `andamento.js`: `extractGuides` y lo que solo use ella. `edgeMap`, `combineGuides`, `eraseGuides`, `drawnGuides`, `overlayRows` y `overlayPieces` se quedan.
- `pipeline.js`: fuera `setImportant`, `calmImportant` y la etapa `compare`. `tessellate` se llama con `segments`.

- [ ] **Step 1: Ajusta tests.** En `test/andamento.test.js` borra los tests de `extractGuides`/`autoGuides` (líneas 17-35 y el de la línea 342 si solo prueba eso; si prueba hileras sobre un método, cámbialo a una guía dibujada). Añade a `test/seglines.test.js` `it('tessellate lays rows only along segment borders')`: con `syntheticImage()` y un `segments` disco, `tessellate(…, null, segments)` da `structure.kind === 'guides'`, y sin `segments` ni guías da otro `structure.kind`.
- [ ] **Step 2:** `npm test` → FAIL (la firma nueva de `tessellate` y los imports movidos).
- [ ] **Step 3:** Haz los movimientos y los borrados de arriba. Corrige los imports en `test/*.js` y `src/`.
- [ ] **Step 4:** `npm test` en verde y `npx vite build` sin errores. `grep -rn "autoGuides\|intentAll\|segGuides\|core/lab" src test` no da nada.
- [ ] **Step 5: Commit** "Hileras automáticas solo en los contornos de los objetos; fuera el teselado por colores del lab".

### Task 3: `focus.js`, partes rellenadas con el método elegido

**Files:**
- Create: `src/core/focus.js`
- Create: `test/focus.test.js`
- Modify: `src/core/tessellate.js` (exportar `tessellateBase`)

**Interfaces:**
- Consumes: `tessellateBase(img, lab, an, p, rng) -> { shards, structure }` (exportada), `straightParts`, `regionWidths(labels, w, h) -> Map<label, width>` (`slivers.js`), `splitComponents`, `mergeSlivers`, `labelsToPolygons`, `overlayPieces`, `rasterize`.
- Produces: `partMap(parts, w, h, eps) -> { labels: Int32Array, count }`. `parts` es `{ box: [u0, v0, u1, v1] (normalizado), w, h, labels: Int32Array, count }`, en la resolución del recorte. Lo remuestrea a la resolución de trabajo dentro de `box` (fuera queda `-1`), endereza los bordes con `straightParts(…, eps)` y vuelve a rasterizar los anillos (exterior menos agujeros).
- Produces: `focusSize(an, labels, count, sMin) -> Float32Array`: para cada píxel con parte, `max(sMin, min(an.size[i], width(parte)))`, y `an.size[i]` donde no hay parte.
- Produces: `focusShards(img, lab, an, p, rng, partsList) -> shards[] | null`: une los `partMap` de todas las zonas "más" (labels desplazados para no chocar) y llama a `tessellateBase` con `{ ...an, size: focusSize(…) }` y `p`. Pasa sus piezas a un mapa de etiquetas (rasteriza los polígonos, de mayor a menor área). La etiqueta final es el par (pieza, parte), con `splitComponents` y `mergeSlivers(…, an.size, p.minWidth)`; las fuera de parte valen `-1`. Traza con `labelsToPolygons(…, p.simplify)` y devuelve piezas `{ poly, intent: true }`.
- Produces: `overlayFocus(shards, img, lab, an, p, rng, partsList) -> shards[]`: el fondo con las piezas de `focusShards` encima, vía `overlayPieces(shards, extra, w, h, an, { intent: true }, 0.8, polys)`. Si `partsList` está vacía, devuelve `shards` tal cual.

- [ ] **Step 1: Tests.** En `test/focus.test.js`, una imagen de 240×160 con `flatImage` y unas `parts` sintéticas que cubren `box = [0.25, 0.25, 0.75, 0.75]` y tienen tres partes: un rectángulo grande, una barra de 4 px de ancho y un cuadrado de 3×3 px. Usa `analyze(img, toWorkPx(applyMacroDefaults(DEFAULTS)))`. Para cada `algorithm` de `ALGORITHMS`, con `it.each`:
  - `it('no piece crosses a part border (%s)')`: para cada pieza de `focusShards`, los píxeles de su parte minoritaria son ≤ 3 % de los suyos, sumados en todas las piezas.
  - `it('the thin bar gets pieces no wider than itself (%s)')`: toda pieza mayoritariamente en la barra tiene ≤ 6 px en su eje corto (bbox rotado o `regionWidths` de su raster).
  - `it('a part smaller than a minimum piece is one piece (%s)')`: exactamente 1 pieza cubre ≥ 80 % del cuadrado de 3×3.
  - `it('a large part is split into several pieces (%s)')`: más de 1 pieza en el rectángulo grande cuando su lado es ≥ 3 · `p.sMax`. Dimensiona el rectángulo para que lo cumpla.
  - `it('overlayFocus leaves pieces outside the zone untouched (%s)')`: toda pieza del fondo cuyo bbox no toca `box` aparece idéntica en el resultado.
  - `it('focusSize never goes below sMin')`.
- [ ] **Step 2:** `npx vitest run test/focus.test.js` → FAIL (no existe el módulo).
- [ ] **Step 3:** Implementa `src/core/focus.js` con las firmas de arriba y exporta `tessellateBase`. En `fracture`, si los cortes no convexos dan piezas raras, la intersección con el mapa de partes ya las recorta. No arregles `splitByLine` en esta tarea salvo que un test lo pida.
- [ ] **Step 4:** `npx vitest run test/focus.test.js` → PASS en los 6 métodos, y `npm test` en verde. Mide el tiempo de `focusShards` para una zona de 1/4 de la foto a 800 px de trabajo (`console.time` en el test, que se quita después) y apúntalo en el commit. Presupuesto: ≤ 400 ms con `fracture`.
- [ ] **Step 5: Commit** "Piezas con intención: las partes de una forma se rellenan con el método elegido y sus bordes son aristas".

### Task 4: Zonas en el pipeline y en el worker

**Files:**
- Create: `src/core/zones.js`
- Modify: `src/core/pipeline.js`, `src/core/tessellate.js`, `src/worker.js`
- Test: `test/pipeline.test.js`, `test/zones.test.js` (nuevo)

**Interfaces:**
- Consumes: `overlayFocus` (Tarea 3).
- Produces: el tipo `Zone = { id: number, mode: 'more' | 'less', region: { box: [u0, v0, u1, v1], w, h, data: Uint8Array }, parts: Parts | null }`, con coordenadas normalizadas a la foto.
- Produces: `zonesDetailMask(zones, w = 256, h = 256) -> { w, h, data: Float32Array } | null` en `zones.js`. Vale `-1` dentro de las zonas "less" y `0` en el resto, o `null` si no hay ninguna "less". Mismo formato y semántica que la máscara del pincel de detalle que consume `analyze`.
- Produces: en `createPipeline()`, `setZones(zones: Zone[] | null)` en lugar de `setMask`. La clave de la etapa `analysis` depende de la versión de zonas (por las "less") y la de `tessellation` también (por las "more").
- Produces: `tessellate(img, lab, an, p, rng, guides, segments, zones)`. Tras filas y cortes llama a `overlayFocus(…, zones.filter(z => z.mode === 'more' && z.parts).map(z => z.parts))`.
- Produces: el mensaje `{ type: 'zones', zones }` en `src/worker.js`, que sustituye a `mask` e `important`.

- [ ] **Step 1: Tests.** `test/zones.test.js`: `it('less zones become -1 in the detail mask')` (una zona "less" en `box [0, 0, 0.5, 1]` con `data` lleno de 1 da `-1` en la mitad izquierda de la máscara y `0` en la derecha), y `it('no less zone gives null')`. En `test/pipeline.test.js`:
  - `it('a less zone makes its pieces larger')`: el área media de las piezas dentro de la zona sube respecto a sin zona.
  - `it('a more zone adds intent pieces')`: hay piezas con `intent: true`.
  - `it('zones survive a change of working resolution and method')`: el mismo `Zone` con `workLong` 800 → 600 y `algorithm` `fracture` → `voronoi` sigue dando piezas `intent` dentro de su `box`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementa con las firmas de arriba. Quita `setMask` del pipeline y del worker.
- [ ] **Step 4:** `npm test` en verde.
- [ ] **Step 5: Commit** "Zonas tocadas en el pipeline: menos detalle calma el mapa, más detalle pone piezas con intención".

### Task 5: Sesión de segmentación en el motor: arranque, permiso, progreso, toques

**Files:**
- Create: `src/ui/segSession.js` (lógica pura, sin React, testeable)
- Create: `test/segSession.test.js`
- Modify: `src/seg/sam.js`, `src/seg/worker.js` (toques y partes), `src/ui/useEngine.js`

**Interfaces:**
- Produces (worker), nuevas entradas:
  - `{ type: 'pick', id, points: [[u, v, 1 | 0]] }` → `{ type: 'shape', id, region: { box, w, h, data } }`. Usa la codificación guardada de la pasada gruesa y toma, de las 3 máscaras, la de mayor `iou`. Si no hay codificación todavía, espera a la que está en curso.
  - `{ type: 'parts', id, region }` → `{ type: 'parts', id, parts: Parts }`. Recorta `region.box` con un margen del 15 %, lo codifica de nuevo y lanza una rejilla de ~48 puntos dentro de la región. Aplica `nms`, recorta a la región y hace `partition`, a la resolución del recorte (lado largo 256).
- Produces (sam.js): `embedImage(image)` (guarda `emb` y tamaños), `pickMask(points) -> region` y `segmentParts(image, region) -> Parts`.
- Produces: `startPolicy({ touch, webgpu, stored }) -> 'auto' | 'ask' | 'off'`, con `stored` de `trencadis.seg.v1`: `'yes'` → `'auto'`, `'no'` → `'off'`, si no `touch || !webgpu ? 'ask' : 'auto'`.
- Produces: `createSegSession({ post, onState, policy })` con `photo(blob)`, `accept()`, `decline()`, `retry()`, `pick(points) -> Promise<region>`, `parts(region) -> Promise<Parts>` y `receive(msg)`, y `state = { phase: 'idle' | 'ask' | 'off' | 'download' | 'encode' | 'decode' | 'done' | 'error', done?, total?, found?, ms? }`. Descarta todo mensaje con `id` anterior a la foto actual. Si `phase` es `'off'` o `'ask'`, `pick` pasa a `'ask'` y resuelve tras `accept()` (o rechaza tras `decline()`).
- Produces (engine): `seg` (el `state`), `segAccept`, `segDecline`, `segRetry` y `zones`, con `pickShape(u, v)`, `refineShape(id, u, v)`, `setZoneMode(id, mode)` y `removeZone(id)`. El historial guarda `{ params, macros, zones: [{ id, mode, points }] }` sin píxeles; los píxeles (`region`, `parts`) van en un `Map` por `id` fuera del historial. Deshacer y rehacer recomponen la lista que se envía al worker. Al cargar foto nueva, `zones` se vacía.
- Removes (engine): `detail` (`useMaskLayer` del pincel de detalle), `important`, `compareCanvas`, `compareRenderer` y `compare`. Borra `src/ui/useMaskLayer.js` si ya no lo usa nadie.

- [ ] **Step 1: Tests** en `test/segSession.test.js`, con un `post` falso que guarda los mensajes:
  - `startPolicy`: las 6 combinaciones relevantes (táctil o no, WebGPU o no, `stored` yes/no/ausente).
  - `it('drops results from a previous photo')`: `photo(a)`, `photo(b)`, `receive({ type: 'segments', id: <id de a> })` no cambia el `state` a `done`.
  - `it('a pick while declined asks again and resolves after accept')`.
  - `it('a pick during encode waits and resolves when the shape arrives')`.
  - `it('a worker error ends in phase error and retry starts again')`: tras `retry()` se envía otro `coarse`.
- [ ] **Step 2:** `npx vitest run test/segSession.test.js` → FAIL.
- [ ] **Step 3:** Implementa `segSession.js`. Luego `sam.js`/`worker.js` (toques y partes) y el cableado en `useEngine.js`. La segmentación arranca con `LAB` o sin él: quita el `if (!LAB …)`. Quita el `console.log('[seg]'…)` de la Tarea 1.
- [ ] **Step 4:** `npm test` en verde. En navegador: `scripts/seg-shot.mjs`, ahora sin `?lab`, simula un toque en el ojo de Vermeer. Con `page.evaluate` sobre una función `window.__trencadis` que solo existe con `?debug` y que expone `pickShape`/`setZoneMode`, llama `pickShape(0.42, 0.42)` y `setZoneMode(id, 'more')` y guarda captura. Expected: la captura muestra piezas más finas en la zona y el script sale 0. Ajusta las coordenadas del ojo mirando la muestra.
- [ ] **Step 5: Commit** "Segmentación en la app normal: arranque o permiso según el dispositivo, progreso y formas al tocar".

### Task 6: Panel simple

**Files:**
- Modify: `src/ui/Panel.jsx`, `src/ui/steps.js`, `src/styles.css`, `scripts/smoke.mjs`
- Create: `src/ui/SegStatus.jsx`

**Interfaces:**
- Consumes: `engine.seg`, `segAccept`, `segDecline`, `segRetry`, `zones` y `removeZone` (Tarea 5).
- Panel, de arriba abajo:
  1. `Styles`
  2. `AlgorithmPicker` (título "Tipo de trozos")
  3. `<Macro id="size">`
  4. `<Macro id="fidelity">`
  5. "Colores": `<Param k="palette">`, `<Param k="saturation">`
  6. "Acabado": `<Param k="groutColor">`, `<Macro id="gloss">`
  7. `ShapeTools`
  8. `RowTools`
  9. `<details className="more"><summary>Más ajustes</summary>` con las cuatro `Section` de hoy
  10. `ResetAll`
  11. `Export`
- `steps.js`: cada paso sustituye `simple` por `more`, los controles que solo salen en "Más ajustes" antes de sus parámetros avanzados: `detalle: [{ param: 'ignoreTexture' }]`, `trozos: [{ kind: 'reseed' }]`, `color: [{ param: 'colorMode' }]`, `acabado: [{ param: 'grout' }, { param: 'place' }, { param: 'lightAz' }]`. Los parámetros de `size`, `fidelity` y `gloss` se ocultan en los avanzados salvo con "Ajustar a mano", que es la regla `covered` de hoy aplicada a los macros del panel de arriba. La fórmula `pincel:` del paso Detalle pasa a `zonas con menos detalle: D × (1 + m)`.
- `ShapeTools`: un botón "Tocar una forma" que activa la herramienta `{ kind: 'shape' }` en el visor. Debajo, "N zonas · Quitar todas" cuando hay zonas, y una línea de ayuda: "Toca un ojo, una cara o un pájaro. Elige más o menos detalle en el menú que aparece".
- `RowTools`: un solo botón "Dibujar hileras" / "Terminar" (fuera "Borrar líneas"). La ayuda añade "Mantén pulsado sobre una línea para quitarla". Se mantienen "A mano / Por puntos", "Pegar al contorno", "Ver las líneas", "Deshacer", "Deshacer todo" y los ajustes de hileras.
- `SegStatus` (se pinta en el visor, Tarea 7, y se crea aquí), con estos textos:
  - `download`: "Descargando el modelo… N %"
  - `encode`: "Preparando la foto…"
  - `decode`: "Buscando las formas de la foto… N encontradas"
  - `ask`: "Buscar las formas de la foto: descarga de unos 10 MB la primera vez", con los botones "Buscar" y "Ahora no"
  - `error`: "No se han podido buscar las formas", con "Reintentar"
  - `done`: nada; muestra 2 s "N formas" y desaparece
  - `off`: nada; un enlace "Buscar formas" en `ShapeTools` llama a `segAccept`
  - Barra de progreso con `done / total` en `download` y `decode`.
- Fuera: `BrushTools`, `LabTools`, `SegmentTools` y el `kind: 'brush'` de `Controls`.

- [ ] **Step 1:** Actualiza `scripts/smoke.mjs`: "switch method" hace clic directamente en `.algo` "Grietas", que ya está arriba sin abrir sección. Añade `step('shape tool')`: clic en el botón "Tocar una forma" y comprueba que el visor tiene la clase `tool-shape`.
- [ ] **Step 2:** `npm run build && CHROMIUM=/usr/bin/chromium-browser npm run smoke` → FAIL en "shape tool".
- [ ] **Step 3:** Implementa el panel y `SegStatus` con los textos de arriba.
- [ ] **Step 4:** `npm test`, build y smoke en verde. Captura del panel en 1280×800 y 390×800 (como el script de Ko-fi de la sesión de diseño) y revísala: nada cortado, el panel cabe en móvil en la hoja.
- [ ] **Step 5: Commit** "Panel simple: estilos, cinco controles, formas, hileras y el resto plegado".

### Task 7: Visor: tocar formas, menú, pulsación larga, indicador

**Files:**
- Create: `src/ui/longPress.js`, `test/longPress.test.js`
- Create: `src/ui/ShapeLayer.jsx`
- Modify: `src/ui/Viewer.jsx`, `src/ui/App.jsx` (Ctrl+Z con `brush.kind === 'draw'` sigue con `undoGuide`; quita la rama de `important`), `src/styles.css`

**Interfaces:**
- Produces: `createLongPress({ delay = 450, slop = 6, onFire }) -> { down(id, x, y, t), move(id, x, y), up(id), cancel(), tick(t) }`. Dispara `onFire(x, y)` si un único puntero sigue abajo `delay` ms sin moverse más de `slop` px. Un segundo puntero o `cancel()` lo anula. Tras disparar, `up` devuelve `'fired'` para que la capa no lo trate como trazo ni como vértice.
- Produces: `nearestLine(lines, u, v, aspect, maxDist) -> { index, dist } | null` en `longPress.js`. Mide la distancia a polilíneas normalizadas, corrigiendo el aspecto de la imagen.
- `DrawLayer`: fuera el modo `erase`. Con la pulsación larga sobre `nearestLine(engine.lines.lines, …, tool.radius)` resalta esa línea en rojo mientras el dedo sigue abajo y, al soltar, `engine.addGuide({ erase: [[u, v]], radius: dist + 0.002 })`. Reutiliza `eraseGuides`: el radio justo toca solo la línea más cercana. Si el puntero se mueve antes de disparar, es un trazo normal.
- `ShapeLayer` (`tool.kind === 'shape'`):
  - el primer toque llama a `engine.pickShape(u, v)`, rellena la forma con color translúcido y contorno, y abre un menú DOM pegado al bbox con "Más detalle", "Menos detalle" y "Quitar";
  - un toque dentro de la forma seleccionada llama a `engine.refineShape(id, u, v)`;
  - un toque fuera elige otra forma;
  - dos dedos siguen siendo zoom y desplazamiento (el visor ya llama a `toolApi.cancel()`).
  Las zonas ya puestas se ven con contorno discontinuo mientras la herramienta está activa.
- `Viewer`: fuera `BrushLayer`, la comparación partida (`canSplit`, `compareHost`) y `zonesCanvas`. `SegStatus` se pinta abajo sobre la imagen. Mientras `seg.phase` es `decode` y justo al terminar, el contorno de los objetos encontrados se dibuja discontinuo y se desvanece a los 2 s de `done`.

- [ ] **Step 1: Tests** en `test/longPress.test.js`:
  - `it('fires after the delay without movement')`
  - `it('a move beyond slop cancels')`
  - `it('a second pointer cancels (pinch)')`
  - `it('up after firing reports fired')`
  - `it('nearestLine picks the closest of two parallel lines and respects maxDist')`
- [ ] **Step 2:** `npx vitest run test/longPress.test.js` → FAIL.
- [ ] **Step 3:** Implementa `longPress.js`, `ShapeLayer` y los cambios del visor.
- [ ] **Step 4:** `npm test`, build y smoke en verde. Con Playwright, simula una pulsación larga de 600 ms sobre una línea dibujada antes (`page.mouse.down`, espera, `up`) y comprueba que `engine.guides` gana una entrada `erase`. Usa `window.__trencadis` de `?debug`, que ya existe desde la Tarea 5, para leer `guides`. Captura en móvil (390×800) con la herramienta de forma activa y el menú abierto, y revísala.
- [ ] **Step 5: Commit** "Visor: tocar una forma con su menú, quitar líneas manteniendo pulsado y aviso de búsqueda de formas".

### Task 8: Fuera el lab, y GitHub Pages con hilos

**Files:**
- Delete: `lab/`, `scripts/lab-shot.mjs`, `scripts/lab-zones-shot.mjs`, `src/lab/` (debería estar vacío), la constante `LAB` y todo uso de `?lab`
- Create: `public/coi-serviceworker.js` (copiado de `node_modules/coi-serviceworker/coi-serviceworker.min.js`, con `coi-serviceworker@0.1.7` como devDependency)
- Modify: `index.html` (`<script src="./coi-serviceworker.js"></script>` antes del módulo principal, con `window.coi = { coepCredentialless: () => true }` en línea antes, para igualar el `credentialless` de dev), `vite.config.js` (el comentario `LAB` pasa a describir la app), `package.json`

- [ ] **Step 1:** `grep -rn "LAB\b\|?lab\|src/lab\|core/lab" src test scripts index.html vite.config.js` y apunta los usos.
- [ ] **Step 2:** Borra y limpia hasta que el grep no dé nada.
- [ ] **Step 3:** Añade `coi-serviceworker`. Comprueba con `npm run build && npx vite preview`, abriendo en Chromium (Playwright) con `crossOriginIsolated`: la primera carga recarga una vez y luego `self.crossOriginIsolated === true`. Si la recarga rompe el smoke, que el smoke espere a `crossOriginIsolated`.
- [ ] **Step 4:** `npm test`, build, `CHROMIUM=/usr/bin/chromium-browser npm run smoke` y `node scripts/seg-shot.mjs …`, todo en verde. Apunta tamaños de `dist/` (que el modelo no entra en el bundle).
- [ ] **Step 5: Commit** "Fuera el laboratorio; aislamiento entre orígenes en GitHub Pages para los hilos de WASM".

### Task 9: Medir en el portátil del usuario y afinar

Esta tarea la hace el usuario en su navegador (Chromium, iGPU Intel Gen12, WebGPU). El agente prepara y anota.

- [ ] **Step 1:** Añade `?debug` para que `segSession` vuelque en `window.__runs` los tiempos de `download`, `encode`, `decode` y `pick`, y `?segBatch=` y `?segPoints=` para probar valores sin recompilar.
- [ ] **Step 2:** Pide al usuario que cargue Vermeer y la foto de París (`~/Pictures/2026_9Septiembre_Paris/PXL_20260927_184146868.jpg`) con `segBatch` 16, 32 y 64 y `segPoints` 48 y 64, y que copie `window.__runs`.
- [ ] **Step 3:** Fija los valores por defecto con esos datos. Meta: pasada gruesa de unos pocos segundos con WebGPU. Que el toque responda en menos de 300 ms con la codificación ya hecha, y "Más detalle" en menos de 3 s.
- [ ] **Step 4: Commit** "Valores de segmentación medidos en un portátil con iGPU", con las cifras en el mensaje.
