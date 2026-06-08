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
