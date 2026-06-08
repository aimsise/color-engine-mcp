import '../../init.js'; // side-effect: register culori modes (MUST be first import)
import { formatHex, clampChroma } from 'culori/fn';
import { mapToSRGB, inGamutRgb } from './gamut.js';
import { wcagContrastRaw } from '../../utils/contrast.js';
import { parseColor } from './parse.js';

// ---------------------------------------------------------------------------
// Declared contracts (encoded as constants + comments so AC-3 / AC-6 resolve
// unambiguously).
// ---------------------------------------------------------------------------

/** Minimum swatches in a ramp. `steps < MIN_STEPS` → RampError (AC-3). */
const MIN_STEPS = 2;

/**
 * Maximum swatches in a ramp (DECLARED ROBUSTNESS CAP — AC-6).
 *
 * `2 <= steps <= MAX_STEPS` returns exactly `steps` swatches; `steps > MAX_STEPS`
 * returns a RampError (`isError:true` at the tool boundary). 512 is far above any
 * realistic UI ramp request and keeps the per-call work trivial — `steps = 100`
 * returns exactly 100 swatches well under the 2 s bound (each swatch is O(1)
 * OKLCH math + one guarded `mapToSRGB` bisection).
 */
const MAX_STEPS = 512;

/** Default lightness endpoints for the tint-to-shade ramp (near-white → near-black). */
const DEFAULT_L_MAX = 0.97;
const DEFAULT_L_MIN = 0.05;

/** Below this chroma a color is achromatic; hue is undefined/NaN (mirrors repo ACHROMATIC_CHROMA). */
const ACHROMATIC_CHROMA = 1e-4;

// ---------------------------------------------------------------------------
// Result types (discriminated union — `generateRamp` NEVER throws for an
// in-contract input; it returns a RampError instead).
// ---------------------------------------------------------------------------

export type RampTier = 'AAA' | 'AA' | 'FAIL';

export interface RampSwatch {
  step: number;
  hex: string;
  oklch: { l: number; c: number; h: number };
  vsWhite: { ratio: number; tier: RampTier };
  vsBlack: { ratio: number; tier: RampTier };
  inGamut: boolean;
}

export type RampResult = { ok: true; swatches: RampSwatch[] };
export type RampError = { ok: false; error: string };

export interface RampOptions {
  lightnessMin?: number;
  lightnessMax?: number;
  deltaL?: number;
}

// ---------------------------------------------------------------------------
// Pure WCAG tier classifier (raw ratio in, tier out).
// ---------------------------------------------------------------------------

/**
 * Classify a RAW (pre-rounding) WCAG contrast ratio into the ramp's 3-tier scale.
 *
 *   ratio >= 7.0 → 'AAA'
 *   ratio >= 4.5 → 'AA'
 *   else         → 'FAIL'
 *
 * MUST be called with the raw `wcagContrastRaw` value, never a 2-dp display value
 * (anti-circularity: a near-boundary raw 6.9999 must yield 'AA', not 'AAA').
 */
export function toRampTier(ratio: number): RampTier {
  if (ratio >= 7.0) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'FAIL';
}

// ---------------------------------------------------------------------------
// Pure ramp generator.
// ---------------------------------------------------------------------------

/**
 * Generate a tint-to-shade OKLCH ramp from a base CSS color.
 *
 * Algorithm (per ticket Implementation Notes):
 *   - Lightness: linear from `lightnessMax` (near-white) DOWN to `lightnessMin`
 *     (near-black) → strictly monotonically DECREASING raw `oklch.l` (AC-1).
 *   - Chroma: `baseC * sin(π·i/(N−1))`, clamped to `[0, baseC]` — endpoints pure
 *     tint/shade (c≈0), midpoint at peak chroma.
 *   - Each swatch is gamut-mapped through the GUARDED `mapToSRGB` singleton
 *     (never the private `_rawToGamut`), so every swatch inherits the finite /
 *     chroma-magnitude / null-collapse guards and is in-gamut (AC-1 / AC-7).
 *
 * Returns `RampError` (never throws) for in-contract faults:
 *   - non-integer / `steps < 2` / `steps > 512`,
 *   - base that fails `parseColor` (e.g. the AC-8 `oklch(0.5 1e400 30)` overflow,
 *     rejected by the SHARED parse boundary's non-finite guard).
 *
 * NO network I/O and NO filesystem writes anywhere in this file (AC-10).
 */
