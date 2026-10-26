# Segmentación unificada y panel simple

Fecha: 2026-10-25. Rama de partida: `lab-intentional`, con el trabajo del lab sin commit.

## Por qué

La segmentación con SlimSAM del `?lab` funciona bien: encuentra la persona, la torre, el río y la cara, y las hileras en sus contornos mejoran el mosaico. El teselado con intención, en cambio, vive aparte. Lo activa otro pincel (el de importancia) y parte la zona por color (Felzenszwalb + fusión por ΔE), que es justo el enfoque que el usuario descartó el 23 de octubre. El resultado son dos herramientas que no se hablan, cinco ajustes propios de la intención y tres pinceles que se pisan (detalle, hileras e importancia).

El usuario quiere un solo flujo, fuera del `?lab` y con bastantes menos controles, y pone por delante la experiencia de usuario.

## El flujo

1. El usuario carga una foto y el mosaico sale enseguida, como hoy.
2. En segundo plano se hace una segmentación gruesa de toda la foto con SlimSAM: una codificación de la imagen y unos 64 puntos. De ella salen las hileras en los contornos de las formas y los cortes de las piezas que pisan dos formas (lo que hoy hacen `segguides.js` y `segcuts.js`). Al terminar, el mosaico se recalcula solo.
3. Mientras segmenta, se ve un indicador sobre la foto: "Descargando el modelo…" la primera vez y "Buscando las formas de la foto… N encontradas" después, con barra de progreso. Las formas encontradas pueden dibujarse con un contorno discontinuo.
4. El usuario prueba los ajustes del panel simple.
5. Si una zona le importa, toca una forma (ver "Tocar una forma"). Puede pedir más detalle (los ojos) o menos (unas hojas, agua con brillos).
6. En una forma con más detalle se segmenta más fino y cada parte que sale (iris, blanco del ojo, párpado) se tesela con intención: los bordes entre partes se enderezan una vez (`straightParts` de `straight.js`) y cada parte se rellena con el método elegido, con su borde como límite duro. El tamaño de las piezas sale del tamaño de la parte, así que una parte pequeña lleva piezas pequeñas.
7. Descarga.

### Tamaño de las piezas en una forma con más detalle

Decisión mía, a partir de lo que pidió el usuario ("si el segmento es más pequeño, sus tiles también"). Cada parte se parte en piezas cuyo tamaño es el menor de dos: el tamaño normal de trozo en esa zona (el del mapa de detalle, que escala con "Tamaño de los trozos") y la mitad del grosor de la propia parte. Así una parte siempre se divide en varias piezas a lo ancho, una parte grande (el blanco del ojo) lleva varias piezas y el control de tamaño sigue funcionando dentro de las formas refinadas. El suelo es la mitad de la pieza mínima (`sMin / 2`): dentro de una forma con más detalle las piezas pueden ser más pequeñas que en el resto del mosaico.

Nota del 26 de octubre de 2026: el suelo de la mitad de la pieza mínima y el tope de la mitad del grosor de la parte los decidió el usuario. Antes el suelo era `sMin` y el tope el grosor entero, y en un ojo de Vermeer las piezas salían igual de grandes que sin tocarlo.

### Lo que puede perderse en la pasada gruesa

Ya acordado con el usuario el 25 de octubre: la pasada gruesa es rápida (una codificación, ~64 puntos, sin recortes) y puede no encontrar cosas pequeñas como los ojos o incluso una cara pequeña. Es aceptable, porque lo pequeño se pide con "Tocar una forma". Si hay que elegir, gana la velocidad.

## Objetivos

- Una sola segmentación, gruesa al cargar y fina donde se toca, que alimenta todo: hileras, cortes y piezas con intención.
- El tamaño de las piezas en una zona refinada es el que necesita esa zona para leerse bien, sin un ajuste de tamaño aparte.
- El usuario ve en todo momento que se está segmentando y cuánto falta.
- Segmentación más rápida que hoy. Meta: unos pocos segundos en el portátil del usuario (iGPU Intel Gen12, Chromium, WebGPU fp16), frente a los ~24 s de la pasada completa de 256 puntos con recortes.
- Panel simple con pocos controles. Todo lo demás, plegado.
- Todo fuera del `?lab`: la app normal hace esto para cualquiera.

