# Pulido antes del lanzamiento, fase 1: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar a la app los arreglos de robustez, eficiencia, móvil, limpieza y lanzamiento del repaso del 27-10-2026 sin cambiar la geometría de ningún mosaico.

**Architecture:** Primero una red de seguridad (hashes de la geometría por método) y la limpieza del núcleo. Después `src/ui/useEngine.js` se parte en hooks bajo `src/ui/engine/`, y sobre esa estructura van los arreglos de carga, render en CPU, contexto WebGL, build, segmentación de los ejemplos, cachés del pipeline, vista previa, historial y sesión guardada. Cierran la interfaz en móvil, la barra del visor, los detalles de lanzamiento y las herramientas del repositorio.

**Tech Stack:** JavaScript (ESM), React 19, Vite 8, Vitest 5, Web Workers, WebGL2, IndexedDB, `@huggingface/transformers@4.3.1` (SlimSAM), `playwright-core` para `scripts/smoke.mjs` y los demás scripts de navegador. ESLint 9 entra en la Tarea 16, solo en desarrollo.

**Spec:** `docs/superpowers/specs/2026-10-27-repaso.md`. Léelo entero antes de empezar. Este plan cubre los apartados 1 a 4 y 6 del repaso; los apartados 5 y 7 y la i18n quedan para las fases que se listan al final.

## Global Constraints

- Ninguna tarea cambia la geometría de los mosaicos. Los hashes de `test/golden.json` se escriben en la Tarea 1 y después no se tocan (`git diff --exit-code test/golden.json` al cerrar cada tarea).
- La foto no sale del dispositivo. Las únicas peticiones de red de la app siguen siendo el modelo (Hugging Face) y el runtime de ONNX (jsDelivr).
- Ninguna dependencia nueva de ejecución. En desarrollo solo se añaden `eslint`, `@eslint/js`, `eslint-plugin-react-hooks` y `globals` (Tarea 16).
- Los textos nuevos van en español con el tono de los actuales. Cuando el plan da un texto entre comillas, se usa tal cual. La traducción es la fase 2.
- Las claves nuevas de `localStorage` siguen el patrón `trencadis.<nombre>.v1`.
- El objeto que devuelve `useEngine()` conserva todas sus claves. Las tareas que añaden una lo dicen en Interfaces y actualizan la lista de `scripts/smoke.mjs` (Tarea 3).
- Comentarios en inglés, frases completas, con la densidad del código de alrededor. Commits en español, como los anteriores, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Al cerrar cada tarea: `npm test` en verde y `npm run build` sin errores. Si la tarea toca `src/ui/`, `src/gl/`, `src/worker.js` o `src/seg/`, también `CHROMIUM=/usr/bin/chromium-browser npm run smoke`.
- Borrar ramas, empujar o desplegar solo con confirmación del usuario en ese momento.

## Review Focus

1. Una foto enorme o muy apaisada en un móvil (48 MP, o 12000×2000) se decodifica, se reduce a 3200 px de lado largo y el bitmap original se libera. Tarea 4: `fitLong` con panorámicas.
2. Una sesión guardada por otra versión, a medias o corrupta: la app arranca con el ejemplo y sin mensaje de error. Tarea 12: `fromSnapshot` devuelve `null`.
3. El contexto WebGL se pierde con un mosaico en pantalla: la vista pasa a la CPU sin quedarse en blanco y la descarga funciona. Tarea 6: paso del smoke con `WEBGL_lose_context`.
4. Un ejemplo con segmentación precalculada, en un móvil (política `ask`), y el usuario toca una forma: se le pregunta, y al aceptar se descarga el modelo, se codifica la foto y el toque obtiene su forma. Tarea 8: test de `segSession`.
5. Deshacer después de cambiar de foto no devuelve líneas ni zonas de la foto anterior. Tarea 11: test de `ownState`.

---

### Task 1: Hashes de referencia de la geometría por método

Es la red de seguridad de las tareas siguientes, que reorganizan código sin querer cambiar ningún mosaico.

**Files:**
- Create: `test/golden.test.js`, `test/golden.json`
- Modify: `package.json` (script `golden:update`)

**Interfaces:**
- Produces: `test/golden.json` = `{ "<algorithm>": "<hash>", "<algorithm>+rows": "<hash>", "<algorithm>+seg": "<hash>" }` para los seis valores de `ALGORITHMS`.

- [ ] **Step 1: Escribe `test/golden.test.js`.** `geometryHash(shards)` es local al test: FNV-1a de 32 bits en hexadecimal sobre, por cada pieza en orden, sus vértices redondeados a centésimas (`Math.round(v * 100)`), un separador y los flags `row` e `intent`. Para cada algoritmo, tres casos con `syntheticImage(240, 160)`, `{ ...applyMacroDefaults(DEFAULTS), algorithm, seed: 7 }` y `createPipeline()` (las piezas salen de `onStage('tessellation', value)`):
  - sin nada más (`<algorithm>`);
  - con `setGuides([{ points: [[0.1, 0.5], [0.9, 0.5]], mode: 'points', snap: false }])` (`<algorithm>+rows`);
  - con `setSegments` de un disco (el mismo que `discSegments()` de `test/seglines.test.js`, a 60×40) y `setZones` con una zona `{ id: 'z1', mode: 'more', region, parts }`, donde `region` es ese disco recortado a su caja y `parts` sus dos mitades, izquierda y derecha (`count: 2`), a 64×64 sobre la misma caja (`<algorithm>+seg`).

  `it.each` compara con `test/golden.json`. Con `process.env.UPDATE_GOLDEN` definido, escribe el fichero en lugar de comparar.
- [ ] **Step 2:** `UPDATE_GOLDEN=1 npx vitest run test/golden.test.js` escribe los 18 hashes. Después, `npx vitest run test/golden.test.js` dos veces → PASS las dos. Si un hash cambia entre ejecuciones, hay azar sin semilla: busca la causa antes de seguir.
- [ ] **Step 3:** Añade `"golden:update": "UPDATE_GOLDEN=1 vitest run test/golden.test.js"` a `package.json`.
- [ ] **Step 4: Commit** "Hashes de referencia de la geometría de cada método, con hileras, cortes y zonas".

### Task 2: Limpieza del núcleo y de la UI

**Files:**
- Modify: `src/core/polygon.js`, `src/core/straight.js`, `src/core/polygonize.js`, `src/seg/sam.js`, `src/worker.js`, `src/ui/steps.js`, `src/styles.css`, `src/ui/Viewer.jsx`, `src/ui/ShapeLayer.jsx`
- Create: `src/ui/geometry.js`, `test/polygon.test.js`, `test/geometry.test.js`

