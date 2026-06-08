import '../../init.js'; // side-effect: register culori modes (MUST be first import — AC-11)
import { inGamut, toGamut, differenceEuclidean, formatHex } from 'culori/fn';
import type { Color } from 'culori';
import { toOklch } from '../../init.js';

// ---------------------------------------------------------------------------
// Typed error for gamut-mapping failures.
// ---------------------------------------------------------------------------

/**
 * Typed error for gamut-mapping failures (unparseable or non-finite inputs).
 * Thrown by `assertFiniteOklch` and `mapToSRGB` so the MCP tool can
 * convert them to a structured `{ isError: true }` without leaking exceptions
 * across the MCP boundary.
 */
export class GamutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GamutError';
  }
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Below this chroma a color is considered achromatic; hue may be undefined/NaN. */
const ACHROMATIC_CHROMA = 1e-4;

/**
 * Maximum physically realizable OKLCH chroma accepted by the gamut mapper.
 *
 * Rationale for the value (100):
 *   - Real sRGB / display-P3 / rec2020 colors stay well under c ≈ 0.5.
 *   - The AC-2/AC-3 test fixtures use a maximum chroma of 0.4 — many orders of
 *     magnitude below this ceiling.
 *   - culori 4.0.2's toGamut bisection enters an infinite loop for certain finite
 *     chroma magnitudes in a hue/L-independent band (~1e140, 1e150, 1e160, 1e170,
 *     1e290). The exact fast/hang boundary depends on floating-point rounding in
 *     the OKLCH→linear-RGB matrix multiply and is NOT a single clean threshold.
 *   - 100 is safely ABOVE any legitimate color (even pathological synthetic ones)
 *     while being FAR below any magnitude that could trigger the bisection hang
 *     (the hang band starts around 1e140).
 *   - This guard runs at the shared `mapToSRGB` boundary so T5/T6 siblings inherit
 *     the protection automatically.
 */
const MAX_FINITE_CHROMA = 100;

// ---------------------------------------------------------------------------
// Guard: rejects non-finite OKLCH components before they reach the raw mapper.
// ---------------------------------------------------------------------------

/**
 * Guard that rejects non-finite OKLCH components before they reach the raw
 * culori gamut mapper. Invoked at the `mapToSRGB` entry (shared boundary) so
 * all callers — including future sibling tools T5/T6 — are protected without
 * needing to replicate the check.
 *
 * Rationale: culori 4.0.2's `toGamut` does NOT hang on non-finite or
 * finite-but-enormous chroma — it returns `{r:null, g:null, b:null}` in ~0 ms.
 * However, null RGB channels propagate silently: `formatHex` yields `#000000`
 * and the re-extracted OKLCH fields are `{l:null, c:null}`, which fail the
 * tool's declared `outputSchema` (NaN fields) and surface a leaked MCP
 * `-32602` validation error instead of a clean domain error. This guard — plus
 * the post-map null-channel check in `mapToSRGB` — intercepts both the
 * non-finite class (NaN/Infinity) and the finite-huge class (e.g. 1e300) that
 * `Number.isFinite` alone does not catch.
 *
 * Achromatic colours (c ≈ 0) legitimately have `h === undefined`/`NaN`; the hue
 * finiteness check is skipped for them (mirrors `parse.ts` ACHROMATIC_CHROMA).
 *
 * Also rejects chroma magnitudes above `MAX_FINITE_CHROMA` — a ceiling well
 * above any physically realizable color (max sRGB/P3/Rec2020 c < 0.5) but far
 * below the hang-inducing range (~1e140+) in culori 4.0.2's toGamut bisection.
 * This MUST run before `_rawToGamut` is called; a post-map check cannot catch
 * an infinite loop that occurs during the map.
 */
export function assertFiniteOklch(l: number, c: number, h: number): void {
  if (!Number.isFinite(l) || !Number.isFinite(c)) {
    throw new GamutError('NON_FINITE_OKLCH_COMPONENTS');
  }
  if (c > MAX_FINITE_CHROMA) {
    throw new GamutError('CHROMA_OUT_OF_RANGE');
  }
  const hNonFinite = c > ACHROMATIC_CHROMA && !Number.isFinite(h);
  if (hNonFinite) {
    throw new GamutError('NON_FINITE_OKLCH_HUE');
  }
}

// ---------------------------------------------------------------------------
// Raw culori singleton — private; callers use the guarded `mapToSRGB` wrapper.
// ---------------------------------------------------------------------------

/**
 * Perceptual sRGB gamut mapper, built once at module load (AC-10 singleton).
 *
 * The mapper reduces OKLCH chroma via bisection until the result is "roughly in
 * gamut" (within a 0.02 just-noticeable-difference). It is reserved for the
 * perceptual gamut-mapping tools (parts 5-6); `parse_color` / `convert_color`
 * use `inGamutRgb` for accurate reporting and `formatHex` for the clamped string.
 *
 * NOTE: `@types/culori`@4.0.1 mistypes the `delta` parameter as `number | null`,
 * but the runtime (and culori docs) accept a `DiffFn` from `differenceEuclidean`.
 * The cast keeps the runtime-correct `DiffFn` argument while satisfying tsc.
 */
const _rawToGamut = toGamut(
  'rgb',
  'oklch',
  differenceEuclidean('oklch') as unknown as number,
  0.02
);

// Module-level predicate so the closure is created only once.
const inRgbGamut = inGamut('rgb');

// ---------------------------------------------------------------------------
// Public guarded gamut-mapper (wraps the raw singleton).
// ---------------------------------------------------------------------------

