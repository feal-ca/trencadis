import { describe, expect, it } from 'vitest';
import { applyMacro, applyMacroDefaults, applyStyle, macroKeys, MACROS, readMacro, readStyle, STYLES } from '../src/core/macros.js';
import { DEFAULTS } from '../src/core/params.js';

const close = (a, b) => expect(a).toBeCloseTo(b, 4);

describe('macros', () => {
  it('size 0.4 gives sMin 7 and sMax 36', () => {
    const p = applyMacro(DEFAULTS, 'size', 0.4);
    close(p.sMin, 7);
    close(p.sMax, 36);
  });

  it('fidelity 1 on fracture gives T 0.01, edgeAlign 0.8, angleNoise 10 and leaves gamma alone', () => {
    const p = applyMacro({ ...DEFAULTS, algorithm: 'fracture', gamma: 0.9 }, 'fidelity', 1);
    close(p.temperature, 0.01);
    close(p.edgeAlign, 0.8);
    close(p.angleNoise, 10);
    close(p.gamma, 0.9);
  });

  it('macroKeys lists what a macro moves for the current algorithm', () => {
    expect(macroKeys('size', DEFAULTS)).toEqual(['sMax', 'sMin']);
    expect(macroKeys('fidelity', { ...DEFAULTS, algorithm: 'slic' })).toEqual(['compactness']);
    expect(macroKeys('fidelity', { ...DEFAULTS, algorithm: 'voronoi' })).toEqual([]);
  });

  it('fidelity on slic sets compactness 40 − 34f', () => {
    const p = applyMacro({ ...DEFAULTS, algorithm: 'slic' }, 'fidelity', 0.5);
    close(p.compactness, 23);
  });

  it('gloss sets specular, tilt and shininess', () => {
    const p = applyMacro(DEFAULTS, 'gloss', 0.5);
    close(p.specular, 0.6);
    close(p.tilt, 0.16);
    close(p.shininess, 10 ** 1.7);
  });

  for (const id of MACROS) {
    for (const algorithm of ['fracture', 'hybrid', 'voronoi-aniso', 'slic', 'cracks']) {
      it(`readMacro round-trips applyMacro for ${id} on ${algorithm}`, () => {
        const p = applyMacro({ ...DEFAULTS, algorithm }, id, 0.3);
        close(readMacro(p, id), 0.3);
      });
    }
  }

  it('manual edit makes readMacro null', () => {
    const p = applyMacro({ ...DEFAULTS, algorithm: 'fracture' }, 'fidelity', 0.6);
    expect(readMacro({ ...p, edgeAlign: 0.1 }, 'fidelity')).toBeNull();
    expect(readMacro({ ...applyMacro(DEFAULTS, 'size', 0.5), sMin: 20 }, 'size')).toBeNull();
  });
});

describe('size ratio', () => {
  it('sets the smallest piece from the largest', () => {
    const p = applyMacro({ ...DEFAULTS, sizeRatio: 3 }, 'size', 0.4);
    close(p.sMax, 36);
    close(p.sMin, 12);
    close(readMacro(p, 'size'), 0.4);
  });
});

describe('styles', () => {
  const base = applyMacroDefaults(DEFAULTS);
  it('natural is the defaults', () => {
    expect(applyStyle(DEFAULTS, 'natural').params).toEqual(base);
    expect(readStyle(base, DEFAULTS)).toBe('natural');
  });

  for (const s of STYLES) {
    it(`${s.label} keeps its simple controls simple and is recognised`, () => {
      const { params, macros } = applyStyle(DEFAULTS, s.id);
      for (const m of MACROS) {
        if (macroKeys(m, params).length) close(readMacro(params, m), macros.values[m]);
      }
      expect(readStyle(params, DEFAULTS)).toBe(s.id);
      expect(readStyle({ ...params, seed: params.seed + 1 }, DEFAULTS)).toBe(s.id);
      expect(readStyle({ ...params, grout: params.grout + 0.5 }, DEFAULTS)).toBeNull();
    });
  }
});
