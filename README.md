# Trencadís

Trencadís convierte una foto en un mosaico de azulejo roto, como los bancos del Park Güell. Todo se calcula en el navegador y la foto no sale de tu ordenador.

Ábrelo en https://feal-ca.github.io/trencadis/

## Cómo se usa

La app abre con un cuadro de ejemplo ya convertido. Sube tu foto con «Subir foto» o arrastrándola sobre la imagen.

A la derecha están los cuatro pasos, en orden: 1 Detalle, 2 Trozos, 3 Colores y 4 Acabado. Cada uno tiene sus controles principales, «Más ajustes» con el resto, «¿Qué hace?» con la explicación y la fórmula, y «Ver este paso», que cambia la imagen grande por el resultado parcial de ese paso. El icono ⓘ junto a cada control explica qué hace.

Algunos controles principales mueven varios parámetros a la vez («Tamaño de los trozos», «Parecido a la foto», «Brillo del esmalte»). «Ajustar a mano» los desactiva y muestra esos parámetros por separado; «Volver al control simple» deshace el cambio.

Si una zona tiene mucho detalle que no te interesa (reflejos de sol en el agua, césped, hojas), hay dos herramientas en Detalle. «Ignorar texturas» rebaja de forma automática el detalle hecho de puntos, y deja los contornos. El pincel de detalle permite pintar sobre la foto para quitar detalle o para añadirlo donde quieras trozos más pequeños.

En Trozos también hay **hileras**: piezas rectangulares en fila a lo largo de una línea, como la espiral negra de los bancos de Gaudí. Las líneas salen solas de los contornos fuertes de la foto («Contornos con hilera») o las dibujas tú con «Dibujar línea». Sirven para que se lean contornos, barandillas o letras sin subir el detalle de toda la imagen. Los trozos del fondo se recortan hasta tocarlas.

El acabado (junta, colocación, bisel, luz, brillo) se dibuja en la tarjeta gráfica y responde al momento. Los cambios de detalle, trozos o color se recalculan en segundo plano en menos de un segundo y medio; mientras tanto la imagen se atenúa y aparece un pequeño indicador. El PNG se descarga al tamaño elegido en Acabado.

## Cómo funciona

1. **Detalle.** Se mide la energía de alta frecuencia D(x) = |L − desenfoque(L, σ)|, suavizada y normalizada. «Ignorar texturas» la rebaja donde la imagen está hecha de manchas: el determinante del Hessiano, dividido por el gradiente al cuadrado, es alto en puntos brillantes, hojas o césped y casi nulo a lo largo de un contorno. El pincel, desenfocado para que no se note dónde empieza, la multiplica o la eleva según lo pintado. De ahí sale el tamaño de trozo s(x) = s_max − (s_max − s_min)·D(x)^γ, y del tensor de estructura, la dirección de los bordes θ(x). Los desenfoques son tres pasadas de box blur con el σ exacto (Kovesi). En imágenes grandes los mapas se calculan a media resolución y se interpolan, porque son suaves.
2. **Trozos.** Seis métodos:
   - Cortes rectos: la imagen se divide en azulejos irregulares (Voronoi) de unas 3,5 veces el tamaño de trozo, y cada azulejo se parte con rectas hasta llegar al tamaño pedido. Así ningún corte cruza la imagen. En cada corte se prueban N rectas y se elige una con probabilidad ∝ exp(−coste/T), donde el coste es la varianza de color que queda en las dos mitades más un castigo a las astillas. Salen uniones en T, como en el azulejo roto.
   - Grietas: inspirado en *Substrate* de Jared Tarbell. Cada grieta nace en un punto interior, lejos de otras grietas, y crece en los dos sentidos hasta chocar con otra. Los trozos más estrechos que el grosor mínimo se unen al vecino con el que comparten más borde (lo mismo se hace con las teselas alargadas y las manchas de color).
   - Teselas redondeadas: Voronoi con semillas de Poisson-disk de radio variable (Bridson) y relajación de Lloyd ponderada por 1/s(x)².
   - Teselas alargadas: Voronoi con una métrica estirada a lo largo de los bordes, como en Hausner (2001).
   - Teselas partidas: teselas redondeadas grandes que reciben unos pocos cortes rectos.
   - Manchas de color: superpíxeles SLIC con la separación tomada de s(x) y bordes simplificados con Douglas-Peucker.
   - Hileras, sobre cualquiera de los anteriores: las guías automáticas salen de un detector de bordes (supresión de no máximos e histéresis, con umbrales relativos a los bordes más fuertes) cuyas cadenas se suavizan y se quedan las más largas. El ancho de las piezas es una fracción del tamaño de trozo de cada zona, suavizada a lo largo de la guía. Para cada píxel cerca de una guía se mide la distancia con signo y la posición a lo largo de ella; de ahí salen la fila y la pieza, con filas vecinas desplazadas media pieza. El fondo se rasteriza, las hileras lo sobrescriben, cada fragmento suelto pasa a ser un trozo y los muy estrechos se unen a su vecino del fondo. Los trozos que ninguna hilera toca conservan su polígono original.