**Interfaces:**
- Produces: `douglasPeucker(pts: [x, y][], eps: number) -> [x, y][]`, exportada de `polygon.js`. Cuando los extremos coinciden mide la distancia al punto, como la copia de `straight.js`. `simplifyClosed` y `straight.js` la usan y las dos funciones `dp` desaparecen.
- Produces: `traceLoops(labels, w, h, l, [xa, ya, xb, yb]) -> number[][]`, exportada de `polygonize.js`: todos los anillos del contorno de la etiqueta `l`, como ids de esquina `y * (w + 1) + x`, con 4 esquinas o más. `straight.js` la importa y `traceLabel` se queda con el anillo de mayor área.
- Produces: `src/ui/geometry.js` con `clamp(v, a, b)` y `pointerToUV(canvas, { clientX, clientY }) -> [u, v]`, sin recortar a [0, 1], para un lienzo dibujado con `object-fit: contain`. `DrawLayer` recorta su resultado; `ShapeLayer` no, porque descarta los toques fuera de la imagen.
- Removes: de `sam.js`, `opts.crops`, `opts.cropPoints`, `detailIn`, el bucle de recortes y la clave `crops` del resultado de `segmentEverything`; `stepById` de `steps.js`; `.panel-title` y `.brush-links` de `styles.css`; `pipe.lastTess` de `worker.js`, que pasa a usar `pipe.cached('tessellation')`.

- [ ] **Step 1: Tests.** `test/polygon.test.js`: `it('douglasPeucker collapses a straight run to its ends')`, `it('douglasPeucker keeps the farthest point of a closed run')` (extremos iguales, un punto lejano en medio: el resultado lo conserva), `it('douglasPeucker with eps 0 keeps every point')`. `test/geometry.test.js`: con un lienzo falso `{ width: 200, height: 100, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }) }`, el centro de la caja da `[0.5, 0.5]` y un punto en la franja vacía de arriba da `v < 0`.
- [ ] **Step 2:** `npx vitest run test/polygon.test.js test/geometry.test.js` → FAIL (no existen los exports).
- [ ] **Step 3:** Haz los cambios de Interfaces.
- [ ] **Step 4:** `npm test` en verde, golden incluido. `grep -rn "function dp\|lastTess\|stepById\|cropPoints\|panel-title\|brush-links" src` no da nada. `npm run build` sin errores y smoke en verde.
- [ ] **Step 5: Commit** "Limpieza: un solo Douglas-Peucker y un solo trazado de contornos; fuera los recortes de SAM y el código muerto".

### Task 3: `useEngine` partido en hooks

**Files:**
- Create: `src/ui/engine/useSettings.js`, `src/ui/engine/usePipeline.js`, `src/ui/engine/useSegmentation.js`, `src/ui/engine/useZones.js`, `src/ui/engine/useGuides.js`, `src/ui/engine/useHistory.js`, `src/ui/engine/useExport.js`
- Modify: `src/ui/useEngine.js` (solo compone), `scripts/smoke.mjs`

**Interfaces:**
- Cada hook recibe por argumentos lo que necesita de los anteriores; nada de contexto de React ni de estado global. Orden de composición en `useEngine`: settings → pipeline → segmentation → zones → guides → history → export.
- `useSettings()`: `params`, `macros`, `effective` (con el mortero automático resuelto), `autoGrout`/`setAutoGrout`, `setParam`, `style`, `setStyle`, `setMacro`, `setManual`, `resetAll`, `restore`, `isDefault`, y la persistencia en `trencadis.params.v2` y `trencadis.macros.v1` como hoy.
- `usePipeline(effective)`: el worker del pipeline, el renderer y `glCanvas`, `gpu`, `bitmap`/`setBitmap`, `readable`, `images`, `labels`, `busy`, `info`, `error`/`setError`, `mosaicReady`, `lines`, `post`, `rerun`, `requestRender`, `setWanted`, `setViewport`.
- `useSegmentation({ bitmap, readable, worker, rerun })`: `seg`, `segments`, la sesión (ref), `segAccept`, `segDecline`, `segRetry`.
- `useZones({ session, worker, rerun, seg, photoGen })`: `zones` en bruto y `zonesView`, `zonePixels` (ref), `pickShape`, `refineShape`, `setZoneMode`, `removeZone`, `resetZones()`.
- `useGuides({ worker, post, effectiveRef })`: `guides`, `addGuide`, `clearGuides`, `undoGuide`, `resetGuides()`.
- `useHistory({ state, apply })`: `undo`, `redo`, `canUndo`, `canRedo`, con el mismo funcionamiento de hoy (un paso cuando los cambios paran 500 ms).
- `useExport({ renderer, effectiveRef, images, requestRender })`: `download`, `share`.
- `photoGen` (ref) vive en `useEngine` y lo comparten zonas y, desde la Tarea 11, líneas. `loadBlob` y `loadSample` se quedan en `useEngine`, que llama a los `reset*` de cada hook.

- [ ] **Step 1: Fija la API en el smoke.** Cambia la URL del smoke a `/?debug` y añade al paso `load` una comprobación de que `Object.keys(window.__trencadis).sort()` es igual a esta lista (constante `API_KEYS` del script): `addGuide autoGrout bitmap busy canRedo canUndo clearGuides download error estimate glCanvas gpu guides hasImage images info isDefault labels lines loadBlob loadSample macros mosaicReady params pickShape redo refineShape removeZone resetAll restore seg segAccept segDecline segRetry segments setMacro setManual setParam setParams setStyle setViewport setWanted setZoneMode share style undo undoGuide zones`.
- [ ] **Step 2:** `npm run build && CHROMIUM=/usr/bin/chromium-browser npm run smoke` → PASS antes de tocar nada (confirma que la lista es la de hoy).
- [ ] **Step 3:** Mueve el código a los hooks sin cambiar su comportamiento.
- [ ] **Step 4:** `npm test`, build y smoke en verde. `CHROMIUM=/usr/bin/chromium-browser node scripts/seg-shot.mjs` sale con 0. `wc -l src/ui/useEngine.js` ≤ 130 y cada hook ≤ 220 líneas.
- [ ] **Step 5: Commit** "useEngine se reparte en hooks: ajustes, pipeline, segmentación, zonas, líneas, historial y exportación".

### Task 4: Carga robusta de fotos

**Files:**
- Create: `src/ui/photo.js`, `src/ui/useWindowDrop.js`, `test/photo.test.js`
- Modify: `src/ui/useEngine.js`, `src/ui/App.jsx`, `src/ui/Viewer.jsx`, `src/ui/engine/useExport.js`, `scripts/smoke.mjs`

