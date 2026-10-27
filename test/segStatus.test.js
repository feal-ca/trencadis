import { describe, expect, it } from 'vitest';
import { SEG_DOWNLOAD_MB, statusOf } from '../src/ui/segStatusText.js';

describe('statusOf', () => {
  it('shows the percentage of the download with a bar', () => {
    expect(statusOf({ phase: 'download', done: 50, total: 200 })).toEqual({
      text: 'Descargando el buscador de formas… 25 %', bar: 25, actions: null,
    });
  });
  it('a finished download says it is preparing, without a bar', () => {
    for (const seg of [{ phase: 'download', done: 200, total: 200 }, { phase: 'download', done: 0, total: 0 }]) {
      expect(statusOf(seg)).toEqual({ text: 'Preparando el buscador de formas…', bar: null, actions: null });
    }
  });
  it('the question gives the measured size', () => {
    const s = statusOf({ phase: 'ask' });
    expect(s.text).toBe(`Buscar las formas de la foto: descarga de unos ${SEG_DOWNLOAD_MB} MB la primera vez`);
    expect(s.actions).toBe('ask');
  });
  it('the other phases keep their texts', () => {
    expect(statusOf({ phase: 'encode' }).text).toBe('Preparando la foto…');
    expect(statusOf({ phase: 'decode', done: 1, total: 4, found: 3 })).toMatchObject({ text: 'Buscando las formas de la foto… 3 encontradas', bar: 25 });
    expect(statusOf({ phase: 'error' })).toMatchObject({ actions: 'retry' });
    expect(statusOf({ phase: 'idle' })).toEqual({ text: null, bar: null, actions: null });
  });
});
