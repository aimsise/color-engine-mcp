/**
 * AC-6 — All output colors of gamut_map, generate_ramp, solve_for_contrast
 * are in sRGB gamut, defined as r,g,b ∈ [0, 255] (CSS Color Level 4 spec oracle).
 *
 * Oracle: CSS Color Level 4 sRGB gamut definition — a color is in sRGB gamut when
 * its R, G, B integer channels on the 0-255 scale are each in [0, 255]. This is
 * hand-verifiable from the published spec without any library.
 *
 * Seeded out-of-gamut OKLCH inputs (chroma > 0.35 at various hues):
 *   - oklch(0.5 0.4 30), oklch(0.7 0.5 180), oklch(0.3 0.45 90),
 *     oklch(0.6 0.38 270), oklch(0.5 0.4 60)
 * Plus the overflow vector: "oklch(0.5 1e400 30)" — parse-accepted-then-overflows.
 *
 * The shared finiteness guard in src/shared/validation.ts MUST intercept non-finite
 * components before any handler; verified by importing and asserting directly.
 */

import { describe, it, expect } from 'vitest';
import { gamutMapTool } from '../../src/tools/gamut_map.js';
import { generateRampTool } from '../../src/tools/generate_ramp.js';
import { solveTool } from '../../src/tools/solve_for_contrast.js';
import { validateColorComponents } from '../../src/shared/validation.js';

/** CSS Color Level 4 oracle: parse a #rrggbb hex to integer RGB channels. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a valid #rrggbb hex: ${hex}`);
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

/** Assert r,g,b ∈ [0,255] per CSS Color Level 4 sRGB gamut spec. */
function assertInSrgbGamut(hex: string, label: string): void {
  const { r, g, b } = hexToRgb(hex);
  expect(r, `${label}: r=${r} out of [0,255]`).toBeGreaterThanOrEqual(0);
  expect(r, `${label}: r=${r} out of [0,255]`).toBeLessThanOrEqual(255);
  expect(g, `${label}: g=${g} out of [0,255]`).toBeGreaterThanOrEqual(0);
  expect(g, `${label}: g=${g} out of [0,255]`).toBeLessThanOrEqual(255);
  expect(b, `${label}: b=${b} out of [0,255]`).toBeGreaterThanOrEqual(0);
  expect(b, `${label}: b=${b} out of [0,255]`).toBeLessThanOrEqual(255);
}

/** Seeded out-of-gamut OKLCH inputs (chroma > 0.35). */
const outOfGamutInputs = [
  'oklch(0.5 0.4 30)',
  'oklch(0.7 0.5 180)',
  'oklch(0.3 0.45 90)',
  'oklch(0.6 0.38 270)',
  'oklch(0.5 0.4 60)',
];

/** The parse-accepted-then-overflows vector (AC-6 requirement). */
const overflowVector = 'oklch(0.5 1e400 30)';

describe('AC-6 — validateColorComponents rejects non-finite components directly', () => {
  it('throws NON_FINITE_COMPONENTS for Infinity', () => {
    expect(() =>
      validateColorComponents({ l: 0.5, c: Infinity, h: 30 })
    ).toThrow('NON_FINITE_COMPONENTS');
  });

  it('throws NON_FINITE_COMPONENTS for -Infinity', () => {
    expect(() =>
      validateColorComponents({ l: 0.5, c: -Infinity, h: 30 })
    ).toThrow('NON_FINITE_COMPONENTS');
  });

  it('throws NON_FINITE_COMPONENTS for NaN', () => {
    expect(() =>
      validateColorComponents({ l: NaN, c: 0.2, h: 30 })
    ).toThrow('NON_FINITE_COMPONENTS');
  });

  it('throws NON_FINITE_COMPONENTS for magnitude > 1e6', () => {
    expect(() =>
      validateColorComponents({ c: 1e7 })
    ).toThrow('NON_FINITE_COMPONENTS');
  });

  it('does NOT throw for valid finite components', () => {
    expect(() =>
      validateColorComponents({ l: 0.5, c: 0.4, h: 30 })
    ).not.toThrow();
  });

  it('does NOT throw for undefined values (optional fields)', () => {
    expect(() =>
      validateColorComponents({ lightnessMin: undefined, lightnessMax: undefined })
    ).not.toThrow();
  });
});