**Interfaces:**
- Produces en `photo.js`: `MAX_PHOTO_LONG = 3200`; `fitLong(w, h, maxLong) -> [w, h]` (redondeado, mínimo 1, igual si ya cabe); `decodePhoto(blob) -> Promise<ImageBitmap>` (decodifica con `imageOrientation: 'from-image'`; si el lado largo pasa de `MAX_PHOTO_LONG`, crea otro bitmap con `resizeWidth`, `resizeHeight` y `resizeQuality: 'high'` y cierra el primero con `close()`); `isImage(file) -> boolean` (tipo `image/*`, o nombre acabado en `.heic`/`.heif` para que llegue al aviso de HEIC que ya existe); `photoName(file) -> string` (nombre sin extensión; cada tramo de caracteres fuera de `[\p{L}\p{N}_-]` pasa a `-`; sin guiones en los extremos; máximo 40 caracteres; `'foto'` si queda vacío).
- Produces: `useWindowDrop(onFile) -> boolean` (si hay un arrastre encima). Escucha `dragenter`, `dragover`, `dragleave` y `drop` en `window` con un contador de profundidad, cancela siempre el comportamiento por defecto del `drop` y llama a `onFile` con el primer fichero. `App` le pasa el resultado a `Viewer` como prop `dropping`, y `Viewer` pierde sus manejadores de arrastre.
- Produces: la clave `photoName` en la API (los ejemplos usan su etiqueta: `vermeer`, `van-gogh`, `barcas`). El fichero exportado se llama `trencadis-${photoName}-${algorithm}-${seed}.${ext}`.
- Textos de error: un archivo que no es imagen da «Ese archivo no es una imagen. Prueba con un JPG o un PNG.» y un ejemplo que no carga da «No se ha podido cargar el ejemplo. Comprueba la conexión y vuelve a probar.»

- [ ] **Step 1: Tests** en `test/photo.test.js`: `fitLong(4000, 3000, 3200)` → `[3200, 2400]`; `fitLong(12000, 2000, 3200)` → `[3200, 533]`; `fitLong(800, 600, 3200)` → `[800, 600]`; `fitLong(1, 9000, 3200)` → `[1, 3200]`. `photoName({ name: 'IMG_1234.HEIC' })` → `'IMG_1234'`; `'mi foto (1).jpg'` → `'mi-foto-1'`; `'Ñandú.png'` → `'Ñandú'`; un blob sin nombre → `'foto'`. `isImage` acepta `{ type: 'image/webp' }` y `{ type: '', name: 'a.HEIC' }` y rechaza `{ type: 'application/pdf', name: 'a.pdf' }`.
- [ ] **Step 2:** `npx vitest run test/photo.test.js` → FAIL.
- [ ] **Step 3:** Implementa `photo.js` y `useWindowDrop.js`; `loadBlob` usa `isImage`, `decodePhoto` y `photoName`; `loadSample` captura cualquier error y muestra su texto.
- [ ] **Step 4: Smoke.** Añade `photoName` a `API_KEYS`. Nuevo paso `drop on the panel`: crea con `page.evaluateHandle` un `DataTransfer` con `public/samples/barcas.webp` (en base64), lanza `dragenter`, `dragover` y `drop` sobre `.side` y espera a que esté listo; el paso `download` comprueba que `suggestedFilename()` empieza por `trencadis-barcas-`. Nuevo paso `sample offline`: `page.route('**/samples/vangogh.webp', (r) => r.abort())`, clic en «Van Gogh», `.status .err` contiene «No se ha podido cargar el ejemplo»; después `unroute`.
- [ ] **Step 5:** `npm test`, build y smoke en verde.
- [ ] **Step 6: Commit** "Fotos: soltar en cualquier parte, error si el ejemplo no carga, fotos grandes reducidas a 3200 px y nombre de la foto en la descarga".

### Task 5: Render en CPU a tamaño de pantalla y exportación aparte

**Files:**
- Modify: `src/core/render.js`, `src/core/pipeline.js`, `src/worker.js`, `src/ui/engine/usePipeline.js`, `src/ui/engine/useExport.js`, `scripts/smoke.mjs`
- Create: `test/render.test.js`
- Test: `test/pipeline.test.js`

**Interfaces:**
- Produces: `renderMosaic(shards, colors, w, h, p, long = p.outLong)`.
- Produces: `pipe.run(…, opts)` acepta `opts.cpuLong`. La etapa `render` dibuja a ese lado largo y su clave de caché lo incluye.
- Produces: el worker recibe `cpuLong` en `{ type: 'run' }`. Mensaje nuevo `{ type: 'export', id }`: dibuja con la teselación y los colores de la última ejecución terminada a `lastParams.outLong` y responde `{ type: 'exported', id, image }` (ImageData transferida), o `{ type: 'error', id, message: 'No hay ningún mosaico que exportar' }` si no la hay.
- `usePipeline` envía `cpuLong = Math.min(p.outLong, Math.round(Math.max(viewW, viewH) * Math.min(2, devicePixelRatio)))`.
- `useExport`, sin GPU: `requestCpuExport() -> Promise<ImageData>` (envía `export` y resuelve con el `exported` del mismo id).
- Con `?nogl` en la URL, `usePipeline` no crea el renderer (`{ ok: false }`), para probar el camino de la CPU.

- [ ] **Step 1: Tests.** `test/render.test.js`: `it('renders at the long side it is given')`: las piezas de una ejecución sobre `syntheticImage(240, 160)` y `renderMosaic(…, p, 120)` dan 120×80 con `supersample: 1`. En `test/pipeline.test.js`: `it('a new cpuLong redraws only the render stage')`: dos ejecuciones con `cpuLong` 300 y 400; en la segunda solo `render` llega con `recomputed = true`.
- [ ] **Step 2:** `npx vitest run test/render.test.js test/pipeline.test.js` → FAIL.
- [ ] **Step 3:** Implementa con las firmas de arriba.
- [ ] **Step 4: Smoke.** Paso `no webgl`: página nueva en `/?debug&nogl`, espera a que esté lista, descarga un PNG de más de 50 KB y comprueba que el lado largo del `.viewer-canvas` visible (`canvas.width`, `canvas.height`) es como mucho el doble del lado largo de su caja en pantalla.
- [ ] **Step 5:** `npm test`, build y smoke en verde.
- [ ] **Step 6: Commit** "Sin WebGL el mosaico se dibuja al tamaño de la pantalla y la descarga se calcula aparte".

### Task 6: Contexto WebGL perdido y recuperado

**Files:**
- Modify: `src/gl/renderer.js`, `src/ui/engine/usePipeline.js`, `scripts/smoke.mjs`

**Interfaces:**
- Consumes: el camino de la CPU de la Tarea 5.
- Produces: `createRenderer(canvas, { onLost, onRestored } = {})`. En `webglcontextlost`: `api.ok = false` y `onLost()`. En `webglcontextrestored`: vuelve a crear programas, VAO vacío y destinos, vuelve a subir los últimos argumentos de `setShards` y `setColors`, `api.ok = true` y `onRestored()`.
- `usePipeline`: `gpu` pasa a ser estado. Al perder el contexto: `gpu` a `false`, `mosaicReady` a `false` y `rerun()` (que ya envía `cpuRender: !renderer.ok`). Al recuperarlo: `gpu` a `true` y `requestRender()`. Los callbacks llegan al renderer por refs, porque el renderer se crea antes que ellos.

