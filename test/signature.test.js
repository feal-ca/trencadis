import { describe, expect, it } from 'vitest';
import { signatureBox } from '../src/ui/signature.js';

describe('signatureBox', () => {
  it('sits in the bottom-right corner, scaled with the long side', () => {
    expect(signatureBox(2000, 1500)).toEqual({ x: 1976, y: 1476, size: 28 });
  });
  it('keeps a legible minimum size on small images', () => {
    expect(signatureBox(300, 200)).toEqual({ x: 296, y: 196, size: 11 });
  });
});
