import { describe, expect, it } from 'vitest';
import { createHistory } from '../src/core/history.js';

describe('settings history', () => {
  it('undoes and redoes recorded states in order', () => {
    const h = createHistory({ a: 1 });
    h.record({ a: 2 });
    h.record({ a: 3 });
    expect(h.undo()).toEqual({ a: 2 });
    expect(h.undo()).toEqual({ a: 1 });
    expect(h.undo()).toBeNull();
    expect(h.redo()).toEqual({ a: 2 });
    expect(h.redo()).toEqual({ a: 3 });
    expect(h.redo()).toBeNull();
  });

  it('ignores a state equal to the current one (such as the one undo just applied)', () => {
    const h = createHistory({ a: 1 });
    h.record({ a: 2 });
    h.record({ a: 2 });
    expect(h.undo()).toEqual({ a: 1 });
    h.record({ a: 1 });
    expect(h.canRedo).toBe(true);
  });

  it('a new change after undo drops the redo branch', () => {
    const h = createHistory({ a: 1 });
    h.record({ a: 2 });
    h.undo();
    h.record({ a: 5 });
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toEqual({ a: 1 });
  });

  it('matches tells whether a state is the current one', () => {
    const h = createHistory({ a: 1 });
    expect(h.matches({ a: 1 })).toBe(true);
    expect(h.matches({ a: 2 })).toBe(false);
  });

  it('keeps at most `limit` steps', () => {
    const h = createHistory({ a: 0 }, 3);
    for (let i = 1; i <= 10; i++) h.record({ a: i });
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(3);
  });
});

describe('rebase', () => {
  it('makes a state current with nothing to undo or redo', () => {
    const h = createHistory({ a: 1 });
    h.record({ a: 2 });
    h.undo();
    h.rebase({ a: 9 });
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.matches({ a: 9 })).toBe(true);
    h.record({ a: 10 });
    expect(h.undo()).toEqual({ a: 9 });
  });
});