- [ ] **Step 1: Smoke primero.** Paso `webgl lost`: guarda en `window.__lose` la extensión `WEBGL_lose_context` del lienzo de `.viewer-host canvas` y llama a `loseContext()`; espera a que esté listo; la descarga da un PNG de más de 50 KB. Después `window.__lose.restoreContext()`, espera a que haya un `canvas` dentro de `.viewer-host` y a que esté listo, y el estado contiene «trozos».
- [ ] **Step 2:** `npm run build && CHROMIUM=/usr/bin/chromium-browser npm run smoke` → FAIL en `webgl lost` (la descarga no llega).
- [ ] **Step 3:** Implementa con las firmas de arriba.
- [ ] **Step 4:** Build y smoke en verde; `npm test` en verde.
- [ ] **Step 5: Commit** "Si se pierde el contexto WebGL, el mosaico pasa a la CPU y vuelve a la GPU cuando se recupera".

### Task 7: Build sin el WASM que nunca se carga

**Files:**
- Modify: `vite.config.js`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- Create: `scripts/check-dist.mjs`

**Interfaces:**
- En `vite.config.js`, `worker.plugins: () => [dropUnusedOrtWasm]`, un plugin con `generateBundle(_, bundle)` que borra del bundle las entradas cuyo nombre case con `/ort-wasm[^/]*\.wasm$/`. El comentario explica que transformers.js fija `wasmPaths` a jsDelivr y que la copia que emite Vite no se pide nunca.
- `scripts/check-dist.mjs` suma los tamaños de `dist/`, imprime `dist: N MB` y sale con 1 si hay algún `.wasm` o si el total pasa de 3 MB.

- [ ] **Step 1:** Crea `scripts/check-dist.mjs`. `npm run build && node scripts/check-dist.mjs` → FAIL (28 MB y un `.wasm`).
- [ ] **Step 2:** Añade el plugin.
- [ ] **Step 3:** `npm run build && node scripts/check-dist.mjs` → `dist: ` por debajo de 3 MB y salida 0. `CHROMIUM=/usr/bin/chromium-browser node scripts/seg-shot.mjs` sale con 0, lo que prueba que el runtime sigue llegando desde jsDelivr.
- [ ] **Step 4:** Añade `node scripts/check-dist.mjs` después del build en `ci.yml` y `deploy.yml`.
- [ ] **Step 5: Commit** "El build ya no publica los 27 MB del WASM de ONNX, que se carga desde jsDelivr".

### Task 8: Segmentación precalculada para los ejemplos y descarga contada de verdad

**Files:**
- Create: `src/seg/labelsPng.js`, `test/labelsPng.test.js`, `src/ui/segStatusText.js`, `test/segStatus.test.js`, `scripts/sample-segments.mjs`, `scripts/seg-bytes.mjs`, `public/samples/vermeer.seg.png`, `public/samples/vangogh.seg.png`, `public/samples/barcas.seg.png`
- Modify: `src/ui/segSession.js`, `test/segSession.test.js`, `src/seg/worker.js`, `src/ui/engine/useSegmentation.js`, `src/ui/useEngine.js` (`SAMPLES`), `src/ui/SegStatus.jsx`, `scripts/smoke.mjs`

**Interfaces:**
- Produces: `encodeLabels({ w, h, labels }) -> Uint8ClampedArray` (RGBA con R = G = B = etiqueta + 1, 0 sin objeto, A = 255; lanza un error si alguna etiqueta pasa de 254) y `decodeLabels(rgba, w, h) -> { w, h, labels: Int32Array, count }` (`count` = etiqueta máxima + 1).
- Produces: cada entrada de `SAMPLES` gana `seg: './samples/<nombre>.seg.png'`. `loadSample` se lo pasa a `loadBlob`, y `useSegmentation` recibe `preset` junto a `bitmap`: la URL del PNG, unos `segments` ya decodificados (los usa la Tarea 12) o `null`.
- Produces: `session.photo(image, { segments = null } = {})`, donde `image` es ahora un `ImageData` de lado largo ≤ 1024 (sustituye al blob PNG; el worker lo convierte con `new RawImage(data, w, h, 4)` y `.rgb()`). Con `segments`, el estado pasa a `{ phase: 'done', found: segments.count, preset: true }` y no se envía nada. Una petición `pick` o `parts` sobre esa foto sigue la política: con `auto` envía `{ type: 'encode', id, image }` y después la petición; con `ask` u `off` la encola y pregunta, como hoy, y `accept()` envía `encode` en lugar de `coarse`. Los `progress` de esa codificación se muestran como siempre, y `{ type: 'encoded', id }` devuelve el estado `{ phase: 'done', found, preset: true }`.
- Produces en el worker de SAM: `{ type: 'encode', id, image, device? }` carga el modelo y codifica la foto como `coarse`, sin `segmentEverything`, y termina con `{ type: 'encoded', id }`. `coarse` y `encode` comparten una sola función de carga y codificación. `coarse` también recibe `image` en lugar de `blob`.
- Produces: `statusOf(seg) -> { text, bar: number | null, actions: 'ask' | 'retry' | null }` en `segStatusText.js`; `SegStatus.jsx` solo pinta. Textos: en `download`, con `total > 0` y `done < total`, «Descargando el buscador de formas… N %» con barra; con `done ≥ total` o `total = 0`, «Preparando el buscador de formas…» sin barra; en `ask`, «Buscar las formas de la foto: descarga de unos N MB la primera vez», con `N = SEG_DOWNLOAD_MB`. El resto de fases dice lo mismo que hoy.
- `SEG_DOWNLOAD_MB`: el mayor de los dos totales que mide `scripts/seg-bytes.mjs`, redondeado hacia arriba a un múltiplo de 5.

