import { describe, expect, it } from 'vitest';
import { ownState } from '../src/ui/engine/historyState.js';

const line = (gen) => ({ points: [[0.1, 0.5], [0.9, 0.5]], mode: 'points', snap: false, gen });
const state = { params: { a: 1 }, macros: { b: 2 }, zones: [{ id: 'z1' }, { id: 'z2' }], guides: [line(1), line(2)] };

describe('ownState', () => {
  it('drops guides of another photo', () => {
    const own = ownState(state, { gen: 2, hasZone: () => true });
    expect(own.guides).toEqual([line(2)]);
  });

  it('drops zones without pixels', () => {
    const own = ownState(state, { gen: 2, hasZone: (id) => id === 'z2' });
    expect(own.zones).toEqual([{ id: 'z2' }]);
  });

  it('keeps everything of the current photo', () => {
    const own = ownState({ ...state, guides: [line(2), line(2)] }, { gen: 2, hasZone: () => true });
    expect(own).toEqual({ ...state, guides: [line(2), line(2)] });
  });
});
