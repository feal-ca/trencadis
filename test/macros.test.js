import { describe, expect, it } from 'vitest';
import { applyMacro, applyMacroDefaults, applyStyle, MACRO_DEFAULTS, macroKeys, readMacro, readStyle, STYLES } from '../src/core/macros.js';
import { ALGORITHMS, DEFAULTS } from '../src/core/params.js';

describe('macros', () => {
  it('size sets the largest piece and the smallest from the ratio', () => {
    const p = applyMacro(DEFAULTS, 'size', 0.5);
    expect(p.sMax).toBeCloseTo(41);
    expect(p.sMin).toBeCloseTo(41 / DEFAULTS.sizeRatio);
  });
  it('contours go down as fidelity goes up', () => {
    expect(applyMacro(DEFAULTS, 'fidelity', 0).contours).toBeCloseTo(14);
    expect(applyMacro(DEFAULTS, 'fidelity', 1).contours).toBeCloseTo(6);
    expect(macroKeys('fidelity', DEFAULTS)).toEqual(['contours']);
  });
  it('gloss sets specular, tilt and shininess', () => {
    const p = applyMacro(DEFAULTS, 'gloss', 1);
    expect(p.specular).toBeCloseTo(1.1);
    expect(p.tilt).toBeCloseTo(0.08);
    expect(p.shininess).toBeCloseTo(10 ** 2.5);
  });
  it('readMacro inverts applyMacro, and is null after a manual edit', () => {
    for (const id of Object.keys(MACRO_DEFAULTS)) expect(readMacro(applyMacro(DEFAULTS, id, 0.3), id)).toBeCloseTo(0.3);
    expect(readMacro({ ...applyMacro(DEFAULTS, 'gloss', 0.3), tilt: 0.5 }, 'gloss')).toBeNull();
  });
});

describe('styles', () => {
  it('the first style is the defaults with the default controls', () => {
    expect(applyStyle(DEFAULTS, STYLES[0].id).params).toEqual(applyMacroDefaults(DEFAULTS));
  });
  it('every style uses a method that exists and reads back as itself', () => {
    const methods = ALGORITHMS.map((a) => a.value);
    for (const s of STYLES) {
      const { params } = applyStyle(DEFAULTS, s.id);
      expect(methods).toContain(params.algorithm);
      expect(readStyle(params, DEFAULTS)).toBe(s.id);
      expect(readStyle({ ...params, seed: 99 }, DEFAULTS)).toBe(s.id);
    }
  });
  it('a changed setting is no style', () => {
    expect(readStyle({ ...applyStyle(DEFAULTS, 'romano').params, saturation: 2 }, DEFAULTS)).toBeNull();
  });
});