/**
 * Guarded sRGB gamut mapper. Wraps the private culori `toGamut` singleton with:
 *   1. `toOklch` conversion check — throws `PARSE_FAILED` when the color cannot
 *      be converted to OKLCH.
 *   2. Null-channel check — throws `NULL_OKLCH_CHANNELS` when OKLCH fields are null.
 *   3. `assertFiniteOklch` — rejects non-finite fields (NaN/Infinity) and chroma
 *      values above `MAX_FINITE_CHROMA` (prevents culori bisection from hanging on
 *      finite-huge chroma like 1e150 that pass `Number.isFinite` but loop forever).
 *   4. Post-map null-channel validation — detects any residual finite-but-enormous
 *      chroma that culori collapses to `{r:null, g:null, b:null}`.
 *
 * This is the shared boundary: ALL callers (gamutMapColor, future T5/T6 siblings)
 * MUST go through this function, never the raw `_rawToGamut` singleton.
 *
 * Preserves the same `(color) => Color` call signature as the raw culori instance.
 *
 * @throws {GamutError} when conversion fails, OKLCH fields are null/non-finite,
 *   chroma exceeds MAX_FINITE_CHROMA, or the mapper collapses to null channels.
 */
export function mapToSRGB(color: Color): Color {
  // Guard entry: validate OKLCH fields before handing off to the raw mapper.
  const oklch = toOklch(color);
  // W1: reject if culori cannot convert the color to OKLCH at all.
  if (!oklch) {
    throw new GamutError('PARSE_FAILED');
  }
  // W2: treat null/undefined channels as an error — do NOT promote them to 0
  // via `?? 0`, which would silently pass a pre-collapsed Color through the guard.
  if (oklch.l == null || oklch.c == null) {
    throw new GamutError('NULL_OKLCH_CHANNELS');
  }
  // h may legitimately be undefined/NaN for achromatic colors (c ≈ 0); pass 0
  // as the sentinel only for that case — assertFiniteOklch skips hue check when
  // c ≤ ACHROMATIC_CHROMA anyway.
  const hVal = oklch.h ?? 0;
  assertFiniteOklch(oklch.l, oklch.c, hVal);

  const mapped = _rawToGamut(color);

  // Post-map null-channel validation: culori 4.0.2 returns {r:null,g:null,b:null}
  // for finite-but-enormous chroma (e.g. 1e300) without throwing. Re-extracting
  // OKLCH from those null channels gives l:null/c:null, which fail the outputSchema.
  // Detect this and throw a clean GamutError instead of leaking a -32602/NaN error.
  const mappedOklch = toOklch(mapped);
  if (
    mappedOklch == null ||
    !Number.isFinite(mappedOklch.l as number | null | undefined) ||
    !Number.isFinite(mappedOklch.c as number | null | undefined)
  ) {
    throw new GamutError('GAMUT_MAP_COLLAPSE: gamut mapping produced null/non-finite channels');
  }

  return mapped;
}

/**
 * Accurate sRGB gamut report for a parsed color. Unlike `formatHex` (which
 * silently clamps out-of-gamut channels), this returns `false` when any RGB
 * channel falls outside [0, 1].
 */
export function inGamutRgb(color: Color | string): boolean {
  return inRgbGamut(color);
}

// ---------------------------------------------------------------------------
// Full-flow gamut-mapping function (used by the gamut_map MCP tool).
// ---------------------------------------------------------------------------

/**
 * Full-flow gamut-mapping lib function.
 *
 * 1. Parse `input` to an OKLCH culori object via `toOklch`.
 * 2. `mapToSRGB` runs `assertFiniteOklch` at its entry (AC-7 shared-boundary guard)
 *    and validates that the mapped result has finite channels.
 * 3. Compute `clamped` = `!inGamutRgb(input)` on the raw input string (pre-mapping).
 * 4. Apply `mapToSRGB` (perceptual chroma reduction via bisection in OKLCH).
 * 5. `formatHex` the MAPPED result — NEVER the raw input.
 * 6. Re-extract raw OKLCH of the mapped result and return `{ hex, oklch, clamped }`.
 *
 * Throws `GamutError` on unparseable, non-finite, or null-collapse input.
 */
export function gamutMapColor(input: string): {
  hex: string;
  oklch: { l: number; c: number; h: number };
  clamped: boolean;
} {
  // Step 1: parse to OKLCH.
  const parsed = toOklch(input);
  if (!parsed) {
    throw new GamutError('PARSE_FAILED: could not parse color input');
  }

  // Step 3: clamped = out-of-gamut BEFORE mapping.
  // IMPORTANT: Call inGamut on the raw input STRING — NOT on the OKLCH object.
  // culori's inGamut('rgb') applied to an OKLCH object round-trips through RGB
  // conversion and may return false for exact sRGB primaries (e.g. #ff0000)
  // due to floating-point drift. Using the original input string or an RGB
  // representation avoids this. `inRgbGamut(string)` converts internally to
  // RGB first, giving an accurate result.
  const clamped = !inRgbGamut(input);

  // Step 4: perceptual gamut mapping (chroma reduction in OKLCH).
  // mapToSRGB runs assertFiniteOklch at its entry AND validates the mapped result.
  const mapped = mapToSRGB(parsed);

  // Step 5: hex ONLY after mapping.
  const hex = formatHex(mapped);

  // Step 6: re-extract OKLCH of mapped result (raw floats; hue ?? 0 for achromatic).
  const mappedOklch = toOklch(mapped);
  const l = mappedOklch?.l ?? 0;
  const c = mappedOklch?.c ?? 0;
  const h = mappedOklch?.h ?? 0;

  return { hex, oklch: { l, c, h }, clamped };
}