- [ ] **Step 1: Tests.** `test/labelsPng.test.js`: ida y vuelta de un mapa 6×4 con etiquetas -1, 0 y 3 (`count` 4) y error con una etiqueta 255. `test/segSession.test.js`: `it('a photo with preset segments posts nothing and is done')`, `it('a pick on a preset photo with policy auto posts encode and then the pick')`, `it('a pick on a preset photo with policy ask asks first, and after accept posts encode and the pick')`, `it('encoded brings back the done state of the preset')`; ajusta los tests que esperan `blob` para que esperen `image`. `test/segStatus.test.js`: `it('a finished download says it is preparing, without a bar')` y `it('the question gives the measured size')`.
- [ ] **Step 2:** `npx vitest run test/labelsPng.test.js test/segSession.test.js test/segStatus.test.js` → FAIL.
- [ ] **Step 3:** Implementa `labelsPng.js`, los cambios de `segSession.js` y del worker, y `statusOf`.
- [ ] **Step 4: Mide la descarga.** `scripts/seg-bytes.mjs` arranca `vite preview`, abre `/?debug&samDevice=wasm` y luego `/?debug&samDevice=webgpu` en contextos nuevos, sube `public/samples/barcas.webp` por el input de fichero, espera a que la segmentación termine o falle, y suma `responseBodySize` de las peticiones a `hf.co`, `huggingface.co` y `jsdelivr.net`. Imprime los MB de cada caso. Ejecútalo con `CHROMIUM=/usr/bin/chromium-browser node scripts/seg-bytes.mjs`, fija `SEG_DOWNLOAD_MB` y apunta los dos totales en el commit.
- [ ] **Step 5: Genera los PNG.** `scripts/sample-segments.mjs` arranca el servidor de desarrollo con COOP/COEP (como `seg-shot.mjs`), abre `/?debug&samDevice=wasm` y, para cada ejemplo, lo sube por el input de fichero (así no usa el preset), espera `seg.phase === 'done'`, importa `/src/seg/labelsPng.js` dentro de la página, codifica `window.__trencadis.segments` con `encodeLabels`, lo pasa a PNG con `OffscreenCanvas.convertToBlob` y lo escribe en `public/samples/<nombre>.seg.png`. Ejecútalo y comprueba que cada PNG pesa menos de 40 KB.
- [ ] **Step 6:** `useSegmentation`: si la foto viene de un ejemplo con `seg`, descarga y decodifica el PNG, envía `segments` al worker del pipeline, llama a `setSegments`, a `session.photo(image, { segments })` y a `rerun()`. Si el PNG no llega, sigue el camino normal sin preset.
- [ ] **Step 7: Smoke.** En el paso `load`, cuenta las peticiones a `hf.co`, `huggingface.co` y `jsdelivr.net` desde el principio: hasta el paso `upload` deben ser 0, y `window.__trencadis.seg` debe tener `phase: 'done'` y `preset: true`.
- [ ] **Step 8:** `npm test`, build, smoke y `seg-shot.mjs` en verde.
- [ ] **Step 9: Commit** "Los ejemplos traen sus formas calculadas y no descargan el modelo; la descarga dice su tamaño real y no se queda en 100 %".

### Task 9: Análisis en dos etapas, caché por etapa y etiquetas de SAM una sola vez

**Files:**
- Modify: `src/core/analysis.js`, `src/core/params.js`, `src/core/pipeline.js`, `src/core/seglines.js`, `src/core/segcuts.js`, `src/core/tessellate.js`, `scripts/bench.mjs`
- Test: `test/analysis.test.js`, `test/pipeline.test.js`, `test/seglines.test.js`

**Interfaces:**
- Produces: `analyzeMaps(img, p, mask = null) -> { w, h, detail, theta, coherence }` (con el camino a media resolución dentro; `upsample` deja de calcular `size`) y `withSize(maps, p) -> { ...maps, size }` con `sizeFromDetail`. `analyze(img, p, mask)` queda como `withSize(analyzeMaps(img, p, mask), p)`, así que `sam.js` y los tests no cambian.
- Produces: `MAP_KEYS = ['workLong', 'ignoreTexture', 'detailSigma', 'detailSmooth', 'tensorSigma']` en `params.js`.
- Produces en `pipeline.js`: los mapas se guardan con la clave `[imgVersion, zonesVersion, valores de MAP_KEYS]`, y `timings.maps` solo aparece cuando se recalculan. Cada etapa guarda varios resultados (LRU) con estos límites: `analysis` 2, `tessellation` 4, `color` 4, `render` 1. `cached(stage)` devuelve el resultado de la última ejecución que llegó a esa etapa.
- Produces: `resampleLabels(seg, w, h) -> Int32Array` en `seglines.js`, vecino más próximo en el centro de cada píxel con la fórmula del `at` actual de `seglines.js`. El pipeline guarda `{ w, h, labels }` a la resolución de trabajo por versión de `segments` y tamaño, y se lo pasa a `tessellate`, así que `segmentGuides` y `cutBySegments` leen las etiquetas ya remuestreadas.

- [ ] **Step 1: Tests.** `test/analysis.test.js`: `it('analyze equals withSize of analyzeMaps')`, con igualdad exacta de cada array, en una imagen de 240×160 y en otra de más de 120000 píxeles (camino a media resolución). `test/pipeline.test.js`: `it('a size change keeps the maps')` (una ejecución y otra con `applyMacro(p, 'size', 0.55)`: en la segunda `timings.maps` es `undefined` y `timings.analysis` existe) y `it('going back to a previous method reuses its tessellation')` (`fracture`, `voronoi`, `fracture`: en la tercera, `tessellation` llega con `recomputed = false`). `test/seglines.test.js`: `it('resampleLabels repeats each label in blocks')` (un mapa 4×2 a 8×4 da bloques de 2×2).
- [ ] **Step 2:** `npm test` → FAIL en los nuevos.
- [ ] **Step 3:** Implementa con las firmas de arriba.
- [ ] **Step 4:** `npm test` en verde y `git diff --exit-code test/golden.json`.
- [ ] **Step 5: Bench.** Añade a `scripts/bench.mjs` una línea por método con los tiempos de un cambio de tamaño (`applyMacro(p, 'size', 0.55)` tras una primera ejecución). Esperado: `analysis` ≤ 60 ms en ese cambio (antes, unos 175 ms). Apunta los números en el commit.
- [ ] **Step 6: Commit** "El tamaño de los trozos ya no recalcula los mapas; caché de varias versiones por etapa y etiquetas de SAM remuestreadas una vez".

### Task 10: Vista previa a baja resolución mientras se arrastra

**Files:**
- Modify: `src/core/image.js`, `src/worker.js`, `src/ui/Param.jsx`, `src/ui/engine/usePipeline.js`, `src/ui/useEngine.js`, `scripts/bench.mjs`, `scripts/smoke.mjs`
- Test: `test/image.test.js`

**Interfaces:**
- Produces: `downscale(img, long) -> img` en `image.js`, media por cajas; devuelve el mismo `img` si ya cabe.
- Produces: `DRAFT_LONG = 400`. El worker mantiene un segundo pipeline `draft` con `downscale(imagen, DRAFT_LONG)`; zonas, segmentos y líneas van a los dos. `{ type: 'run', …, draft: true }` usa el borrador con `{ ...params, workLong: Math.min(params.workLong, DRAFT_LONG) }`.
- Produces: las claves `dragStart` y `dragEnd` en la API. Mientras dura el arrastre, las ejecuciones del pipeline salen con `draft: true`; `dragEnd()` lanza una ejecución completa si la última fue un borrador. Los cambios que solo afectan al render siguen yendo a la GPU.
- `Range` (`Param.jsx`) llama a `dragStart` en `pointerdown` y a `dragEnd` en `pointerup`, `pointercancel` y `keyup`. `usePipeline` también llama a `dragEnd` en `pointerup` y `blur` de `window`, para que la app no se quede en borrador si se suelta fuera del control.