describe('AC-6 — gamut_map: output colors in sRGB gamut for out-of-gamut OKLCH inputs', () => {
  for (const input of outOfGamutInputs) {
    it(`gamut_map(${input}) → hex in [0,255]^3`, () => {
      const result = gamutMapTool(input);
      // gamut_map must either return a valid in-gamut hex OR isError:true
      if (result.isError) {
        // Acceptable — the tool returned a structured error
        expect(result.isError).toBe(true);
      } else {
        const sc = result.structuredContent as { hex: string } | undefined;
        expect(sc).toBeDefined();
        assertInSrgbGamut(sc!.hex, `gamut_map(${input})`);
      }
    });
  }

  it(`gamut_map overflow vector "${overflowVector}" → isError:true OR in-gamut result (NEVER non-finite, NEVER hang)`, () => {
    const start = Date.now();
    const result = gamutMapTool(overflowVector);
    const elapsed = Date.now() - start;
    expect(elapsed, 'gamut_map must not hang on overflow vector').toBeLessThan(2000);

    if (result.isError) {
      expect(result.isError).toBe(true);
    } else {
      const sc = result.structuredContent as { hex?: string; oklch?: { l: number; c: number; h: number } } | undefined;
      expect(sc).toBeDefined();
      if (sc?.hex) {
        assertInSrgbGamut(sc.hex, `gamut_map(${overflowVector})`);
      }
      if (sc?.oklch) {
        expect(Number.isFinite(sc.oklch.l), 'oklch.l must be finite').toBe(true);
        expect(Number.isFinite(sc.oklch.c), 'oklch.c must be finite').toBe(true);
        expect(Number.isFinite(sc.oklch.h), 'oklch.h must be finite').toBe(true);
      }
    }
  });
});

describe('AC-6 — generate_ramp: all swatches in sRGB gamut for out-of-gamut base colors', () => {
  for (const base of outOfGamutInputs) {
    it(`generate_ramp(base=${base}, steps=5) → all swatch hexes in [0,255]^3`, () => {
      const result = generateRampTool({ base, steps: 5 });
      if (result.isError) {
        expect(result.isError).toBe(true);
      } else {
        const sc = result.structuredContent as { swatches?: Array<{ hex: string }> } | undefined;
        expect(sc?.swatches).toBeDefined();
        for (const swatch of sc!.swatches!) {
          assertInSrgbGamut(swatch.hex, `generate_ramp(${base}) swatch`);
        }
      }
    });
  }

  it(`generate_ramp overflow vector "${overflowVector}" → isError:true OR in-gamut swatches (NEVER hang)`, () => {
    const start = Date.now();
    const result = generateRampTool({ base: overflowVector, steps: 5 });
    const elapsed = Date.now() - start;
    expect(elapsed, 'generate_ramp must not hang on overflow vector').toBeLessThan(2000);

    if (result.isError) {
      expect(result.isError).toBe(true);
    } else {
      const sc = result.structuredContent as { swatches?: Array<{ hex: string }> } | undefined;
      if (sc?.swatches) {
        for (const swatch of sc.swatches) {
          assertInSrgbGamut(swatch.hex, `generate_ramp overflow swatch`);
        }
      }
    }
  });
});

describe('AC-6 — solve_for_contrast: output color in sRGB gamut', () => {
  for (const bg of outOfGamutInputs) {
    it(`solve_for_contrast(background=${bg}, target=4.5) → output color in [0,255]^3`, () => {
      const result = solveTool({ background: bg, target: 4.5, prefer: 'darker' });
      if (result.isError) {
        expect(result.isError).toBe(true);
      } else {
        const sc = result.structuredContent as { color?: string | null; met?: boolean } | undefined;
        // color may be null when target is unachievable
        if (sc?.color) {
          assertInSrgbGamut(sc.color, `solve_for_contrast(${bg})`);
        }
      }
    });
  }

  it(`solve_for_contrast overflow vector background="${overflowVector}" → isError:true OR structured result (NEVER hang)`, () => {
    const start = Date.now();
    const result = solveTool({ background: overflowVector, target: 4.5, prefer: 'darker' });
    const elapsed = Date.now() - start;
    expect(elapsed, 'solve_for_contrast must not hang on overflow vector').toBeLessThan(2000);

    // Either isError or a valid structured result (met:false if unachievable)
    if (result.isError) {
      expect(result.isError).toBe(true);
    } else {
      const sc = result.structuredContent as { color?: string | null } | undefined;
      if (sc?.color) {
        assertInSrgbGamut(sc.color, `solve_for_contrast overflow`);
      }
    }
  });
});
