import { useCallback, useRef, useState } from 'react';

// A painted mask on a grid with a 256 px long side, so it survives changes of
// working resolution, sent to the worker as message `type` when a stroke ends.
// `rerun()` starts a new run after it is sent. Used by the detail brush
// (values in [-1, 1]) and, in ?lab, the important brush ([0, 1]).
export function useMaskLayer(worker, type, rerun) {
  const mask = useRef(null);
  const [maskVersion, setMaskVersion] = useState(0);
  // Undo: a copy of the mask before each stroke (it is small, 256 px).
  const maskHistory = useRef([]);
  const [canUndoMask, setCanUndoMask] = useState(false);

  const resetMask = useCallback((bmp) => {
    const s = 256 / Math.max(bmp.width, bmp.height);
    const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
    mask.current = { w, h, data: new Float32Array(w * h), empty: true };
    maskHistory.current = [];
    setCanUndoMask(false);
    worker.current?.postMessage({ type, mask: null });
    setMaskVersion((v) => v + 1);
  }, [worker, type]);
  // One soft dab at normalised (u, v); radius as a fraction of the long side.
  const paint = useCallback((u, v, radius, target) => {
    const m = mask.current;
    if (!m) return;
    const L = Math.max(m.w, m.h), r = radius * L;
    const cx = u * m.w, cy = v * m.h;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(m.h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(m.w - 1, Math.ceil(cx + r)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
        if (d >= 1) continue;
        // Gaussian falloff: strong in the middle, nothing at the rim.
        const k = 0.3 * Math.exp(-4 * d * d) * (1 - d);
        const i = y * m.w + x;
        m.data[i] += (target - m.data[i]) * k;
      }
    }
    m.empty = false;
    setMaskVersion((x) => x + 1);
  }, []);
  const beginStroke = useCallback(() => {
    const m = mask.current;
    if (!m) return;
    maskHistory.current = [...maskHistory.current.slice(-19), { data: Float32Array.from(m.data), empty: m.empty }];
    setCanUndoMask(true);
  }, []);
  const commitMask = useCallback(() => {
    const m = mask.current;
    if (!m || !worker.current) return;
    worker.current.postMessage({ type, mask: m.empty ? null : { w: m.w, h: m.h, data: Float32Array.from(m.data) } });
    rerun();
  }, [worker, type, rerun]);
  const clearMask = useCallback(() => {
    const m = mask.current;
    if (!m) return;
    beginStroke();
    m.data.fill(0);
    m.empty = true;
    setMaskVersion((x) => x + 1);
    commitMask();
  }, [commitMask, beginStroke]);
  // Puts back the mask from before the last stroke. With `commit` false it
  // only restores the pixels (a stroke cancelled before it was sent).
  const undoMask = useCallback((commit = true) => {
    const m = mask.current, prev = maskHistory.current.pop();
    setCanUndoMask(maskHistory.current.length > 0);
    if (!m || !prev) return;
    m.data.set(prev.data);
    m.empty = prev.empty;
    setMaskVersion((x) => x + 1);
    if (commit) commitMask();
  }, [commitMask]);

  return { mask, maskVersion, resetMask, paint, beginStroke, commitMask, clearMask, undoMask, canUndoMask };
}
