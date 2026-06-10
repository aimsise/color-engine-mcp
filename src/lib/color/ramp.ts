import '../../init.js'; // side-effect: register culori modes (MUST be first import)
import { formatHex, clampChroma } from 'culori/fn';
import { mapToSRGB, inGamutRgb, MAX_FINITE_CHROMA } from './gamut.js';
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
// Display rounding (OUT-1) — match the sibling tools' conventions: WCAG ratios
// at 2dp (contrast tool), OKLCH L/C at 5dp and H at 2dp (convert_color; 5dp is
// the precision that keeps OKLCH→hex round-trips exact across the sRGB cube).
// Rounding is REPORTING-ONLY: the hex comes from the raw mapped color and the
// tiers are classified from the RAW pre-rounding ratios.
// ---------------------------------------------------------------------------

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

// ---------------------------------------------------------------------------
// Result types (discriminated union — `generateRamp` NEVER throws for an
// in-contract input; it returns a RampError instead).
// ---------------------------------------------------------------------------

export type RampTier = 'AAA' | 'AA' | 'FAIL';

export interface RampSwatch {
  step: number;
  hex: string;
  /** Display-rounded (OUT-1): l and c at 5dp, h at 2dp. */
  oklch: { l: number; c: number; h: number };
  /** `ratio` is the 2dp display value; `tier` derives from the RAW pre-rounding ratio. */
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
 * TOTAL: `generateRamp` NEVER throws for ANY input — it returns a `RampError`
 * (a `{ ok:false, error }` with a uniform "<CODE>: msg" string) for every fault:
 *   - non-integer / `steps < 2` / `steps > 512`     → STEPS_OUT_OF_RANGE
 *   - base that fails `parseColor` (e.g. the AC-8 `oklch(0.5 1e400 30)` overflow,
 *     rejected by the SHARED parse boundary)         → forwards the parse code
 *     (INPUT_TOO_LONG / PARSE_FAILED / NON_FINITE_COMPONENTS)
 *   - base OKLCH chroma > MAX_FINITE_CHROMA (100)    → BASE_CHROMA_OUT_OF_RANGE
 *   - `deltaL` present and not a finite number > 0   → INVALID_DELTA_L
 *   - resolved `lightnessMin >= lightnessMax`        → INVALID_LIGHTNESS_RANGE
 *   - any unexpected throw inside the per-swatch loop → INTERNAL_ERROR (defensive)
 *
 * NO network I/O and NO filesystem writes anywhere in this file (AC-10).
 */
export function generateRamp(
  base: string,
  steps: number,
  options?: RampOptions
): RampResult | RampError {
  // 1. steps validation (AC-3) — NEVER throw. Error strings are full "<CODE>: msg"
  //    code strings (ALG-3) forwarded verbatim by the tool.
  if (!Number.isInteger(steps) || steps < MIN_STEPS) {
    return { ok: false, error: 'STEPS_OUT_OF_RANGE: steps must be an integer between 2 and 512' };
  }
  // 2. Large-N declared cap (AC-6).
  if (steps > MAX_STEPS) {
    return { ok: false, error: 'STEPS_OUT_OF_RANGE: steps must be an integer between 2 and 512' };
  }

  // 3. Parse base via the SHARED boundary (AC-8: non-finite chroma rejected here).
  //    `parsed.error` is already a full code string (INPUT_TOO_LONG / PARSE_FAILED
  //    / NON_FINITE_COMPONENTS) — forward it verbatim.
  const parsed = parseColor(base);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const baseC = parsed.oklch.c;
  const baseH = parsed.oklch.h; // parseColor already normalizes achromatic h → 0.

  // 3a. Base-chroma ceiling (ALG-2): reject a base whose OKLCH chroma exceeds the
  //     gamut mapper's accepted maximum BEFORE the per-swatch loop, so we never feed
  //     `mapToSRGB` a chroma it would reject mid-ramp. We reuse the SAME ceiling the
  //     mapper enforces (MAX_FINITE_CHROMA = 100, imported from gamut.ts) as the
  //     single source of truth. (Note the two thresholds in play: 100 is the gamut
  //     mapper's chroma ceiling; the shared validation helper's 1e6 magnitude cap is
  //     a far looser non-finite/overflow tripwire on arbitrary components. A base
  //     chroma in (100, 1e6] is finite but still unmappable, so we reject it here.)
  if (baseC > MAX_FINITE_CHROMA) {
    return {
      ok: false,
      error: 'BASE_CHROMA_OUT_OF_RANGE: base OKLCH chroma exceeds the supported maximum (100)',
    };
  }

  // 4. Achromatic guard (AC-5): tiny/zero chroma or non-finite hue → neutral ramp.
  const isAchromatic = baseC <= ACHROMATIC_CHROMA || !Number.isFinite(baseH);
  const hue = isAchromatic ? 0 : baseH;

  // 4a. deltaL validation (ALG-1): when supplied it must be a finite number > 0.
  //     (The schema declares `.gt(0)`, but the lib stays TOTAL for direct callers.)
  if (options?.deltaL != null && (!Number.isFinite(options.deltaL) || options.deltaL <= 0)) {
    return { ok: false, error: 'INVALID_DELTA_L: deltaL must be a finite number > 0' };
  }

  // 5. Lightness range. With `deltaL` supplied, center a symmetric span on the
  //    base L and clamp endpoints into [0,1]; otherwise use the fixed range (also
  //    clamped into [0,1] so a caller-supplied out-of-range endpoint cannot escape
  //    the valid lightness domain).
  let lMax = options?.lightnessMax ?? DEFAULT_L_MAX;
  let lMin = options?.lightnessMin ?? DEFAULT_L_MIN;
  if (options?.deltaL != null) {
    // deltaL already validated finite > 0 above.
    const half = options.deltaL / 2;
    lMax = Math.min(1, parsed.oklch.l + half);
    lMin = Math.max(0, parsed.oklch.l - half);
  } else {
    lMax = Math.min(1, Math.max(0, lMax));
    lMin = Math.min(1, Math.max(0, lMin));
  }

  // 5a. Range validity (ALG-1): lMin must be strictly below lMax, else the linear
  //     interpolation degenerates (zero or inverted span → no monotonic ramp).
  if (lMin >= lMax) {
    return {
      ok: false,
      error: 'INVALID_LIGHTNESS_RANGE: lightnessMin must be strictly less than lightnessMax',
    };
  }

  const denom = steps - 1; // steps >= 2 ⇒ denom >= 1, no division by zero.

  // Base-presence anchor (AC-4): the step whose linear lightness is nearest the
  // base L is snapped to EXACTLY the base color (L, C, H) so the ramp always
  // contains the base. The base L lies inside [lMin, lMax] for any realistic base
  // (and for the deltaL-centered range), so this preserves strict L monotonicity:
  // the snapped L stays between its neighbors' linear L values.
  //
  // BASE-PRESENCE GUARANTEE: deltaL mode CENTERS the ramp on the base lightness
  // (lMax/lMin = base L ± deltaL/2), so with an ODD step count the middle swatch
  // IS the anchor. Because the guarded mapper returns already-in-gamut colors
  // unchanged (the gamut_map pass-through invariant), an in-gamut base reappears
  // VERBATIM as that swatch's hex.
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

  // DEFENSE (ALG-3 part d): make `generateRamp` TOTAL. The base chroma and the
  // lightness range are already validated above, so the guarded primitives below
  // (`mapToSRGB`, `wcagContrastRaw`) are not EXPECTED to throw for in-contract
  // inputs — but to honor the no-throw contract even if culori surfaces an unexpected
  // GamutError/ContrastError mid-loop, we wrap the per-swatch body and convert any
  // throw into a RampError instead of letting it propagate across the lib boundary.
  try {
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

      // Reported OKLCH (ALG-7): this is the REQUESTED-L / `clampChroma` projection,
      // NOT the exact OKLCH of `hex`. We deliberately keep the INPUT target lightness
      // `l` (strictly monotonic by construction — AC-1) and reduce chroma into the
      // sRGB gamut AT THAT lightness with culori `clampChroma` (a pure reporting
      // clamp — no re-mapping, no toGamut reconstruction). This yields a
      // self-consistent in-gamut OKLCH triple so the reported `oklch` passes
      // `inGamut('rgb')` (AC-7) AND preserves strict L monotonicity even when many
      // adjacent out-of-gamut high-chroma swatches would otherwise drift to the same
      // boundary lightness. Consequence: `swatch.oklch` can differ slightly (~ up to
      // a deltaL of ≈0.013) from the EXACT OKLCH of `swatch.hex` — a deliberate
      // trade-off to preserve the monotonic-L guarantee over exact hex round-trip.
      const reportTriple = clampChroma(
        { mode: 'oklch' as const, l, c: curvedC, h: hue },
        'oklch',
        'rgb'
      );
      const fl = reportTriple.l ?? l;
      const fc = reportTriple.c ?? 0;
      const fh = reportTriple.h ?? hue;

      // Per-swatch WCAG contrast vs white/black. Tiers MUST be classified from
      // the RAW pre-rounding ratios (anti-circularity: a raw 6.9999 must yield
      // 'AA' even though it displays as 7.00); the reported ratio is the 2dp
      // display value, computed AFTER the tier (mirrors the contrast tool).
      const whiteRatio = wcagContrastRaw(hex, '#ffffff');
      const blackRatio = wcagContrastRaw(hex, '#000000');

      swatches.push({
        step: i,
        hex,
        // OUT-1: display-rounded like the sibling tools — L/C 5dp, H 2dp. The
        // hex above is produced from the RAW mapped color, never from these
        // rounded reporting values.
        oklch: { l: round5(fl), c: round5(fc), h: round2(fh) },
        vsWhite: { ratio: round2(whiteRatio), tier: toRampTier(whiteRatio) },
        vsBlack: { ratio: round2(blackRatio), tier: toRampTier(blackRatio) },
        inGamut: inGamutRgb(hex),
      });
    }
  } catch {
    // A GamutError/ContrastError (or any unexpected throw) must NOT escape. Convert
    // it to a RampError so the contract "generateRamp never throws" holds totally.
    return { ok: false, error: 'INTERNAL_ERROR: unexpected internal error' };
  }