- [ ] **Step 1: Tests** en `test/image.test.js`: `it('downscale keeps a flat colour')`, `it('downscale gives the requested long side')` (800×600 → 400×300) y `it('downscale averages a checkerboard to grey')`.
- [ ] **Step 2:** `npx vitest run test/image.test.js` → FAIL.
- [ ] **Step 3:** Implementa con las firmas de arriba.
- [ ] **Step 4: Bench.** Añade a `scripts/bench.mjs` el tiempo de una ejecución completa con `fracture` a `workLong` 400 sobre `downscale`. Esperado: ≤ 40 % de la ejecución a 800.
- [ ] **Step 5: Smoke.** Añade `dragStart` y `dragEnd` a `API_KEYS`. Paso `drag a slider`: arrastra con el ratón el control de «Tamaño de los trozos» de un extremo a otro en 10 movimientos y suéltalo; la app vuelve a estar lista, sin errores, y `window.__trencadis.info.shards` cambia respecto al valor de antes.
- [ ] **Step 6:** `npm test`, build y smoke en verde.
- [ ] **Step 7: Commit** "Mientras se arrastra un control, el mosaico se calcula a 400 px y se rehace entero al soltar".

### Task 11: Un solo historial para ajustes, zonas y líneas

**Files:**
- Create: `src/ui/engine/historyState.js`, `test/historyState.test.js`
- Modify: `src/ui/engine/useHistory.js`, `src/ui/engine/useGuides.js`, `src/ui/useEngine.js`, `src/ui/App.jsx`, `scripts/smoke.mjs`

**Interfaces:**
- El estado del historial pasa a ser `{ params, macros, zones, guides }`.
- Cada entrada de `guides` lleva `gen`, la generación de foto en la que se dibujó.
- Produces: `ownState(state, { gen, hasZone }) -> state`, que quita las líneas con otro `gen` y las zonas con `hasZone(id) === false`.
- Las líneas llegan al worker del pipeline desde un efecto sobre `guides` (como las zonas), así que deshacer y rehacer también rehacen el mosaico.
- `App.jsx`: Ctrl+Z siempre llama a `engine.undo()`. `undoGuide` se queda: quita la última línea como un cambio más.

- [ ] **Step 1: Tests** en `test/historyState.test.js`: `it('drops guides of another photo')`, `it('drops zones without pixels')` y `it('keeps everything of the current photo')`.
- [ ] **Step 2:** `npx vitest run test/historyState.test.js` → FAIL.
- [ ] **Step 3:** Implementa con las firmas de arriba.
- [ ] **Step 4: Smoke.** Paso `undo a line`: `window.__trencadis.addGuide({ points: [[0.1, 0.5], [0.9, 0.5]], mode: 'points', snap: false })`, espera a que esté listo, foco en `body`, `Control+z`, espera a que esté listo: `guides.length === 0`.
- [ ] **Step 5:** `npm test`, build y smoke en verde.
- [ ] **Step 6: Commit** "Un solo Ctrl+Z para ajustes, formas y líneas, sin traer nada de la foto anterior".

### Task 12: Sesión guardada en IndexedDB

**Files:**
- Create: `src/ui/engine/sessionStore.js`, `test/sessionStore.test.js`
- Modify: `src/ui/useEngine.js`, `src/ui/App.jsx`, `src/ui/engine/useZones.js`, `scripts/smoke.mjs`

**Interfaces:**
- Consumes: los segmentos precalculados de la Tarea 8 (`session.photo(image, { segments })`) para restaurar sin modelo.
- Produces: el tipo `Snapshot = { v: 1, sample: string | null, photo: Blob | null, name: string, guides, zones: [{ id, mode, points, region, parts }], segments: { w, h, labels, count } | null }`.
- Produces: `toSnapshot({ sample, photo, name, guides, zones, pixelsOf, segments }) -> Snapshot`, que deja fuera las zonas sin modo o sin píxeles, y `fromSnapshot(obj) -> Snapshot | null`, que devuelve `null` si `v !== 1`, si no hay ni `sample` ni un `photo` que sea `Blob`, si `guides` no es un array o si alguna zona no trae `region.data` como `Uint8Array`.
- Produces: `openSessionStore(idb = globalThis.indexedDB) -> { load(): Promise<Snapshot | null>, save(s: Snapshot): Promise<void> }`, con base de datos `trencadis`, almacén `session` y clave `last`. Cualquier error (navegación privada, cuota) da `null` al cargar y se ignora al guardar.
- Se guarda 1 s después del último cambio de foto, líneas, zonas (con sus píxeles) o segmentos. Una foto propia se guarda como JPEG de calidad 0,92 del bitmap ya reducido; un ejemplo, solo como su `src`.
- Al arrancar, `useEngine` (ya no `App.jsx`) carga la sesión: con una válida restaura foto o ejemplo, segmentos, zonas con sus píxeles y líneas; si no, carga `SAMPLES[0]`. Los ajustes siguen viniendo de `localStorage`.

- [ ] **Step 1: Tests** en `test/sessionStore.test.js`: `it('toSnapshot keeps typed arrays and drops zones without a mode')` (con `structuredClone` de por medio) y `it('fromSnapshot rejects other versions and broken data')` (casos `v: 2`, `{ v: 1 }` sin foto ni ejemplo y una zona con `region.data` como array normal).
- [ ] **Step 2:** `npx vitest run test/sessionStore.test.js` → FAIL.
- [ ] **Step 3:** Implementa con las firmas de arriba.
- [ ] **Step 4: Smoke.** Paso `reload keeps the photo`: tras subir `barcas.webp` y añadir una línea con `addGuide`, espera 1,5 s, recarga, espera a que esté listo: `photoName === 'barcas'` y `guides.length === 1`.
- [ ] **Step 5:** `npm test`, build y smoke en verde.
- [ ] **Step 6: Commit** "La foto, las formas y las líneas se guardan en el navegador y vuelven al recargar".

### Task 13: Móvil: más imagen, cabecera de una línea y estado de la segmentación en la barra

**Files:**
- Create: `src/ui/Extras.jsx`, `scripts/shots.mjs`
- Modify: `src/ui/App.jsx`, `src/ui/Panel.jsx`, `src/ui/Viewer.jsx`, `src/ui/SegStatus.jsx`, `src/styles.css`, `scripts/smoke.mjs`

**Interfaces:**
- Con `MOBILE`, la cabecera es una fila con la marca (sin lema) y «Subir foto». Los ejemplos y el enlace a Ko-fi pasan a `Extras`, al final del cuerpo de la hoja. En escritorio la cabecera no cambia.
- `.viewer-canvas` usa `inset: 4px` en móvil (14 px en escritorio).
- `SegStatus` se pinta dentro de `.viewer-bar` en escritorio y en móvil: una línea de texto con sus acciones y una barra de 3 px debajo. Nada tapa la imagen.
- Aviso de la herramienta de formas: la primera vez que la segmentación de una foto propia termina con alguna forma (y `trencadis.hint.v1` no está guardado), la barra muestra durante 8 s «Toca una forma para darle más o menos detalle» con un botón «Probar» que activa la herramienta. Mostrado una vez, se guarda `trencadis.hint.v1 = 'shown'`. `SegStatus` recibe `onShapeTool` desde `App`.
- `scripts/shots.mjs` hace capturas de escritorio (1440×900), móvil (390×844, `deviceScaleFactor` 2, táctil) y modo oscuro, las guarda en `os.tmpdir()/trencadis-shots/` e imprime qué parte del viewport ocupa la imagen visible en móvil. La imagen visible se calcula con la caja del lienzo y `object-fit: contain`.

