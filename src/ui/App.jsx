import { useEffect, useRef, useState } from 'react';
import Extras from './Extras.jsx';
import Panel, { Export } from './Panel.jsx';
import Sheet from './Sheet.jsx';
import { useEngine } from './useEngine.js';
import { MOBILE, useMedia } from './useMedia.js';
import { useWindowDrop } from './useWindowDrop.js';
import Viewer from './Viewer.jsx';

export default function App() {
  const engine = useEngine();
  const input = useRef(null);
  const dropping = useWindowDrop(engine.loadBlob);
  // Phones: the steps live in a bottom sheet and the image fills the rest.
  const mobile = useMedia(MOBILE);
  const [snap, setSnap] = useState('half');
  const [sheetH, setSheetH] = useState(0);

  // Ctrl+Z / Ctrl+Shift+Z: the history of the settings.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const redo = (key === 'z' && e.shiftKey) || key === 'y';
      if (key !== 'z' && !redo) return;
      if (e.target.matches?.('input[type=text], input[type=number], textarea')) return;
      e.preventDefault();
      if (redo) engine.redo();
      else engine.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // R: another version; D: download in the current format. Not while typing
  // or choosing in a control, and not with a modifier.
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
      if (e.target.closest?.('input, select, textarea, [contenteditable], dialog')) return;
      const key = e.key.toLowerCase();
      if (key === 'r' && engine.hasImage) engine.reseed();
      else if (key === 'd' && engine.mosaicReady) engine.download(engine.format);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Ctrl+V / Cmd+V with an image on the clipboard loads it.
  const { loadBlob } = engine;
  useEffect(() => {
    const onPaste = (e) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (!file) return;
      e.preventDefault();
      loadBlob(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [loadBlob]);

  const panel = <Panel engine={engine} withExport={!mobile} extras={mobile ? <div className="extras"><Extras engine={engine} /></div> : null} />;

  return (
    <div className={`app${mobile ? ' is-mobile' : ''}`} style={mobile ? { '--sheet-h': `${sheetH}px` } : undefined}>
      <div className="strip" aria-hidden="true" />
      <header className="top">
        <h1 className="brand-block">
          <span className="brand">Trencadís</span>
          {!mobile && <span className="tagline">Tu foto hecha mosaico, sin salir de tu dispositivo</span>}
        </h1>
        <button type="button" className="btn btn-dark chamfer-s" onClick={() => input.current.click()} title="También puedes arrastrarla aquí o pegarla con Ctrl+V">Subir foto</button>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && engine.loadBlob(e.target.files[0])} />
        {!mobile && <Extras engine={engine} />}
      </header>
      <main className="work">
        <div className="work-main">
          <Viewer engine={engine} dropping={dropping} />
        </div>
        {mobile
          ? <Sheet snap={snap} setSnap={setSnap} onHeight={setSheetH} footer={<Export engine={engine} />}>{panel}</Sheet>
          : <aside className="side">{panel}</aside>}
      </main>
    </div>
  );
}
