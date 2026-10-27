import { useRef } from 'react';

const REPO = 'https://github.com/feal-ca/trencadis';

// «Acerca de»: what the app does, what leaves the device, credits and licence.
export default function About() {
  const dialog = useRef(null);
  return (
    <>
      <button type="button" className="link about-link" onClick={() => dialog.current.showModal()}>Acerca de</button>
      <dialog ref={dialog} className="about" aria-labelledby="about-title" onClick={(e) => {
        // Only a click outside the box (on the backdrop), not on its padding.
        const r = dialog.current.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.current.close();
      }}>
        <div className="about-head">
          <h2 id="about-title">Acerca de Trencadís</h2>
          <button type="button" className="link" onClick={() => dialog.current.close()} aria-label="Cerrar">×</button>
        </div>
        <p>Trencadís convierte una foto en un mosaico de azulejo roto, como los bancos del Park Güell, y te deja ver cada paso del algoritmo.</p>
        <h3>Privacidad</h3>
        <ul>
          <li>La foto se procesa en tu navegador y no se sube a ningún sitio.</li>
          <li>La última foto se guarda en este navegador para que no la pierdas al recargar.</li>
          <li>La primera vez que buscas formas se descarga un modelo de Hugging Face y su runtime de jsDelivr. La foto no viaja en ninguna de las dos peticiones.</li>
        </ul>
        <h3>Créditos</h3>
        <ul>
          <li>Los cuadros de ejemplo son de dominio público y vienen de Wikimedia Commons: <i>La joven de la perla</i>, de Johannes Vermeer (c. 1665), y <i>La noche estrellada</i>, de Vincent van Gogh (1889). La foto de las barcas es «El Guamache Bay, Margarita island», también de Wikimedia Commons, con licencia CC0.</li>
          <li>A. Hausner, «Simulating Decorative Mosaics», SIGGRAPH 2001.</li>
          <li>R. Achanta et al., «SLIC Superpixels Compared to State-of-the-Art Superpixel Methods», IEEE TPAMI 2012.</li>
          <li>J. Tarbell, <i>Substrate</i> (2003).</li>
          <li>R. Bridson, «Fast Poisson Disk Sampling in Arbitrary Dimensions», SIGGRAPH 2007 sketches.</li>
          <li>P. Kovesi, «Fast Almost-Gaussian Filtering», DICTA 2010.</li>
          <li>G. Rong y T.-S. Tan, «Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform», I3D 2006.</li>
          <li>P. Felzenszwalb y D. Huttenlocher, «Distance Transforms of Sampled Functions», 2012 (render en CPU).</li>
        </ul>
        <p className="muted">Licencia MIT. Código en <a href={REPO} target="_blank" rel="noopener">{REPO.replace('https://', '')}</a>.</p>
      </dialog>
    </>
  );
}