- [ ] **Step 1: Smoke primero.** Paso `phone`: contexto nuevo de 390×844, táctil; la imagen visible ocupa ≥ 28 % del viewport (hoy, un 16 %) y la caja de `.seg-status`, si existe, no corta el rectángulo de la imagen.
- [ ] **Step 2:** Build y smoke → FAIL en `phone`.
- [ ] **Step 3:** Implementa la cabecera, `Extras`, los márgenes, `SegStatus` en la barra y el aviso.
- [ ] **Step 4:** Build y smoke en verde; `npm test` en verde. Ejecuta `node scripts/shots.mjs` y mira las tres capturas.
- [ ] **Step 5: Commit** "Móvil: cabecera de una línea, más imagen y el estado de la búsqueda de formas en la barra del visor".

### Task 14: Barra del visor, exportación y atajos

**Files:**
- Create: `src/ui/zoom.js`, `test/zoom.test.js`, `src/ui/exportSize.js`, `test/exportSize.test.js`
- Modify: `src/ui/Viewer.jsx`, `src/ui/Panel.jsx`, `src/ui/steps.js`, `src/ui/App.jsx`, `src/ui/useEngine.js`, `src/ui/engine/useExport.js`, `scripts/smoke.mjs`

**Interfaces:**
- Produces: `zoomAt({ k, x, y }, factor, px, py, w, h) -> { k, x, y }`, con `k` entre 1 y 8, el punto `(px, py)` de la caja quieto y la traslación limitada a `[w(1 − k), 0] × [h(1 − k), 0]`. La usan la rueda y los botones; el pellizco conserva su fórmula, porque sigue a los dedos.
- Produces: `OUT_SIZES = [1200, 2000, 3000, 4000]` y `printSize(long, dpi = 300) -> string`, con `Math.round(long / dpi * 2.54)` cm: `printSize(2000)` → `'17 cm a 300 ppp'`.
- Produces: la clave `reseed()` en la API (semilla → `(seed % 999) + 1`). La usan el botón de Más ajustes › Trozos y el nuevo de la barra.
- Barra del visor: botón «Otra versión ↻» (`title` «Otra versión (R)»). Sin `TOUCH`, botones «−» y «+» (factores 1/1,5 y 1,5 sobre el centro de la caja) junto a «Ajustar».
- «Mantén para ver la original» pinta `engine.bitmap` en lugar de `images.original`.
- Fila de exportación: un `<select>` con `OUT_SIZES` (etiqueta `${n} px`, `title` `printSize(n)` + «, lado largo») que cambia `outLong`. `outLong` sale de Acabado › Ajustes avanzados en `steps.js`. Formato inicial: el guardado; si no hay, `'jpg'` con `TOUCH` y `'png'` en el resto.
- Compartir: cuando el mosaico lleva 800 ms quieto y el navegador puede compartir ficheros, `useExport` codifica en segundo plano (`requestIdleCallback`, con `setTimeout` si no existe) el fichero del formato y tamaño actuales; `share()` usa ese fichero si sigue valiendo para los mismos ajustes y mosaico.
- Hileras: «Deshacer» pasa a «Quitar la última» y «Deshacer todo (n)» a «Quitar todas (n)».
- Atajos sin modificadores y con el foco fuera de `input`, `select`, `textarea` y contenido editable: `App` gestiona `r` (otra versión) y `d` (descargar en el formato actual); `Viewer` gestiona `+`/`=`, `-`, `0` y la barra espaciadora mantenida (original).

- [ ] **Step 1: Tests.** `test/zoom.test.js`: `it('keeps the point under the pointer')`, `it('clamps k between 1 and 8')` e `it('at k 1 the translation is 0')`. `test/exportSize.test.js`: `printSize(2000)` → `'17 cm a 300 ppp'`, `printSize(4000)` → `'34 cm a 300 ppp'`, `printSize(1200)` → `'10 cm a 300 ppp'`.
- [ ] **Step 2:** `npx vitest run test/zoom.test.js test/exportSize.test.js` → FAIL.
- [ ] **Step 3:** Implementa con las firmas de arriba.
- [ ] **Step 4: Smoke.** Añade `reseed` a `API_KEYS`. Paso `keys`: foco en `body`, tecla `r`: la semilla cambia y la app vuelve a estar lista. Paso `export size`: elige 3000 en el selector, descarga, lee el ancho y el alto del PNG en la cabecera IHDR (bytes 16 a 23, big-endian) y el mayor vale 3000.
- [ ] **Step 5:** `npm test`, build y smoke en verde.
- [ ] **Step 6: Commit** "Barra del visor con otra versión y zoom, tamaño de descarga junto al botón, original nítida y atajos de teclado".

### Task 15: Lanzamiento: Acerca de, firma, Ko-fi tras descargar y metadatos

**Files:**
- Create: `src/ui/About.jsx`, `src/ui/signature.js`, `test/signature.test.js`, `public/manifest.webmanifest`, `public/icon-180.png`, `public/icon-192.png`, `public/icon-512.png`, `scripts/icons.mjs`
- Modify: `index.html`, `src/ui/App.jsx`, `src/ui/Extras.jsx`, `src/ui/Panel.jsx` (`Export`), `src/ui/engine/useExport.js`, `src/styles.css`, `scripts/smoke.mjs`

**Interfaces:**
- `About`: un `<dialog>` que se abre desde un enlace «Acerca de» en la cabecera de escritorio y en `Extras`. Contenido: qué hace la app; privacidad (la foto se procesa en el navegador y no se sube a ningún sitio; la última foto se guarda en este navegador para no perderla al recargar; la primera vez que se buscan formas se descarga un modelo de Hugging Face y su runtime de jsDelivr); los créditos del README actual; licencia MIT y enlace a https://github.com/feal-ca/trencadis.
- Firma: casilla «Firmar la imagen» en la fila de exportación, marcada por defecto, guardada en `trencadis.sign.v1`. Texto `trencadís · feal-ca.github.io/trencadis` abajo a la derecha, en blanco al 85 % con sombra `rgba(0, 0, 0, 0.6)` de desenfoque `size / 6`, Figtree 600. Con la firma, la exportación (GPU o CPU) pasa por un `OffscreenCanvas` 2D.
- Produces: `signatureBox(w, h) -> { x, y, size }`, con `size = max(11, round(0.014 · max(w, h)))`, margen `round(0.012 · max(w, h))`, `x = w − margen` e `y = h − margen` (texto alineado a la derecha y abajo).
- Ko-fi: tras la primera descarga o compartición correcta en este navegador, debajo de la fila de exportación aparece «¿Te gusta? Invítame a un café» con enlace a https://ko-fi.com/fealca y un botón × para cerrar. Se guarda `trencadis.kofi.v1 = 'shown'` y no vuelve a salir.
- `index.html`: `<meta name="theme-color" content="#f7f6f2">`, la misma con `media="(prefers-color-scheme: dark)"` y `#1c1a17`, `<link rel="apple-touch-icon" href="./icon-180.png">` y `<link rel="manifest" href="./manifest.webmanifest">`. El manifest lleva `name` «Trencadís», `short_name` «Trencadís», `start_url` `./`, `display` `standalone`, `background_color` y `theme_color` `#f7f6f2` y los iconos de 192 y 512. `scripts/icons.mjs` dibuja `public/favicon.svg` con Chromium a 180, 192 y 512 px.

