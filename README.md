# Trencadís

Trencadís convierte una foto en un mosaico de azulejo roto, como los bancos del Park Güell. Todo se calcula en el navegador y la foto no sale de tu ordenador.

Ábrelo en https://feal-ca.github.io/trencadis/

## Cómo se usa

En la entrada eliges entre dos modos y subes una foto (o usas uno de los dos cuadros de ejemplo). Puedes cambiar de modo en cualquier momento sin perder lo que has ajustado.

**Hazlo ya.** El mosaico en grande, cuatro estilos y tres controles: tamaño de los trozos, parecido a la foto y brillo del esmalte.

**Paso a paso.** Cinco pasos: Foto, Detalle, Trozos, Color y Acabado. Cada uno enseña su imagen intermedia, explica qué hace (con la fórmula desplegable) y muestra solo los controles que le afectan.

En los dos modos, el interruptor Simple / Avanzado muestra todos los parámetros reales del paso, cada uno con una línea que dice qué pasa al subirlo o bajarlo. Los controles simples mueven varios parámetros a la vez; si después tocas uno a mano, el control simple pasa a «personalizado».

El acabado (junta, bisel, luz, brillo) se dibuja en la tarjeta gráfica y responde al momento. Mientras arrastras un control de detalle o de trozos se calcula una vista previa a media resolución, y al soltarlo, el resultado completo. El PNG se descarga al tamaño elegido en Acabado.

## Cómo funciona

1. **Detalle.** Se mide la energía de alta frecuencia D(x) = |L − desenfoque(L, σ)|, suavizada y normalizada. De ahí sale el tamaño de trozo s(x) = s_max − (s_max − s_min)·D(x)^γ, y del tensor de estructura, la dirección de los bordes θ(x). Los desenfoques son tres pasadas de box blur con el σ exacto (Kovesi). En imágenes grandes los mapas se calculan a media resolución y se interpolan, porque son suaves.
2. **Trozos.** Seis métodos:
   - Cortes rectos: se parte la imagen con rectas hasta llegar al tamaño pedido. En cada corte se prueban N rectas y se elige una con probabilidad ∝ exp(−coste/T), donde el coste es la varianza de color que queda en las dos mitades más un castigo a las astillas. Salen uniones en T, como en el azulejo roto.
   - Grietas: inspirado en *Substrate* de Jared Tarbell. Cada grieta nace en un punto interior y crece en los dos sentidos hasta chocar con otra.
   - Teselas redondeadas: Voronoi con semillas de Poisson-disk de radio variable (Bridson) y relajación de Lloyd ponderada por 1/s(x)².
   - Teselas alargadas: Voronoi con una métrica estirada a lo largo de los bordes, como en Hausner (2001).
   - Teselas partidas: teselas redondeadas grandes que reciben unos pocos cortes rectos.
   - Manchas de color: superpíxeles SLIC con la separación tomada de s(x) y bordes simplificados con Douglas-Peucker.
3. **Color.** Un color por trozo (media, más vivo, el más frecuente, mediana o el del centro), con paleta opcional (k-means de la foto o un juego fijo de azulejos de taller) y una pequeña variación al azar.
4. **Acabado.** En WebGL2: los trozos se triangulan con earcut y se dibujan con su índice; un jump flood da a cada píxel la distancia al borde más cercano; el último pase pinta la junta, el bisel, la inclinación de cada trozo y un brillo Blinn-Phong. Si el navegador no tiene WebGL2, el mismo acabado se calcula en la CPU.

## Desarrollo

```
npm ci
npm run dev                  # servidor local
npm test                     # tests del núcleo (Vitest)
npm run build                # sitio estático en dist/
node scripts/bench.mjs       # tiempos por etapa en una imagen sintética
node scripts/thumbs.mjs      # regenera las miniaturas de public/styles/
```

`scripts/thumbs.mjs` necesita Chromium; usa `/usr/bin/chromium-browser` o la ruta de la variable `CHROMIUM`. Con el servidor de desarrollo arrancado, `test/browser/gl.html` comprueba el renderer WebGL y mide los fps, y añadir `?debug` a la URL de la app guarda los tiempos de cada cálculo en `window.__runs`.

El código de imagen está en `src/core/` y no depende del DOM, salvo `vis.js`, que dibuja las etapas con OffscreenCanvas. El cálculo corre en un Web Worker (`src/worker.js`) y el render en `src/gl/`. La interfaz en React está en `src/ui/`; los pasos y sus textos, en `src/ui/steps.js`, y la ayuda de cada parámetro, en `src/core/params.js`.

Cada push a `main` se publica en GitHub Pages mediante `.github/workflows/deploy.yml`.

## Créditos

- Los cuadros de ejemplo son de dominio público y vienen de Wikimedia Commons: *La joven de la perla*, de Johannes Vermeer (c. 1665), y *La noche estrellada*, de Vincent van Gogh (1889).
- A. Hausner, «Simulating Decorative Mosaics», SIGGRAPH 2001.
- R. Achanta et al., «SLIC Superpixels Compared to State-of-the-Art Superpixel Methods», IEEE TPAMI 2012.
- J. Tarbell, *Substrate* (2003).
- R. Bridson, «Fast Poisson Disk Sampling in Arbitrary Dimensions», SIGGRAPH 2007 sketches.
- P. Kovesi, «Fast Almost-Gaussian Filtering», DICTA 2010.
- G. Rong y T.-S. Tan, «Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform», I3D 2006.
- P. Felzenszwalb y D. Huttenlocher, «Distance Transforms of Sampled Functions», 2012 (render en CPU).

Licencia MIT.
