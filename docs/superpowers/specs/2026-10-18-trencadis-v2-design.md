# Trencadís v2: interfaz guiada y render en tiempo real

## Intención

Trencadís es un proyecto por diversión: una web donde subes una foto y sale un mosaico de trencadís para enseñar a amigos. La v1 funciona y el resultado gusta, pero tiene tres problemas que esta versión resuelve:

1. Cuesta entender qué hace el algoritmo y qué cambia cada parámetro.
2. Cada cambio tarda de 3 a 4 segundos. La meta es tiempo real, o casi.
3. La interfaz parece de proyecto técnico: una columna larga de ajustes con scroll, un fondo azul (el modo oscuro) y nombres que no se entienden («Vermeer», «Park Güell», «Reconocible»).

## Objetivos

- Dos maneras de usarla: «Hazlo ya» (directo) y «Paso a paso» (guiado), y en las dos un interruptor Simple / Avanzado.
- En el modo guiado, cada paso enseña su imagen intermedia, una explicación corta y solo los controles que le afectan.
- Los parámetros de acabado (junta, luz, brillo, bisel) y de color responden en tiempo real. Los de análisis y teselación dan una vista previa mientras se arrastra el slider y el resultado completo al soltarlo.
- Una estética tranquila y artesanal con unos pocos guiños a Barcelona.

## Fuera de alcance

- Cuentas, galería compartida o cualquier cosa con servidor. Sigue siendo un sitio estático en GitHub Pages.
- Algoritmos de teselación nuevos. Los seis actuales se mantienen tal cual, salvo el cambio de desenfoque.
- Recortar o editar la foto.

## Lo que haría que fallara aunque funcione

- Volver a una columna de controles con scroll.
- Textos con eslóganes o gracietas. Los textos son secos y descriptivos.
- Recargar la estética de Barcelona. Cada elemento va en un solo sitio.
- Que el modo simple esconda tanto que no se entienda qué pasa.

## Flujo (decidido)

Navegación por hash, sin librería de rutas: `#/`, `#/rapido`, `#/pasos/<paso>`.

**Entrada (`#/`).** Tres piezas en fila: «Hazlo ya» (miniatura de un mosaico), «Paso a paso» (original junto a la teselación) y el recuadro para subir o arrastrar una foto. Debajo, «Cuadros de ejemplo: Vermeer, Van Gogh». Al elegir una foto se queda en la entrada hasta que eliges uno de los dos modos; si llegas a un modo sin foto, se carga Vermeer.

**Hazlo ya (`#/rapido`).** El mosaico en grande. A la derecha:
- Estilo: cuatro tarjetas con miniatura y nombre descriptivo. Cada una es un preset que fija el método y el color y deja los macros donde estén:
  - «Cortes rectos»: fractura, sin paleta, color medio.
  - «Azulejos de taller»: fractura, paleta de azulejos de taller al 85 %, color más vivo, saturación 1,25.
  - «Grietas»: grietas, sin paleta.
  - «Teselas redondeadas»: Voronoi centroidal, sin paleta.
- Tres sliders simples: «Tamaño de los trozos», «Parecido a la foto» y «Brillo del esmalte».
- «Descargar PNG» y «Ver paso a paso».
- En Avanzado se muestran además todos los parámetros, agrupados por paso en pestañas compactas dentro del mismo panel, sin scroll largo.

**Paso a paso (`#/pasos/foto|detalle|trozos|color|acabado`).** Pestañas numeradas 1–5 en la cabecera. Cada paso tiene:
- La imagen del paso en grande. Si el paso tiene varias vistas, un selector debajo (Detalle: detalle / tamaño / orientación; Trozos: contornos / estructura; Color: color por trozo / paleta).
- Un panel con el título del paso, una explicación de 2 o 3 frases y «Ver la fórmula» desplegable.
- Los controles del paso. En Simple, 1–3 controles; en Avanzado, todos los parámetros reales del paso, cada uno con una línea de ayuda que dice qué pasa al subirlo y al bajarlo.
- Botones «← anterior» y «siguiente →». En Acabado, «Descargar PNG».
- En Trozos, el selector de método: dos métodos visibles (Cortes rectos, Grietas) con miniatura y una línea, y «4 métodos más» plegado. Y el botón «Otra versión ↻», que cambia la semilla.

