import { useEffect, useRef, useState } from 'react';

// Hand-drawn guide lines, polylines in normalised image coordinates. Each one
// carries `gen`, the photo generation it was drawn on, so the history can tell
// lines of an earlier photo. The pipeline worker gets them from an effect, so
// undo and redo redo the mosaic as well.
export function useGuides({ worker, rerun, photoGen }) {
  const [guides, setGuides] = useState([]);
  const sentGuides = useRef('[]');
  useEffect(() => {
    const key = JSON.stringify(guides);
    if (key === sentGuides.current || !worker.current) return;
    sentGuides.current = key;
    worker.current.postMessage({ type: 'guides', guides: guides.map(({ gen, ...g }) => g) });
    rerun();
  }, [guides, rerun, worker]);
  // A new photo: no guides, and the pipeline worker is told so.
  const resetGuides = () => {
    setGuides([]);
    sentGuides.current = '[]';
    worker.current?.postMessage({ type: 'guides', guides: [] });
  };

  return {
    guides, resetGuides,
    restoreGuides: setGuides,
    addGuide: (g) => setGuides((gs) => [...gs, { ...g, gen: photoGen.current }]),
    clearGuides: () => setGuides([]),
    undoGuide: () => setGuides((gs) => gs.slice(0, -1)),
  };
}
