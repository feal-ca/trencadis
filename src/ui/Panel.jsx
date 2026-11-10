import { useState } from 'react';
import { STYLES } from '../core/macros.js';
import { isVisible, PARAM } from '../core/params.js';
import { OUT_SIZES, printSize } from './exportSize.js';
import { CAN_SHARE } from './engine/useExport.js';
import { Macro, Param } from './Param.jsx';
import { MORE } from './steps.js';

export function Export({ engine }) {
  const { format, setFormat } = engine;
  const label = format === 'jpg' ? 'JPG' : 'PNG';
  const long = engine.params.outLong;
  return (
    <div className="export">
      <div className="seg" role="group" aria-label="Formato">
        <button type="button" className={format === 'png' ? 'on' : ''} aria-pressed={format === 'png'} onClick={() => setFormat('png')} title="Sin pérdida, unos 3,5 MB">PNG</button>
        <button type="button" className={format === 'jpg' ? 'on' : ''} aria-pressed={format === 'jpg'} onClick={() => setFormat('jpg')} title="Mucho más ligero">JPG</button>
      </div>
      <select className="out-size" aria-label="Tamaño de la descarga" value={long} onChange={(e) => engine.setParam('outLong', Number(e.target.value))}
        title={`${printSize(long)}, lado largo`}>
        {[...new Set([...OUT_SIZES, long])].sort((a, b) => a - b).map((n) => (
          <option key={n} value={n} title={`${printSize(n)}, lado largo`}>{n} px</option>
        ))}
      </select>
      <button type="button" className="btn btn-dark chamfer-s download" onClick={() => engine.download(format)} disabled={!engine.mosaicReady}>
        Descargar {label}
      </button>
      {CAN_SHARE && (
        <button type="button" className="btn chamfer-s" onClick={() => engine.share(format)} disabled={!engine.mosaicReady}>
          Compartir
        </button>
      )}
      <label className="sign">
        <input type="checkbox" checked={engine.sign} onChange={(e) => engine.setSign(e.target.checked)} />
        Firmar la imagen
      </label>
      {engine.kofi && (
        <p className="kofi-note">
          <a className="link" href="https://ko-fi.com/fealca" target="_blank" rel="noopener">¿Te gusta? Invítame a un café</a>
          <button type="button" className="link" onClick={engine.closeKofi} aria-label="Cerrar">×</button>
        </p>
      )}
    </div>
  );
}

// One-click looks above the steps. Picking one replaces every setting, so it
// can be undone until the next change.
function Styles({ engine }) {
  const [undo, setUndo] = useState(null);
  if (undo && engine.style !== undo.id) setUndo(null);
  return (
    <div className="styles">
      <div className="styles-row" role="group" aria-label="Estilo">
        {STYLES.map((s) => (
          <button key={s.id} type="button" className={`style${engine.style === s.id ? ' on' : ''}`} aria-pressed={engine.style === s.id}
            onClick={() => { if (engine.style !== s.id) setUndo({ id: s.id, before: engine.setStyle(s.id) }); }}>
            <img className="chamfer-s" src={`./styles/style-${s.id}.jpg`} alt="" />
            <span>{s.label}</span>
          </button>
        ))}
      </div>
      {undo && <button type="button" className="link styles-undo" onClick={() => { engine.restore(undo.before); setUndo(null); }}>Deshacer: volver a mis ajustes</button>}
    </div>
  );
}

// Puts every setting back to its default; until the next change it offers to undo that.
function ResetAll({ engine }) {
  const [undo, setUndo] = useState(null);
  if (undo && !engine.isDefault) setUndo(null);
  const history = (engine.canUndo || engine.canRedo) && (
    <span className="history">
      <button type="button" className="link" onClick={engine.undo} disabled={!engine.canUndo} title="Deshacer el último cambio (Ctrl+Z)" aria-label="Deshacer el último cambio">↶</button>
      <button type="button" className="link" onClick={engine.redo} disabled={!engine.canRedo} title="Rehacer (Ctrl+Mayús+Z)" aria-label="Rehacer">↷</button>
    </span>
  );
  if (!undo && engine.isDefault && !history) return null;
  return (
    <div className="reset-all">
      {history}
      {undo
        ? <button type="button" className="link" onClick={() => { engine.restore(undo); setUndo(null); }}>Deshacer: volver a mis ajustes</button>
        : !engine.isDefault && <button type="button" className="link" onClick={() => setUndo(engine.resetAll())}>Restablecer todos los ajustes</button>}
    </div>
  );
}

// The controls: a style, three sliders, colour and finish, and the rest
// folded away. `withExport` false: the phone sheet shows the export row in
// its own footer. `extras` goes last: the phone's samples and Ko-fi link.
export default function Panel({ engine, withExport = true, extras = null }) {
  return (
    <>
      <Styles engine={engine} />
      <div className="fields panel-group">
        <Macro id="size" engine={engine} />
        <Macro id="fidelity" engine={engine} />
      </div>
      <div className="fields panel-group">
        <span className="group-title">Color y acabado</span>
        <Param k="saturation" engine={engine} />
        <Param k="palette" engine={engine} />
        <Param k="groutColor" engine={engine} />
        <Macro id="gloss" engine={engine} />
      </div>
      <details className="more more-all">
        <summary>Más ajustes</summary>
        {MORE.map((group) => {
          const keys = group.params.filter((k) => isVisible(PARAM[k], engine.params));
          if (!keys.length) return null;
          return (
            <div className="fields panel-group" key={group.title}>
              <span className="group-title">{group.title}</span>
              {keys.map((k) => <Param key={k} k={k} engine={engine} />)}
            </div>
          );
        })}
      </details>
      <ResetAll engine={engine} />
      {withExport && <Export engine={engine} />}
      {extras}
    </>
  );
}