Se puede pasar de un modo a otro en cualquier momento sin perder nada, porque los parámetros son los mismos.

## Controles simples como macros (mi decisión)

Cada slider simple va de 0 a 1 y fija a la vez varios parámetros reales:

| Macro | Parámetros que fija |
|---|---|
| Tamaño de los trozos `t` | sMin = 4 + 7,5·t, sMax = 16 + 50·t |
| Parecido a la foto `f` | γ = 1,6 − 1,1·f para todos; fractura e híbrido: T = 10^(0,3 − 2,3·f), seguir contornos = 0,8·f, ruido de ángulo = 60 − 50·f; SLIC: compacidad = 40 − 34·f; Voronoi anisótropo: anisotropía = 5·f; grietas: seguir contornos = 0,8·f, ruido de ángulo = 30 − 26·f |
| Brillo del esmalte `g` | brillo = 1,2·g, inclinación = 0,02 + 0,28·g, dureza = 10^(1,2 + g) |

Al mover un macro se sobrescriben sus parámetros. Si después se toca a mano uno de ellos en Avanzado, el macro muestra «personalizado» hasta que se vuelva a mover. Los valores por defecto de los macros reproducen aproximadamente los de la v1.

Controles simples de cada paso:
- Foto: subir o arrastrar, y los cuadros de ejemplo.
- Detalle: «Tamaño de los trozos» y «Sensibilidad al detalle» (γ).
- Trozos: método, «Parecido a la foto» y «Otra versión».
- Color: «Color de cada trozo» (media, más vivo, dominante, mediana, centro), «Paleta» (colores de la foto, azulejos de taller, ninguna) y «Saturación».
- Acabado: «Ancho de la junta», «Brillo del esmalte» y «Dirección de la luz».

## Textos (decidido)

Secos y descriptivos, sin eslóganes. Ni el título ni la entrada llevan frase promocional. Los nombres de los ejemplos dicen qué son («Cuadros de ejemplo: Vermeer, Van Gogh»). Cada paso tiene una explicación en lenguaje llano; la fórmula va aparte, desplegable. Las ayudas de los parámetros siguen el patrón «Más alto: …; más bajo: …».

## Estética (decidida)

- Fondo de cal (`#f7f6f2`), paneles blancos, texto casi negro cálido (`#25221e`) y gris (`#6b655c`) para lo secundario. Los colores de cerámica (cobalto `#2856a5`, ocre `#d8a032`, verde `#3f8a68`, rojo `#c4542f`) aparecen solo en la tira de trencadís de la cabecera y en detalles pequeños.
- Titulares en Gloock y el resto en Figtree, servidas con @fontsource.
- Barcelona, cada elemento en un solo sitio:
  - el chaflán del Eixample (esquinas cortadas a 45° con `clip-path`) en paneles y botones;
  - el panot de flor, muy tenue, solo dentro del recuadro de subir la foto;
  - la cuadrícula del Eixample con la Diagonal, aún más tenue que en la maqueta, solo detrás de la imagen.
- Modo oscuro en grises cálidos, nunca azul.
- Responsive hasta móvil: en pantallas estrechas el panel de controles pasa debajo de la imagen.

## Velocidad (decidida)

**Render en WebGL2 en el hilo principal.** El worker deja de rasterizar el mosaico final y manda los polígonos de los trozos, sus colores y la semilla. En la GPU:

