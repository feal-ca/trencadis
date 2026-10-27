// Undo/redo over whole states (here: every setting). `record` is called with
// the state once it has settled; recording the state already current, as
// happens right after an undo is applied, does nothing.
export function createHistory(initial, limit = 50) {
  let current = initial;
  let key = JSON.stringify(initial);
  const back = [], forward = [];
  const set = (s) => { current = s; key = JSON.stringify(s); return s; };
  return {
    record(s) {
      const k = JSON.stringify(s);
      if (k === key) return;
      back.push(current);
      if (back.length > limit) back.shift();
      forward.length = 0;
      current = s;
      key = k;
    },
    undo() {
      if (!back.length) return null;
      forward.push(current);
      return set(back.pop());
    },
    redo() {
      if (!forward.length) return null;
      back.push(current);
      return set(forward.pop());
    },
    // Makes `s` the only state: nothing to undo or redo. For a state that comes
    // from outside the user's edits, such as a restored session.
    rebase(s) {
      back.length = 0;
      forward.length = 0;
      set(s);
    },
    matches: (s) => JSON.stringify(s) === key,
    get canUndo() { return back.length > 0; },
    get canRedo() { return forward.length > 0; },
  };
}
