import { useEffect, useRef, useState } from 'react';

// Dropping a photo anywhere in the window loads it; without this the browser
// would open the image and the session would be lost. Returns whether a drag
// is over the window.
export function useWindowDrop(onFile) {
  const [over, setOver] = useState(false);
  const cb = useRef(onFile);
  cb.current = onFile;
  useEffect(() => {
    // dragenter/dragleave fire for every child, so the depth says when the drag really left.
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const overFn = (e) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const drop = (e) => {
      e.preventDefault();
      depth = 0;
      setOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) cb.current(file);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return over;
}