## No objetivos

- Traducciones (EN/CA). Van después, con un servicio de traducción.
- Cambios en el render o el acabado.
- Casos especiales de caras u ojos. El método es general (decisión del 23 de octubre).
- Teselado con intención de toda la imagen (la casilla "Toda la imagen" desaparece).

## Antiobjetivos

- Que la app tarde más en enseñar el primer mosaico que hoy. La segmentación nunca bloquea.
- Que sin WebGPU o sin modelo la app quede rota o asuste. Sin segmentación funciona como hoy, sin hileras automáticas.
- Volver a las partes por color, que el usuario ya rechazó.
- Dos botones para poner y quitar en una misma herramienta.

## El panel simple

Decidido por el usuario: los cuatro estilos (Natural, Park Güell, Romano, Vitral) arriba y, debajo, cinco controles:

- "Tipo de trozos", el selector de método.
- "Tamaño de los trozos", el macro `size`.
- "Parecido a la foto", el macro `fidelity`.
- "Colores", con paleta y saturación (la elección de estos dos es mía).
- "Acabado", con color de la junta y brillo del esmalte, el macro `gloss` (también decisión mía).

Después vienen las dos herramientas de la foto, "Tocar una forma" y el lápiz de hileras, y por último "Más ajustes", plegado, con el resto.

El boceto aprobado está en `.superpowers/brainstorm/1487517-1792939021/content/panel.html`.

## Tocar una forma

Gesto elegido por el usuario (opción A del boceto): tocar una forma sobre la foto.

- Al tocar se ilumina la forma que ha encontrado el modelo, ajustada al contorno. Usa la codificación ya calculada de la imagen y el punto tocado como petición al decodificador, así que responde al momento.
- Si la forma es pequeña respecto a la foto, se vuelve a codificar un recorte alrededor de ella a resolución completa y se segmenta dentro con una rejilla de puntos.
- Otro toque dentro de la forma la amplía o la corrige.
- Una sola herramienta para más y menos detalle, sin dos botones (lo pidió el usuario para el lápiz; lo aplico aquí también). Decisión mía: al tocar aparece junto a la forma un pequeño menú con "Más detalle", "Menos detalle" y "Quitar".
- Con "Más detalle", las partes finas de la forma reciben piezas con intención, del tamaño que pida cada parte.
- Con "Menos detalle", la forma se cubre con trozos grandes, como hace hoy el pincel de detalle en modo quitar.
- Las formas tocadas se listan en el panel ("2 zonas · quitar") y entran en el deshacer/rehacer general.

### Cómo convive con cada método

Decidido por el usuario: la forma de las piezas con intención se ajusta al método. Ya lo pidió el 20 de octubre ("same tile vocabulary as the style"). Una forma con más detalle no tiene geometría propia. Sus partes enderezadas son regiones y dentro de cada una trabaja el método elegido, con el tamaño que fija la regla de arriba:

- Cortes rectos: `fracture` ya acepta polígonos de entrada, así que recibe las partes en lugar de los azulejos base.
- Teselas partidas: igual, con las teselas recortadas a la parte antes de los cortes.
- Teselas redondeadas y alargadas: semillas solo dentro de la parte y celdas recortadas a ella (Lloyd restringido a la parte).
- Manchas de color: SLIC con los centros y los píxeles de la parte.
- Grietas: las grietas nacen dentro de la parte y paran al llegar a su borde, como paran al chocar con otra grieta.

El borde entre partes siempre es una arista de pieza, sea cual sea el método. Junta, color, bisel y colocación son los del estilo y la rectitud usa `simplify`. Las piezas convexas por triangulación (`straightPieces`) dejan de usarse.

Riesgo conocido: `splitByLine` sobre polígonos no convexos no se ha probado visualmente, y las partes lo serán a menudo (un párpado curvo).

### Detalle de la interacción (decisión mía)

El primer toque selecciona la forma y abre el menú junto a ella. Con la forma seleccionada, un toque dentro añade un punto positivo al decodificador (amplía o corrige). Un toque fuera de la forma selecciona otra. Pellizcar y arrastrar con dos dedos siguen siendo zoom y desplazamiento, como hoy.

