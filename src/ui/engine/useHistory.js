import { useCallback, useEffect, useRef, useState } from 'react';
import { createHistory } from '../../core/history.js';

// Undo/redo of `state` ({ params, macros, zones, guides }): a step is recorded once
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
  // Set by rebaseNext(): the next state that shows up becomes the start of the history.
  const rebasing = useRef(false);
  useEffect(() => {
    const recorded = { params: state.params, macros: state.macros, zones: state.zones, guides: state.guides };
    clearTimeout(pending.current?.timer);
    if (rebasing.current) {
      rebasing.current = false;
      pending.current = null;
      history.current.rebase(recorded);
      setHistoryVersion((v) => v + 1);
      return;
    }
    pending.current = { state: recorded, timer: setTimeout(() => { flushHistory(); setHistoryVersion((v) => v + 1); }, 500) };
  }, [state.params, state.macros, state.zones, state.guides, flushHistory]);
  const travel = (dir) => {
    flushHistory();
    const s = dir < 0 ? history.current.undo() : history.current.redo();
    if (s) apply(s);
    setHistoryVersion((v) => v + 1);
  };

  return {
    // For a state set from outside (a restored session): the next change of
    // `state` is taken as the starting point, with no step to undo.
    rebaseNext: () => { rebasing.current = true; },
    undo: () => travel(-1),
    redo: () => travel(1),
    // A change not recorded yet can be undone too.
    canUndo: history.current.canUndo || !history.current.matches(state),
    canRedo: history.current.canRedo,
  };
}