- [ ] **Step 1: Tests** en `test/signature.test.js`: `signatureBox(2000, 1500)` → `{ x: 1976, y: 1476, size: 28 }` y `signatureBox(300, 200)` → `{ x: 296, y: 196, size: 11 }`.
- [ ] **Step 2:** `npx vitest run test/signature.test.js` → FAIL.
- [ ] **Step 3:** Implementa `signature.js`, la firma en la exportación, `About`, la nota de Ko-fi y los metadatos. Ejecuta `node scripts/icons.mjs` para generar los iconos.
- [ ] **Step 4: Smoke.** Paso `about`: clic en «Acerca de», `dialog[open]` contiene «Hugging Face». Paso `kofi once`: tras la primera descarga se ve la nota de Ko-fi; tras recargar y descargar otra vez, no.
- [ ] **Step 5:** `npm test`, build, `node scripts/check-dist.mjs` y smoke en verde. Mira una descarga firmada a 2000 px y otra sin firmar.
- [ ] **Step 6: Commit** "Acerca de con privacidad y créditos, firma en la imagen, Ko-fi tras la primera descarga, manifest e iconos".

### Task 16: Herramientas y documentación

**Files:**
- Create: `eslint.config.js`, `src/core/types.js`, `README.es.md`
- Modify: `package.json`, `README.md`, `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, los ficheros que señale ESLint

**Interfaces:**
- ESLint en configuración plana: `@eslint/js` recomendado, `eslint-plugin-react-hooks` con `rules-of-hooks: 'error'` y `exhaustive-deps: 'warn'`, y `globals.browser`, `globals.worker` o `globals.node` según la carpeta (`src/`, `src/worker.js` y `src/seg/`, `scripts/` y `test/`). `npm run lint` = `eslint . --max-warnings=0`. Las dependencias que se omiten a propósito llevan `// eslint-disable-next-line react-hooks/exhaustive-deps -- <motivo>`.
- `src/core/types.js` solo contiene `@typedef` de JSDoc para `Shard`, `Zone`, `Region`, `Parts` y `Segments`, con la forma que ya documentan `tessellate.js`, `zones.js`, `focus.js`, `shapeMask.js` y `seglines.js`.
- CI: `ci.yml` añade el disparador `workflow_call` y los pasos lint, test, build, `check-dist` y smoke. `deploy.yml` llama a `ci.yml` como job `test` (`uses: ./.github/workflows/ci.yml`) y su job de despliegue lleva `needs: test` y solo construye, sube y despliega. Un job aparte en `ci.yml`, del que no depende el despliegue, ejecuta `node scripts/seg-shot.mjs` con `?samDevice=wasm`.
- `README.md` pasa a inglés, para GitHub y HN, y `README.es.md` lleva el mismo contenido en castellano. Los dos describen la app actual: el panel simple con estilos, la herramienta de formas, las hileras, Más ajustes con los cuatro pasos, la privacidad (modelo de Hugging Face, runtime de jsDelivr, sesión guardada en el navegador) y los comandos de desarrollo (`smoke`, `lint`, `golden:update`, `check-dist`, `shots`, `sample-segments`, `seg-bytes`, `?debug`, `?nogl`, `?samDevice`). La sección de cómo funciona se actualiza: no hay hileras automáticas por bordes; salen de los contornos de las formas. Llevan una captura de `scripts/shots.mjs` en `docs/screenshot.jpg`. La prosa pasa por la skill `humanizer:humanizer`.
- Ramas: `mobile`, `polish` y de `v2` a `v10` están fusionadas en `main`.

- [ ] **Step 1:** Instala `eslint`, `@eslint/js`, `eslint-plugin-react-hooks` y `globals` como dependencias de desarrollo, crea `eslint.config.js` y el script `lint`. `npm run lint` → FAIL con la lista de avisos.
- [ ] **Step 2:** Corrige cada aviso o anótalo con su motivo. `npm run lint` en verde; `npm test`, build y smoke en verde; `git diff --exit-code test/golden.json`.
- [ ] **Step 3:** Crea `src/core/types.js` y los cambios de CI. Comprueba los YAML con `actionlint` si está instalado; si no, pide al usuario permiso para empujar una rama de prueba y mira el resultado en Actions.
- [ ] **Step 4:** Escribe `README.md` y `README.es.md`, y genera `docs/screenshot.jpg`.
- [ ] **Step 5: Commit** "ESLint con las reglas de hooks, CI reutilizada por el despliegue, tipos de los datos del núcleo y README nuevo en inglés y castellano".
- [ ] **Step 6:** Enseña al usuario la salida de `git branch --merged main` y `git ls-remote --heads origin`, y pregúntale si borra esas ramas en local y en `origin`. Bórralas solo si dice que sí.

---

## Después de esta fase

Cada fase necesita su propio diseño y su propio plan; no forman parte de este.

- Fase 2, i18n en inglés, catalán y castellano: catálogo por idioma con una función `t()`, idioma por `navigator.language` con selector, `Intl.NumberFormat`, `lang` y metadatos por idioma. Las traducciones se hacen con un servicio de traducción, como se decidió el 19-10-2026.
- Fase 3, color y detalle (apartado 5 del repaso): tensor de Di Zenzo sobre Lab, medias en luz lineal, OKLCH para saturación y luminosidad, OKLab para la paleta, difusión del error entre vecinos, puntos de SAM en las zonas sin cubrir, comparación de EdgeTAM y SAM 2.1 tiny con SlimSAM-77, y zonas «más» teseladas a ×2 o ×4 desde el `bitmap`. Esta fase cambia la geometría a propósito: los hashes se rehacen con `npm run golden:update` y el usuario ve antes y después.
- Fase 4, método opus tessellatum o vermiculatum con el estilo Romano encima, y realismo del esmalte (reflejo de entorno con Fresnel, bordes desconchados).
- Fase 5, funciones nuevas (apartado 7 del repaso): recorte y proporción, marco, texto, exportación para imprimir (más de 4000 px y PDF), vídeo o GIF de la transformación, luz que sigue al ratón o al giroscopio, PWA con Share Target y runtime y modelo servidos desde la propia web, proyectos y enlace con ajustes, tira de versiones, comparador deslizante entre foto y mosaico, y el primer mosaico precalculado para que la portada salga al instante. El SVG y la plantilla para hacerlo de verdad siguen en espera mientras el usuario no diga otra cosa.
