import { useRef } from 'react';
import { SAMPLES } from './useEngine.js';

export function Panot() {
  return (
    <svg className="panot" aria-hidden="true">
      <defs>
        <pattern id="panot-flor" width="40" height="40" patternUnits="userSpaceOnUse">
          <g className="panot-line">
            <circle cx="20" cy="12" r="6" /><circle cx="20" cy="28" r="6" />
            <circle cx="12" cy="20" r="6" /><circle cx="28" cy="20" r="6" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#panot-flor)" />
    </svg>
  );
}

// Drop box for a photo, the only place the panot appears.
export function UploadBox({ engine, compact = false }) {
  const input = useRef(null);
  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) engine.loadBlob(f);
  };
  return (
    <div
      className={`upload chamfer${compact ? ' upload-compact' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Panot />
      <div className="upload-body">
        <button type="button" className="btn btn-dark chamfer-s" onClick={() => input.current.click()}>
          {engine.hasImage ? 'Cambiar la foto' : 'Subir una foto'}
        </button>
        <span className="muted">o arrástrala aquí</span>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && engine.loadBlob(e.target.files[0])} />
      </div>
    </div>
  );
}

export function Samples({ engine }) {
  return (
    <p className="samples muted">
      Cuadros de ejemplo:{' '}
      {SAMPLES.map((s, i) => (
        <span key={s.src}>
          {i > 0 && ', '}
          <button type="button" className="link" onClick={() => engine.loadSample(s.src)}>{s.label}</button>
        </span>
      ))}
    </p>
  );
}

export default function Home({ engine }) {
  return (
    <main className="home">
      <div className="doors">
        <a className="door chamfer" href="#/rapido">
          <span className="door-img chamfer-s"><img src="./styles/rectos.jpg" alt="" /></span>
          <b>Hazlo ya</b>
          <span className="muted">Eliges un estilo y ajustas lo justo.</span>
        </a>
        <a className="door chamfer" href="#/pasos/foto">
          <span className="door-img door-pair chamfer-s">
            <img src="./samples/vermeer.jpg" alt="" />
            <img src="./styles/contornos.jpg" alt="" />
          </span>
          <b>Paso a paso</b>
          <span className="muted">Cada etapa con su imagen y sus controles.</span>
        </a>
        <UploadBox engine={engine} />
      </div>
      <Samples engine={engine} />
      {engine.hasImage && <p className="muted">Foto cargada. Elige cómo quieres seguir.</p>}
    </main>
  );
}
