# Trencadís

Trencadís convierte una foto en un mosaico de azulejo roto, como los bancos del Park Güell. Todo se calcula en el navegador y la foto no sale de tu ordenador. Puedes elegir entre seis algoritmos de teselación, mover todos sus parámetros y ver cada etapa intermedia.

Ábrelo en https://feal-ca.github.io/trencadis/

## Cómo se usa

Sube una foto (o arrástrala encima) o prueba con uno de los dos cuadros de ejemplo. Cada cambio de parámetro recalcula solo las etapas que dependen de él, así que tocar la luz o la junta no vuelve a romper la imagen. Para comparar con la original, mantén pulsado el botón «Mantén para ver la original». El resultado se descarga en PNG y los parámetros se guardan en tu navegador.

## Las etapas

1. Original, reducida a la resolución de trabajo.
2. Detalle D(x): la energía de alta frecuencia |L − blur(L, σ)|, suavizada y normalizada.
3. Tamaño de trozo s(x) = s_max − (s_max − s_min)·D(x)^γ, con trozos pequeños donde hay detalle y grandes en las zonas lisas.
4. Orientación θ(x), sacada del tensor de estructura. El color indica la dirección del borde y el brillo su coherencia, ponderada por la fuerza del gradiente.
5. Estructura propia de cada algoritmo: semillas, grietas o profundidad de corte.
6. Teselación: los contornos de los trozos sobre la foto.
7. Color por trozo, según el estadístico elegido.
8. Paleta y variación: cuantización a una paleta y variación aleatoria del esmalte.
9. Mosaico: junta, bisel, inclinación de cada pieza y brillo Blinn-Phong.

## Los algoritmos

### Fractura recursiva

Empieza con la imagen entera y la va partiendo con rectas hasta que cada trozo tiene el área que pide s(x). En cada corte prueba N rectas candidatas y elige una con probabilidad ∝ exp(−coste/T). El coste es la varianza de color (en Lab) que queda en las dos mitades, más un castigo λ a las astillas. Con temperatura baja los cortes caen sobre los contornos de la foto; con temperatura alta son casi aleatorios. Los cortes también pueden alinearse con θ(x). Cortar polígonos convexos con rectas produce uniones en T, y esas uniones son las que hacen que el resultado parezca roto y no crecido.

### Voronoi centroidal

Semillas repartidas con Poisson-disk de radio variable (Bridson) y relajación de Lloyd ponderada por 1/s(x)². Salen celdas regulares tipo panal, con uniones en Y.

### Voronoi anisótropo

Como el anterior, pero cada semilla mide la distancia con una métrica estirada a lo largo del borde local, como en Hausner (2001). Las piezas se alargan siguiendo los contornos.

### Híbrido

Primero celdas Voronoi más grandes; luego cada una recibe unos pocos cortes rectos de la fractura. Conserva el reparto de tamaños del Voronoi y añade las uniones en T de la fractura.

### Superpíxeles SLIC

K-means local en (L, a, b, x, y), con la separación de cada centro tomada de s(x). La compacidad m regula cuánto se pegan los bordes a la foto. Los contornos se simplifican con Douglas-Peucker para que las aristas queden rectas.

### Grietas

Inspirado en *Substrate*, de Jared Tarbell. Cada grieta nace en un punto interior, aceptado con probabilidad (s_min/s(x))², crece en los dos sentidos y se para al chocar con otra. Puede curvarse y seguir los bordes de la foto.

## Desarrollo

```
npm ci
npm run dev     # servidor local
npm test        # tests del núcleo (Vitest)
npm run build   # sitio estático en dist/
```

El código de imagen está en `src/core/` y no depende del DOM, salvo `vis.js`, que dibuja las etapas con OffscreenCanvas. El cálculo corre en un Web Worker (`src/worker.js`). La interfaz en React se genera a partir del esquema de `src/core/params.js`.

Cada push a `main` se publica en GitHub Pages mediante `.github/workflows/deploy.yml`.

## Créditos

- Los cuadros de ejemplo son de dominio público y vienen de Wikimedia Commons: *La joven de la perla*, de Johannes Vermeer (c. 1665), y *La noche estrellada*, de Vincent van Gogh (1889).
- A. Hausner, «Simulating Decorative Mosaics», SIGGRAPH 2001.
- R. Achanta et al., «SLIC Superpixels Compared to State-of-the-Art Superpixel Methods», IEEE TPAMI 2012.
- J. Tarbell, *Substrate* (2003).
- R. Bridson, «Fast Poisson Disk Sampling in Arbitrary Dimensions», SIGGRAPH 2007 sketches.
- P. Felzenszwalb y D. Huttenlocher, «Distance Transforms of Sampled Functions», 2012.

Licencia MIT.