1. Pasada de identidad: los trozos, triangulados con `earcut` (hace falta porque SLIC, grietas y Voronoi anisótropo dan polígonos no convexos), se dibujan con su índice codificado en RGB. Primero los más grandes.
2. Semillas: los píxeles donde el índice cambia respecto al vecino guardan su propia coordenada.
3. Jump Flood: log2(lado) pasadas dan, para cada píxel, el punto de borde más cercano. La distancia al borde es su módulo y la dirección hacia dentro sale del vector, que sustituye al gradiente del bisel.
4. Sombreado: junta con antialiasing por `smoothstep` + `fwidth` (sin supersampling), bisel, inclinación por trozo, Blinn-Phong y grano del esmalte. Color e inclinación de cada trozo salen de una textura de datos.

Cambiar el acabado solo repite la pasada 4. Cambiar colores sube la textura de datos y repite la 4. Cambiar la teselación repite de la 1 a la 4. La descarga renderiza fuera de pantalla al tamaño de salida. Si no hay WebGL2, se usa el render de CPU actual en el worker.

**Análisis más rápido.** Desenfoque con tres pasadas de box blur y σ exacto (anchos mixtos, método de Kovesi). El percentil se calcula con histograma en vez de ordenar. Un test compara el box blur con la gaussiana y exige un error máximo menor del 3 % del rango.

**Vista previa al arrastrar.** Mientras un slider de análisis o teselación está en movimiento, el worker calcula a la mitad de la resolución de trabajo; al soltarlo, a resolución completa. Las ejecuciones viejas se descartan entre etapas, como ahora.

**Objetivos medidos** con Vermeer a 800 px: acabado a ≥30 fps en el navegador; color en < 150 ms; vista previa de teselación en < 400 ms; resultado completo en < 1,5 s. Se miden antes y después y se informa de los números.

## Lo que queda a criterio de quien lo construya

- La estructura de componentes de React y los nombres de archivos.
- Las miniaturas de estilo: imágenes estáticas pregeneradas a partir de Vermeer.
- Los textos exactos de las explicaciones y las ayudas, respetando el tono descrito.
- El dibujo exacto del panot y de la cuadrícula del Eixample.

## Revisión v3 (2026-10-18, tras probar la v2)

Sustituye al flujo de dos modos.

- **Una sola vista.** Se abre directamente con el mosaico (Vermeer por defecto). Cabecera: nombre, «Subir foto», cuadros de ejemplo y «Descargar PNG». Panel con cuatro secciones numeradas en acordeón (una abierta a la vez): 1 Detalle, 2 Trozos, 3 Colores, 4 Acabado. Cada sección tiene sus controles simples, «Más ajustes» con los avanzados, «¿Qué hace?» plegable y «Ver este paso», que cambia la imagen grande al resultado parcial del paso. Desaparecen la entrada, «Hazlo ya» / «Paso a paso», el interruptor Simple / Avanzado y los cuatro estilos. El panot pasa al aviso de soltar foto sobre la imagen.
- **Cortes rectos sin costuras largas.** La fractura parte de una base de azulejos irregulares (Voronoi con separación «tamaño de azulejo base» × s(x), por defecto 3,5) que luego se rompen.
- **Colocación a mano.** Cada pieza gira (hasta ±6°), se desplaza y encoge un poco según un parámetro de acabado de 0 a 1, en la GPU y con la misma fórmula en el render de CPU.
- **Grietas sin astillas.** Una grieta no nace a menos de «separación mínima» × s(x) de otra. Tras grietas, SLIC y teselas alargadas, las regiones cuyo grosor (2 × radio inscrito) es menor que «grosor mínimo» × s(x) se funden con el vecino con el que comparten más borde.
- **Ignorar texturas.** Slider de análisis: rebaja el detalle donde la coherencia del tensor es baja (detalle sin dirección, como reflejos o césped).
- **Pincel de detalle.** En la sección Detalle: quitar o añadir detalle pintando sobre la foto, con tamaño de pincel y «Borrar pincel». La máscara se guarda a 256 px de lado largo, independiente de la resolución de trabajo, y entra en el análisis.
