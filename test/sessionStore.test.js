import { describe, expect, it } from 'vitest';
import { fromSnapshot, toSnapshot } from '../src/ui/engine/sessionStore.js';

describe('session snapshot', () => {
  it('keeps a sample by its src and a photo as a blob', () => {
    expect(fromSnapshot(toSnapshot({ sample: './samples/vermeer.webp', name: 'vermeer' }))).toEqual({ v: 2, sample: './samples/vermeer.webp', photo: null, name: 'vermeer' });
    const photo = new Blob(['x'], { type: 'image/jpeg' });
    expect(fromSnapshot(toSnapshot({ photo, name: 'mine' })).photo).toBe(photo);
  });
  it('rejects other versions and snapshots without a photo', () => {
    expect(fromSnapshot(null)).toBeNull();
    expect(fromSnapshot({ v: 1, sample: './samples/vermeer.webp' })).toBeNull();
    expect(fromSnapshot({ v: 2, sample: null, photo: 'not a blob' })).toBeNull();
  });
  it('falls back to a plain name', () => {
    expect(fromSnapshot({ v: 2, sample: './s.webp', name: 5 }).name).toBe('foto');
  });
});