  return { ok: true, swatches };
}

// ---------------------------------------------------------------------------
// Design-token formatting (TOKENS feature).
// ---------------------------------------------------------------------------

/** Supported design-token output formats. */
export type TokenFormat = 'tailwind' | 'css-variables';

/** Default token base name when the caller does not supply one. */
export const DEFAULT_TOKEN_NAME = 'color';

/**
 * Canonical Tailwind 11-step scale. Used as the token keys (for BOTH formats)
 * when the ramp has EXACTLY 11 swatches; swatch 0 — the LIGHTEST end of the
 * ramp — maps to '50'. Any other swatch count falls back to the 0-based step
 * index as the key.
 */
const TAILWIND_SCALE_11 = [
  '50',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '950',
] as const;

/**
 * Format ramp swatches as a design-token string.
 *
 * - 'css-variables': a `:root` block with one `--<name>-<key>: <hex>;` line per
 *   swatch.
 * - 'tailwind': a pretty-printed (2-space) JSON object string of shape
 *   `{"<name>": {"<key>": "<hex>", ...}}`.
 *
 * The token name is validated at the MCP schema boundary
 * (`/^[a-z][a-z0-9-]*$/i`, 1..64 chars — no spaces/braces, so it embeds safely
 * in a CSS custom-property name or a JSON key); direct callers must honor that
 * contract.
 */
export function formatRampTokens(
  swatches: RampSwatch[],
  format: TokenFormat,
  name: string = DEFAULT_TOKEN_NAME
): string {
  const keys: readonly string[] =
    swatches.length === TAILWIND_SCALE_11.length
      ? TAILWIND_SCALE_11
      : swatches.map((s) => String(s.step));

  if (format === 'css-variables') {
    const lines = swatches.map((s, i) => `  --${name}-${keys[i]}: ${s.hex};`);
    return `:root {\n${lines.join('\n')}\n}`;
  }

  // 'tailwind' — pretty-printed JSON object string.
  const scale: Record<string, string> = {};
  swatches.forEach((s, i) => {
    scale[keys[i]] = s.hex;
  });
  return JSON.stringify({ [name]: scale }, null, 2);
}
