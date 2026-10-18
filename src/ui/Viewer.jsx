import { useEffect, useRef, useState } from 'react';

function ImageCanvas({ image, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !image) return;
    cv.width = image.width;
    cv.height = image.height;
    cv.getContext('2d').putImageData(image, 0, 0);
  }, [image]);
  return <canvas ref={ref} className={className} />;
}

// The big image. The final mosaic is the engine's WebGL canvas, moved into
// this box; intermediate stages are plain ImageData. A faint Eixample grid
// sits behind whatever is shown.
export default function Viewer({ engine, view, onDrop }) {
  const box = useRef(null);
  const host = useRef(null);
  const [peek, setPeek] = useState(false);
  const useGl = view === 'final' && engine.gpu && !peek;

  useEffect(() => {
    if (!useGl || !host.current) return;
    host.current.appendChild(engine.glCanvas);
    return () => engine.glCanvas.remove();
  }, [useGl, engine.glCanvas]);

  useEffect(() => { engine.setWanted(view); }, [view, engine.setWanted]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => engine.setViewport(e.contentRect.width, e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [engine.setViewport]);

  const image = peek ? engine.images.original : engine.images[view];
  const ready = useGl ? engine.mosaicReady : !!image;
  return (
    <div className="viewer chamfer" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <svg className="eixample" aria-hidden="true">
        <defs>
          <pattern id="eixample-grid" width="34" height="34" patternUnits="userSpaceOnUse">
            <path d="M9 3h16l6 6v16l-6 6H9l-6-6V9Z" className="eixample-block" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#eixample-grid)" />
        <line x1="0" y1="100%" x2="100%" y2="8%" className="eixample-diagonal" />
      </svg>
      <div className="viewer-box" ref={box}>
        {useGl ? <div className="viewer-host" ref={host} /> : image && <ImageCanvas image={image} className="viewer-canvas" />}
        {!ready && <p className="viewer-empty">{engine.hasImage ? 'Calculando…' : 'Todavía no hay foto.'}</p>}
      </div>
      <div className="viewer-bar">
        <span className="status" aria-live="polite">
          {engine.error ? <span className="err">{engine.error}</span>
            : engine.busy ? 'Calculando…'
            : engine.info ? `${engine.info.shards.toLocaleString('es')} trozos` : ''}
        </span>
        <button
          type="button"
          className="link"
          onPointerDown={() => setPeek(true)}
          onPointerUp={() => setPeek(false)}
          onPointerLeave={() => setPeek(false)}
          onKeyDown={(e) => e.key === ' ' && setPeek(true)}
          onKeyUp={() => setPeek(false)}
          disabled={!engine.images.original}
        >
          Mantén para ver la original
        </button>
      </div>
    </div>
  );
}
