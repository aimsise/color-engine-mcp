import { toRgb } from '../init.js'; // side-effect: registers culori modes (modeLrgb required for wcagContrast)
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
 * Static error text for translucent inputs (sanctioned change: contrast and
 * solve_for_contrast reject alpha < 1). Treating a 10%-opacity color as opaque
 * is dangerously wrong for accessibility — the effective color depends on an
 * unknown backdrop — so the caller must composite first.
 */
export const ALPHA_UNSUPPORTED_MESSAGE =
  'ALPHA_UNSUPPORTED: contrast requires fully opaque colors (alpha = 1); composite the color over its backdrop first';

/**
 * True when a color string parses with an EXPLICIT alpha channel < 1 — covers
 * rgba(...)/hsla(...) functional alpha, and 8-digit / 4-digit hex. A color with
 * no alpha component, or with alpha exactly 1 (e.g. `rgba(255 0 0 / 1)`), is
 * fully opaque and allowed. Unparseable input returns false (the parse-failure
 * path reports it instead).
 */
export function isTranslucent(input: string): boolean {
  if (typeof input !== 'string') return false;
  const rgb = toRgb(input.trim());
  return rgb !== undefined && rgb.alpha !== undefined && rgb.alpha < 1;
}

/**
 * Rename ONLY the generic PARSE_FAILED code so the static error names the
 * failing parameter (ERR-2). Other code-keyed messages (INPUT_TOO_LONG,
 * NON_FINITE_COMPONENTS, COMPONENT_OUT_OF_RANGE, ...) are forwarded verbatim.
 * SEC-3 holds: the text is fully static — raw user input is NEVER echoed.
 */
function namedParseError(error: string, role: 'foreground' | 'background'): string {
  return error.startsWith('PARSE_FAILED')
    ? `PARSE_FAILED: could not parse the ${role} color`
    : error;
}

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
 * @throws {ContrastError} when either input fails to parse, when either input is
 *   translucent (explicit alpha < 1 — ALPHA_UNSUPPORTED), OR the computed ratio
 *   is non-finite (e.g. overflow from an extreme out-of-gamut color that survived
 *   parseColor's own finite check).
 */
export function wcagContrastRaw(a: string, b: string): number {
  // `parseColor` returns a full "<CODE>: msg" string in `.error`; PARSE_FAILED is
  // renamed to identify the failing parameter (ERR-2 — foreground checked first),
  // every other code is forwarded verbatim. The translucency guard (CE-3) runs
  // right after each successful parse: alpha < 1 would silently corrupt the
  // luminance computation, so it is a typed error, never a wrong number.
  const pa = parseColor(a);
  if (!pa.ok) throw new ContrastError(namedParseError(pa.error, 'foreground'));
  if (isTranslucent(a)) throw new ContrastError(ALPHA_UNSUPPORTED_MESSAGE);

  const pb = parseColor(b);
  if (!pb.ok) throw new ContrastError(namedParseError(pb.error, 'background'));
  if (isTranslucent(b)) throw new ContrastError(ALPHA_UNSUPPORTED_MESSAGE);

  // Pass hex strings (valid #rrggbb) — not the integer rgb object.
  const ratio = wcagContrast(pa.hex, pb.hex);

  // Second-line non-finite guard: wcagContrast could theoretically return
  // Infinity/NaN if modeLrgb linearization produces extreme values for colors
  // that parseColor's finite check let through (out-of-gamut clamping edge cases).
  if (!Number.isFinite(ratio)) {
    throw new ContrastError('NON_FINITE_LUMINANCE: non-finite luminance');
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
