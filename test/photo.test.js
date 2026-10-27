import { describe, expect, it } from 'vitest';
import { fitLong, isImage, MAX_PHOTO_LONG, photoName } from '../src/ui/photo.js';

describe('fitLong', () => {
  it('scales the long side down to the limit', () => {
    expect(fitLong(4000, 3000, 3200)).toEqual([3200, 2400]);
    expect(fitLong(12000, 2000, 3200)).toEqual([3200, 533]);
  });
  it('keeps what already fits and never goes below 1', () => {
    expect(fitLong(800, 600, 3200)).toEqual([800, 600]);
    expect(fitLong(1, 9000, 3200)).toEqual([1, 3200]);
  });
  it('limit is 3200', () => expect(MAX_PHOTO_LONG).toBe(3200));
});

describe('photoName', () => {
  it('drops the extension and cleans the rest', () => {
    expect(photoName({ name: 'IMG_1234.HEIC' })).toBe('IMG_1234');
    expect(photoName({ name: 'mi foto (1).jpg' })).toBe('mi-foto-1');
    expect(photoName({ name: 'Ñandú.png' })).toBe('Ñandú');
  });
  it('caps the length and falls back to foto', () => {
    expect(photoName({ name: 'a'.repeat(80) + '.jpg' })).toHaveLength(40);
    expect(photoName(new Blob(['x']))).toBe('foto');
    expect(photoName({ name: '***.png' })).toBe('foto');
  });
});

describe('isImage', () => {
  it('accepts images and HEIC by name', () => {
    expect(isImage({ type: 'image/webp' })).toBe(true);
    expect(isImage({ type: '', name: 'a.HEIC' })).toBe(true);
  });
  it('rejects the rest', () => {
    expect(isImage({ type: 'application/pdf', name: 'a.pdf' })).toBe(false);
  });
});
