import { useCallback, useState } from 'react';

// Hand-drawn guide lines, polylines in normalised image coordinates.
export function useGuides({ worker, post, effectiveRef }) {
  const [guides, setGuides] = useState([]);
  const commitGuides = useCallback((list) => {
    setGuides(list);
    if (!worker.current) return;
    worker.current.postMessage({ type: 'guides', guides: list });
    post(effectiveRef.current);
  }, [post]);
  // A new photo: no guides, and the pipeline worker is told so.
  const resetGuides = () => {
    setGuides([]);
    worker.current?.postMessage({ type: 'guides', guides: [] });
  };

  return {
    guides, resetGuides,
    addGuide: (g) => commitGuides([...guides, g]),
    clearGuides: () => commitGuides([]),
    undoGuide: () => commitGuides(guides.slice(0, -1)),
  };
}
