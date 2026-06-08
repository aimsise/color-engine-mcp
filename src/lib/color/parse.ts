import '../../init.js'; // side-effect: register culori modes (MUST be first import — AC-11)
import { formatHex } from 'culori/fn';
import { toRgb, toOklch } from '../../init.js';
import { inGamutRgb } from './gamut.js';

/** Successful parse result — raw (pre-rounding) OKLCH floats are preserved. */
export type ParseOk = {
  ok: true;
  hex: string;
  rgb: { r: number; g: number; b: number };
  oklch: { l: number; c: number; h: number };
  inGamut: boolean;
};

/** Parse failure — `error` is an actionable, agent-facing message. */
export type ParseErr = { ok: false; error: string };

export type ParseResult = ParseOk | ParseErr;

/** Below this chroma a color is treated as achromatic, so a missing hue is allowed. */
const ACHROMATIC_CHROMA = 1e-4;

/**
 * Parse any CSS color string into hex, integer RGB, raw OKLCH and an accurate
 * sRGB gamut flag. This is the SHARED BOUNDARY: it houses the finite-value guard
 * (AC-5 / AC-8) that every downstream tool inherits by going through `parseColor`
 * instead of calling culori converters directly.
 *
 * Returns raw `l`/`c`/`h` floats (no rounding) so oracle cross-checks compare
 * against the true computed value.
 */
export function parseColor(input: string): ParseResult {
  // 1. Universal parse. culori returns `undefined` for unrecognized / token-level
  //    invalid input (e.g. "not-a-color", "#12", "oklch(NaN 0.2 30)").
  const rgb = toRgb(input);
  if (!rgb) {
    return { ok: false, error: `could not parse color "${input}"` };
  }

  // 2. Finite-value guard on RGB channels. A parse-ACCEPTED-then-overflows input
  //    such as "oklch(0.5 1e400 30)" yields rgb { r: NaN, g: NaN, b: NaN } — reject
  //    deterministically (no hang) so AC-5 / AC-8 hold within the 500 ms bound.
  if (!Number.isFinite(rgb.r) || !Number.isFinite(rgb.g) || !Number.isFinite(rgb.b)) {
    return { ok: false, error: 'non-finite color components' };
  }

  const oklch = toOklch(rgb);
  if (!oklch) {
    return { ok: false, error: 'non-finite color components' };
  }

  // 3. Finite-value guard on OKLCH. `h` is legitimately undefined/NaN for
  //    achromatic colors (c ≈ 0); reject a non-finite hue ONLY when chroma is
  //    meaningful (AC-9 achromatic special case).
  const { l, c, h } = oklch;
  const hNonFinite = c > ACHROMATIC_CHROMA && !Number.isFinite(h);
  if (!Number.isFinite(l) || !Number.isFinite(c) || hNonFinite) {
    return { ok: false, error: 'non-finite color components' };
  }

  // 4. Hex via formatHex (lowercase #rrggbb; clamps silently — accuracy is
  //    reported separately through `inGamut`).
  const hex = formatHex(rgb);

  // 5. culori RGB channels are 0-1 floats; AC-1 requires exact integer channels.
  const rgbInts = {
    r: Math.round(rgb.r * 255),
    g: Math.round(rgb.g * 255),
    b: Math.round(rgb.b * 255),
  };

  return {
    ok: true,
    hex,
    rgb: rgbInts,
    // Conventional 0 hue for achromatic colors keeps `h: z.number()` satisfiable.
    oklch: { l, c, h: h ?? 0 },
    inGamut: inGamutRgb(rgb),
  };
}
