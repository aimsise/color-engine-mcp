// Shared INDEPENDENT oracle for OKLCH cross-checks.
//
// colorjs.io is a different implementation from culori (the production library),
// so cross-checking culori's raw OKLCH output against it satisfies the oracle-
// independence requirement (Gate-7). This is a devDependency only — zero prod dep.
//
// This file lives under tests/helpers/ (NOT a *.test.ts file), so vitest's
// include glob (`src/**/*.test.ts`, `tests/**/*.test.ts`) does NOT pick it up as
// a test suite; it is imported by the sibling test files as a single source of
// truth, eliminating the previously-duplicated `oracleOklch` definition.
import Color from 'colorjs.io';

/**
 * colorjs.io OKLCH oracle: returns the RAW [l, c, h] coords for a CSS color
 * string. `h` is `null` for achromatic colors (colorjs.io convention), so
 * callers must handle the null hue explicitly.
 */
export function oracleOklch(css: string): { l: number; c: number; h: number | null } {
  const [l, c, h] = new Color(css).to('oklch').coords;
  return { l, c, h };
}

/**
 * colorjs.io WCAG-2.1 contrast oracle (AC-1). Independent of culori's
 * `wcagContrast`, so the engine's RAW ratio can be cross-checked against it.
 * Returns the unrounded WCAG 2.1 contrast ratio between two CSS color strings.
 */
export function oracleWcagContrast(a: string, b: string): number {
  return new Color(a).contrast(b, 'WCAG21');
}

/**
 * colorjs.io ΔE2000 oracle (AC-4). Different metric from the engine's
 * Euclidean-OKLCH ΔE, but confirms perceptual proximity of a swatch to the base
 * independent of the engine's metric. Returns the unrounded ΔE2000 value.
 */
export function oracleDeltaE2000(hexOrCss: string, base: string): number {
  return new Color(hexOrCss).deltaE(new Color(base), '2000');
}
