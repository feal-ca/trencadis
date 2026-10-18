import { describe, expect, it } from 'vitest';
import { applyMacro, applyStyle, macroKeys, MACROS, readMacro, readStyle, STYLES } from '../src/core/macros.js';
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
    expect(macroKeys('size', DEFAULTS)).toEqual(['sMin', 'sMax']);
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

describe('styles', () => {
  it('defines the four styles from the spec', () => {
    expect(STYLES.map((s) => s.label)).toEqual(['Cortes rectos', 'Azulejos de taller', 'Grietas', 'Teselas redondeadas']);
    const taller = STYLES.find((s) => s.id === 'taller').params;
    expect(taller).toMatchObject({ algorithm: 'fracture', palette: 'gaudi', paletteMix: 0.85, colorMode: 'vivid', saturation: 1.25 });
  });

  it('applyStyle keeps the fidelity macro for the new algorithm', () => {
    const p = applyMacro({ ...DEFAULTS, algorithm: 'fracture' }, 'fidelity', 0.7);
    const q = applyStyle(p, 'grietas');
    expect(q.algorithm).toBe('cracks');
    close(readMacro(q, 'fidelity'), 0.7);
    expect(readStyle(q)).toBe('grietas');
  });
});