## Lápiz de hileras

Se queda, decidido por el usuario, para dibujar a mano líneas de piezas (una barandilla, unas letras). Poner y quitar van en una sola herramienta, sin los dos botones de hoy ("Dibujar línea" y "Borrar líneas"). Decidido por el usuario: una línea se quita manteniendo pulsado sobre ella (en escritorio, mantener pulsado el botón del ratón). Al soltar, la línea desaparece entera y "Deshacer" la devuelve. Mientras se mantiene, la línea se resalta para que se vea cuál se va a quitar. Se mantienen "A mano / Por puntos" y "Pegar al contorno".

## Qué desaparece y qué se pliega

| Ahora | Después |
|---|---|
| Pincel de detalle (añadir/quitar) | Fuera. Lo sustituye "Tocar una forma" con más y menos detalle |
| Pincel de importancia y `intent`, `intentDE`, `intentAll`, `intentScale`, `intentRim` | Fuera. El tamaño sale de la parte; lo que toca el borde de la forma se resuelve con la propia forma |
| `intentStraight` | Fuera. Se usa `simplify` ("Rectitud de aristas") |
| `autoGuides` ("Contornos con hilera", por bordes fuertes) | Fuera, decidido por el usuario. Las hileras automáticas salen solo de la segmentación |
| `segGuides`, `segCuts` | Siempre activos, sin control |
| Comparación izquierda/derecha del lab (`compare`, segundo renderer) | Fuera |
| `lab/segment.html`, `lab/segment.js`, `?lab`, `LAB` | Fuera. El código del lab pasa a `src/core` (y `src/lab/sam.js` a un sitio no-lab) |
| Ajustes de hileras (`rowScale`, `rowLength`, `rowCount`, `rowColor`, `rowContrast`, `rowGrout`) | En "Más ajustes" |
| Ajustes del análisis (`gamma`, `detailSigma`, `detailSmooth`, `tensorSigma`, `workLong`, `sizeRatio`, `ignoreTexture`) | En "Más ajustes" |
| Ajustes propios de cada método | En "Más ajustes", como hoy |

## Rendimiento y carga

- El modelo (`Xenova/slimsam-77-uniform`, unos 10 MB) se descarga la primera vez y queda en caché del navegador.
- Decidido por el usuario: en móvil o sin WebGPU, la segmentación no arranca sola. Se pregunta antes ("Buscar las formas de la foto: descarga de unos 10 MB la primera vez"), y hasta que el usuario acepta la app funciona como hoy. En escritorio con WebGPU arranca sola. La respuesta se recuerda en el navegador.
- WebGPU fp16 cuando hay GPU; si falla, WASM q8. En GitHub Pages hace falta `coi-serviceworker` para tener hilos en WASM.
- Pasada gruesa: una codificación y ~64 puntos, sin recortes. Hay que medir el tamaño de lote del decodificador (`opts.batch`), que aún no se ha probado.
- Hoy la segmentación va en un worker propio (`src/lab/segment-worker.js`). Sigue así para no bloquear ni la interfaz ni el pipeline.
- Las piezas con intención solo se calculan en las formas tocadas, no en toda la foto.

## Lo que queda en manos de quien lo construya

- La forma exacta del indicador, siempre que diga qué pasa y cuánto falta, no tape la foto más de lo necesario y se vea en móvil.
- El número de puntos y el tamaño de lote, medidos en el portátil del usuario.
- Cómo se guardan las formas tocadas para que sobrevivan a cambios de ajustes y de resolución de trabajo (hoy las máscaras van en una rejilla de 256 px: `useMaskLayer.js`).
- Dónde vive cada archivo al salir del lab.
- Tests: los de `test/lab/` pasan a `test/`, se borran los de lo que desaparece y se añaden para lo nuevo.

## Decisiones mías para revisar

- Qué ajustes concretos llevan "Colores" (paleta y saturación) y "Acabado" (junta y brillo).
- El menú junto a la forma tocada con "Más detalle / Menos detalle / Quitar".
- Que las formas encontradas se dibujen con contorno discontinuo mientras segmenta.
- La regla de tamaño de las piezas en una forma con más detalle.
- El detalle de la interacción del toque.

