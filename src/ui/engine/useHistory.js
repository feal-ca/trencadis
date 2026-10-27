import { useCallback, useEffect, useRef, useState } from 'react';
import { createHistory } from '../../core/history.js';

// Undo/redo of `state` ({ params, macros, zones }): a step is recorded once
// changes pause for 500 ms, so dragging a slider is one step. `apply` puts a
// recorded state back.
export function useHistory({ state, apply }) {
  const history = useRef(null);
  history.current ??= createHistory(state);
  const [, setHistoryVersion] = useState(0);
  const pending = useRef(null);
  const flushHistory = useCallback(() => {
    clearTimeout(pending.current?.timer);
    if (pending.current) history.current.record(pending.current.state);
    pending.current = null;
  }, []);
  useEffect(() => {
    const recorded = { params: state.params, macros: state.macros, zones: state.zones };
    clearTimeout(pending.current?.timer);
    pending.current = { state: recorded, timer: setTimeout(() => { flushHistory(); setHistoryVersion((v) => v + 1); }, 500) };
  }, [state.params, state.macros, state.zones, flushHistory]);
  const travel = (dir) => {
    flushHistory();
    const s = dir < 0 ? history.current.undo() : history.current.redo();
    if (s) apply(s);
    setHistoryVersion((v) => v + 1);
  };

  return {
    undo: () => travel(-1),
    redo: () => travel(1),
    // A change not recorded yet can be undone too.
    canUndo: history.current.canUndo || !history.current.matches(state),
    canRedo: history.current.canRedo,
  };
}