3. **Color.** Un color por trozo (media, más vivo, el más frecuente, mediana o el del centro), con paleta opcional (k-means de la foto o un juego fijo de azulejos de taller) y una pequeña variación al azar.
4. **Acabado.** En WebGL2: los trozos se triangulan con earcut y se dibujan con su índice, cada uno algo girado, desplazado y encogido según «Colocación a mano»; un jump flood da a cada píxel la distancia al borde más cercano; el último pase pinta la junta, el bisel, la inclinación de cada trozo y un brillo Blinn-Phong. Si el navegador no tiene WebGL2, el mismo acabado se calcula en la CPU.

## Desarrollo

```
npm ci
npm run dev                  # servidor local
npm test                     # tests del núcleo (Vitest)
npm run build                # sitio estático en dist/
node scripts/bench.mjs       # tiempos por etapa en una imagen sintética
node scripts/thumbs.mjs      # regenera las miniaturas de los métodos
```

`scripts/thumbs.mjs` necesita Chromium; usa `/usr/bin/chromium-browser` o la ruta de la variable `CHROMIUM`. Con el servidor de desarrollo arrancado, `test/browser/gl.html` comprueba el renderer WebGL y mide los fps, y añadir `?debug` a la URL de la app guarda los tiempos de cada cálculo en `window.__runs`.

El código de imagen está en `src/core/` y no depende del DOM, salvo `vis.js`, que dibuja las etapas con OffscreenCanvas. El cálculo corre en un Web Worker (`src/worker.js`) y el render en `src/gl/`. La interfaz en React está en `src/ui/`; los pasos y sus textos, en `src/ui/steps.js`, y la ayuda de cada parámetro, en `src/core/params.js`.

Cada push a `main` se publica en GitHub Pages mediante `.github/workflows/deploy.yml`.

## Créditos

- Los cuadros de ejemplo son de dominio público y vienen de Wikimedia Commons: *La joven de la perla*, de Johannes Vermeer (c. 1665), y *La noche estrellada*, de Vincent van Gogh (1889). La foto de las barcas es «El Guamache Bay, Margarita island», también de Wikimedia Commons, con licencia CC0.
- A. Hausner, «Simulating Decorative Mosaics», SIGGRAPH 2001.
- R. Achanta et al., «SLIC Superpixels Compared to State-of-the-Art Superpixel Methods», IEEE TPAMI 2012.
- J. Tarbell, *Substrate* (2003).
- R. Bridson, «Fast Poisson Disk Sampling in Arbitrary Dimensions», SIGGRAPH 2007 sketches.
- P. Kovesi, «Fast Almost-Gaussian Filtering», DICTA 2010.
- G. Rong y T.-S. Tan, «Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform», I3D 2006.
- P. Felzenszwalb y D. Huttenlocher, «Distance Transforms of Sampled Functions», 2012 (render en CPU).

Licencia MIT.