export function generateRamp(
  base: string,
  steps: number,
  options?: RampOptions
): RampResult | RampError {
  // 1. steps validation (AC-3) — NEVER throw.
  if (!Number.isInteger(steps) || steps < MIN_STEPS) {
    return { ok: false, error: `steps must be an integer >= ${MIN_STEPS}` };
  }
  // 2. Large-N declared cap (AC-6).
  if (steps > MAX_STEPS) {
    return { ok: false, error: `steps must be <= ${MAX_STEPS}` };
  }

  // 3. Parse base via the SHARED boundary (AC-8: non-finite chroma rejected here).
  const parsed = parseColor(base);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const baseC = parsed.oklch.c;
  const baseH = parsed.oklch.h; // parseColor already normalizes achromatic h → 0.

  // 4. Achromatic guard (AC-5): tiny/zero chroma or non-finite hue → neutral ramp.
  const isAchromatic = baseC <= ACHROMATIC_CHROMA || !Number.isFinite(baseH);
  const hue = isAchromatic ? 0 : baseH;

  // 5. Lightness range. With `deltaL` supplied, center a symmetric span on the
  //    base L and clamp endpoints into [0,1]; otherwise use the fixed range.
  let lMax = options?.lightnessMax ?? DEFAULT_L_MAX;
  let lMin = options?.lightnessMin ?? DEFAULT_L_MIN;
  if (options?.deltaL != null && Number.isFinite(options.deltaL)) {
    const half = Math.abs(options.deltaL) / 2;
    lMax = Math.min(1, parsed.oklch.l + half);
    lMin = Math.max(0, parsed.oklch.l - half);
  }

  const denom = steps - 1; // steps >= 2 ⇒ denom >= 1, no division by zero.

  // Base-presence anchor (AC-4): the step whose linear lightness is nearest the
  // base L is snapped to EXACTLY the base color (L, C, H) so the ramp always
  // contains the base. The base L lies inside [lMin, lMax] for any realistic base
  // (and for the deltaL-centered range), so this preserves strict L monotonicity:
  // the snapped L stays between its neighbors' linear L values.
  const baseL = parsed.oklch.l;
  let anchorIndex = 0;
  if (Number.isFinite(baseL) && baseL <= lMax && baseL >= lMin) {
    let bestDist = Infinity;
    for (let i = 0; i < steps; i++) {
      const li = lMax - (i / denom) * (lMax - lMin);
      const d = Math.abs(li - baseL);
      if (d < bestDist) {
        bestDist = d;
        anchorIndex = i;
      }
    }
  } else {
    anchorIndex = -1; // base L outside the ramp range → no snap.
  }

  const swatches: RampSwatch[] = [];

  for (let i = 0; i < steps; i++) {
    const t = i / denom;
    // Linear lightness, high → low (strictly decreasing for lMax > lMin → AC-1).
    // The anchor step uses the base L exactly (AC-4 base presence).
    const isAnchor = i === anchorIndex;
    const l = isAnchor ? baseL : lMax - t * (lMax - lMin);
    // Sin chroma curve: 0 at endpoints, baseC at the midpoint; clamp to [0, baseC].
    // The anchor step carries the FULL base chroma so the base color is reproduced.
    const rawC = isAnchor ? baseC : baseC * Math.sin((Math.PI * i) / denom);
    const curvedC = Math.max(0, Math.min(rawC, baseC));

    // Build the OKLCH color object directly and route it through the GUARDED
    // mapper (no per-swatch string parse, no private _rawToGamut access). The hex
    // is ALWAYS produced by the guarded perceptual mapper.
    const swatchOklch = { mode: 'oklch' as const, l, c: curvedC, h: hue };
    const mapped = mapToSRGB(swatchOklch);
    const hex = formatHex(mapped);

    // Reported OKLCH: keep the INPUT target lightness `l` (strictly monotonic by
    // construction — AC-1) and reduce chroma into the sRGB gamut AT THAT lightness
    // with culori `clampChroma` (a pure reporting clamp — no re-mapping, no toGamut
    // reconstruction). This yields a self-consistent in-gamut OKLCH triple so the
    // reported `oklch` object passes `inGamut('rgb')` (AC-7), while preserving
    // strict L monotonicity even when many adjacent out-of-gamut high-chroma
    // swatches would otherwise drift to the same boundary lightness.
    const reportTriple = clampChroma(
      { mode: 'oklch' as const, l, c: curvedC, h: hue },
      'oklch',
      'rgb'
    );
    const fl = reportTriple.l ?? l;
    const fc = reportTriple.c ?? 0;
    const fh = reportTriple.h ?? hue;

    // Per-swatch WCAG contrast vs white/black (raw ratios; tier from raw value).
    const whiteRatio = wcagContrastRaw(hex, '#ffffff');
    const blackRatio = wcagContrastRaw(hex, '#000000');

    swatches.push({
      step: i,
      hex,
      oklch: { l: fl, c: fc, h: fh },
      vsWhite: { ratio: whiteRatio, tier: toRampTier(whiteRatio) },
      vsBlack: { ratio: blackRatio, tier: toRampTier(blackRatio) },
      inGamut: inGamutRgb(hex),
    });
  }

  return { ok: true, swatches };
}
