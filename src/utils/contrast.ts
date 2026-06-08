import '../init.js'; // side-effect: register culori modes (modeLrgb required for wcagContrast)
import { wcagContrast } from 'culori/fn';
import { parseColor } from '../lib/color/parse.js';

/**
 * Typed error thrown by `wcagContrastRaw` for invalid or non-finite inputs.
 * The tool handler catches this specifically; any other Error maps to the
 * generic fallback message so internals are never forwarded to the caller.
 */
export class ContrastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContrastError';
  }
}

/** WCAG 2.1 tier flags — derived from the RAW pre-rounding contrast ratio. */
export type WcagTiers = {
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
};

/**
 * Compute the raw (pre-rounding) WCAG 2.1 contrast ratio between two CSS color
 * strings. Passes `parsed.hex` (a valid `#rrggbb` string) to `wcagContrast` —
 * NEVER `parsed.rgb` (integer 0-255 channels; passing those would corrupt the
 * luminance computation, see plan risk §b).
 *
 * Non-finite GUARD lives HERE (AC-6 sibling-guard): any future tool that shares
 * this helper (`gamut_map`, `generate_ramp`, `solve_for_contrast`) inherits the
 * guard automatically — no duplication needed in each tool handler.
 *
 * @throws {ContrastError} when either input fails to parse OR the computed ratio
 *   is non-finite (e.g. overflow from an extreme out-of-gamut color that survived
 *   parseColor's own finite check).
 */
export function wcagContrastRaw(a: string, b: string): number {
  const pa = parseColor(a);
  if (!pa.ok) throw new ContrastError(pa.error);

  const pb = parseColor(b);
  if (!pb.ok) throw new ContrastError(pb.error);

  // Pass hex strings (valid #rrggbb) — not the integer rgb object.
  const ratio = wcagContrast(pa.hex, pb.hex);

  // Second-line non-finite guard: wcagContrast could theoretically return
  // Infinity/NaN if modeLrgb linearization produces extreme values for colors
  // that parseColor's finite check let through (out-of-gamut clamping edge cases).
  if (!Number.isFinite(ratio)) {
    throw new ContrastError('non-finite luminance');
  }

  return ratio;
}

/**
 * Classify a raw contrast ratio into WCAG 2.1 tier flags.
 *
 * Threshold table (from plan — authoritative):
 *   ratio < 3.0   → all false
 *   3.0 <= r < 4.5 → aaLarge true only
 *   4.5 <= r < 7.0 → aaNormal, aaLarge, aaaLarge true; aaaNormal false
 *   ratio >= 7.0  → all true
 *
 * IMPORTANT: always called with the RAW pre-rounding ratio, never the 2-dp
 * display value (Gate 7 anti-circularity — a near-boundary raw value of 4.4999
 * rounds to 4.50 but must yield aaNormal=false).
 */
export function wcagTiers(ratio: number): WcagTiers {
  return {
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3.0,
    aaaNormal: ratio >= 7.0,
    aaaLarge: ratio >= 4.5,
  };
}
