import '../../init.js'; // side-effect: register culori modes (MUST be first import — AC-11)
import { formatHex, getMode, parse } from 'culori/fn';
import type { Color } from 'culori';
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
 * Hard cap on the accepted color-string length (B1/SEC-1 DoS guard). A real CSS
 * color is < ~64 chars; 256 is generous headroom. The cap is enforced HERE, at
 * the shared parse boundary and BEFORE `toRgb`, so it also defends direct lib
 * callers and any handler that bypasses the SDK's schema `.max(256)` validation.
 */
const MAX_INPUT_LENGTH = 256;

/**
 * CE-6: maximum accepted magnitude for any single parsed color component.
 * Mirrors `MAX_COMPONENT_MAGNITUDE` in src/shared/validation.ts (1e6) so the
 * shared parse boundary rejects absurd-but-finite components (e.g.
 * `oklch(0.5 1e30 30)`, `lab(50% 1e30 0)`) with a TYPED
 * `COMPONENT_OUT_OF_RANGE` error instead of letting them flow downstream where
 * they previously surfaced as an opaque `INTERNAL_ERROR` (the tool-level
 * `validateColorComponents` throw). Non-finite values (NaN/Infinity) are NOT
 * handled here — they keep the existing `NON_FINITE_COMPONENTS` path.
 *
 * 1e6 is many orders of magnitude above any legitimate CSS component (lab a/b
 * span ±125, lch C tops out ~150, hue ≤ 360 per turn), so real out-of-gamut
 * inputs (e.g. `oklch(0.7 0.25 30)`) are NEVER rejected by this guard.
 */
const MAX_COMPONENT_MAGNITUDE = 1e6;

/** Static CE-6 error — full "<CODE>: msg" shape, never echoes user input. */
const COMPONENT_OUT_OF_RANGE_ERROR =
  'COMPONENT_OUT_OF_RANGE: color component magnitude exceeds the supported range';

/**
 * CSS-NONE: normalize CSS Color 4 `none` channels to 0, per the CSS Color 4
 * computed-value rule. culori parses a `none` token as a MISSING field
 * (`undefined`, not NaN). Its CROSS-mode converters already treat a missing
 * channel as 0, but a SAME-mode "conversion" (e.g. `toRgb` on an already-rgb
 * object) is an identity that never fills the gap, so `rgb(255 none 0)`
 * previously tripped the finite-RGB guard below (NON_FINITE_COMPONENTS) in
 * every tool routed through this boundary. Filling the missing channels HERE —
 * at the shared parse boundary, mirroring the `?? 0` normalization in
 * `gamutMapColor` (src/lib/color/gamut.ts) — makes all six tools treat `none`
 * as 0 for every parsed mode.
 *
 * `alpha` is deliberately skipped: a missing alpha means fully opaque (1), NOT
 * transparent (0), and the alpha-policy checks in contrast/solve_for_contrast
 * rely on that distinction.
 */
function fillNoneChannels(parsed: Color): Color {
  const definition = getMode(parsed.mode) as { channels: readonly string[] } | undefined;
  if (!definition) return parsed; // defensive: parse only emits registered modes
  const out: Record<string, unknown> = { ...parsed };
  for (const channel of definition.channels) {
    if (channel !== 'alpha' && out[channel] === undefined) {
      out[channel] = 0;
    }
  }
  return out as unknown as Color;
}

/**
 * CE-4: clamp a 0-1 channel per CSS Color 4. `none` channels were already
 * normalized to 0 by `fillNoneChannels`, so `v` is always a number here.
 */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * CE-4: CSS Color 4 declares that out-of-range channels in the LEGACY spaces
 * are clamped at parse time: rgb()/hex clamp r/g/b, hsl() clamps s/l (hue
 * wraps). culori parses them UNclamped, so we clamp here — at the parse
 * boundary — for those two parsed modes ONLY.
 *
 * CRITICAL: inputs parsed in any OTHER mode (oklch, lab, p3, …) are returned
 * UNTOUCHED. An out-of-gamut `oklch()` must keep flowing unclamped into
 * gamut_map, or that tool becomes useless.
 */
function clampLegacyModes(parsed: Color): Color {
  if (parsed.mode === 'rgb') {
    return {
      ...parsed,
      r: clamp01(parsed.r),
      g: clamp01(parsed.g),
      b: clamp01(parsed.b),
    } as Color;
  }
  if (parsed.mode === 'hsl') {
    return { ...parsed, s: clamp01(parsed.s), l: clamp01(parsed.l) } as Color;
  }
  return parsed;
}

/**
 * CE-6: true when any FINITE numeric component of the parsed color exceeds
 * `MAX_COMPONENT_MAGNITUDE` in absolute value. Non-finite components are
 * deliberately skipped — they fall through to the NON_FINITE_COMPONENTS guard.
 */
function hasAbsurdComponent(parsed: Color): boolean {
  for (const v of Object.values(parsed)) {
    if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > MAX_COMPONENT_MAGNITUDE) {
      return true;
    }
  }
  return false;
}

/**
 * Clamp an integer sRGB channel into the valid 0..255 range (ALG-4/MCP-6). culori
 * RGB channels are unbounded 0-1 floats; an out-of-gamut input (e.g. a wide-gamut
 * OKLCH) can round to a channel < 0 or > 255. We clamp at the source so the
 * `rgb` projection is ALWAYS a valid sRGB triple, consistent with `hex` (which
 * `formatHex` already clamps). `inGamut` still reports the truth for such inputs.
 */
function clampChannel(channel: number): number {
  const n = Math.round(channel * 255);
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

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
  // 0. Type guard, then CE-7 whitespace trim, then length guard (B1/SEC-1 DoS
  //    BLOCKER). The trim runs BEFORE the length check so " #fff " parses; it is
  //    O(n) on the raw string but trivially cheap (no tokenization), so the DoS
  //    bound still holds. The cap MUST precede any culori parsing: it bounds the
  //    work culori does on pathological megabyte inputs and rejects non-string
  //    callers. The error is a full "<CODE>: msg" string (forwarded verbatim by tools).
  if (typeof input !== 'string') {
    return { ok: false, error: 'INPUT_TOO_LONG: color string exceeds 256 characters' };
  }
  const trimmed = input.trim();
  if (trimmed.length > MAX_INPUT_LENGTH) {
    return { ok: false, error: 'INPUT_TOO_LONG: color string exceeds 256 characters' };
  }

  // 1. Universal parse — raw, mode-tagged result. culori returns `undefined` for
  //    unrecognized / token-level invalid input (e.g. "not-a-color", "#12",
  //    "oklch(NaN 0.2 30)"). Parsing the raw object (instead of converting the
  //    string directly) exposes the parsed MODE, which CE-4 needs for the
  //    legacy-space clamp below.
  const raw = parse(trimmed);
  if (!raw) {
    // SEC-3: do NOT echo raw user input back. Return a static code string.
    return { ok: false, error: 'PARSE_FAILED: could not parse the provided color string' };
  }

  // 1a. CSS-NONE: normalize `none` channels (missing culori fields) to 0 per
  //     the CSS Color 4 computed-value rule, BEFORE any guard, so a same-mode
  //     no-op conversion (e.g. rgb(255 none 0) → toRgb) cannot leak an
  //     undefined channel into the finite-RGB guard below.
  const filled = fillNoneChannels(raw);

  // 1b. CE-4: clamp rgb()/hex/hsl() channels per CSS Color 4 at the parse
  //     boundary. Other modes (oklch, lab, …) flow through UNclamped.
  const color = clampLegacyModes(filled);

  // 1c. CE-6: absurd-magnitude but FINITE components (e.g. chroma 1e30) get a
  //     typed error instead of surfacing later as INTERNAL_ERROR. Runs after the
  //     legacy clamp so a CSS-clamped rgb(1e30 0 0) correctly behaves as
  //     rgb(255 0 0) rather than being rejected.
  if (hasAbsurdComponent(color)) {
    return { ok: false, error: COMPONENT_OUT_OF_RANGE_ERROR };
  }

  const rgb = toRgb(color);
  if (!rgb) {
    return { ok: false, error: 'PARSE_FAILED: could not parse the provided color string' };
  }

  // 2. Finite-value guard on RGB channels. A parse-ACCEPTED-then-overflows input
  //    such as "oklch(0.5 1e400 30)" yields rgb { r: NaN, g: NaN, b: NaN } — reject
  //    deterministically (no hang) so AC-5 / AC-8 hold within the 500 ms bound.
  if (!Number.isFinite(rgb.r) || !Number.isFinite(rgb.g) || !Number.isFinite(rgb.b)) {
    return { ok: false, error: 'NON_FINITE_COMPONENTS: color resolved to non-finite components' };
  }

  // 2a. CE-6 (defense-in-depth): finite-but-absurd RGB projection — a wide-gamut
  //     component below 1e6 can still blow up through the conversion matrices.
  if (
    Math.abs(rgb.r) > MAX_COMPONENT_MAGNITUDE ||
    Math.abs(rgb.g) > MAX_COMPONENT_MAGNITUDE ||
    Math.abs(rgb.b) > MAX_COMPONENT_MAGNITUDE
  ) {
    return { ok: false, error: COMPONENT_OUT_OF_RANGE_ERROR };
  }

  const oklch = toOklch(rgb);
  if (!oklch) {
    return { ok: false, error: 'NON_FINITE_COMPONENTS: color resolved to non-finite components' };
  }

  // 3. Finite-value guard on OKLCH. `h` is legitimately undefined/NaN for
  //    achromatic colors (c ≈ 0); reject a non-finite hue ONLY when chroma is
  //    meaningful (AC-9 achromatic special case).
  const { l, c, h } = oklch;
  const hNonFinite = c > ACHROMATIC_CHROMA && !Number.isFinite(h);
  if (!Number.isFinite(l) || !Number.isFinite(c) || hNonFinite) {
    return { ok: false, error: 'NON_FINITE_COMPONENTS: color resolved to non-finite components' };
  }

  // 3a. CE-6 (defense-in-depth): finite-but-absurd OKLCH projection. `h` is
  //     omitted — atan2 output is inherently bounded to (-180, 360).
  if (Math.abs(l) > MAX_COMPONENT_MAGNITUDE || Math.abs(c) > MAX_COMPONENT_MAGNITUDE) {
    return { ok: false, error: COMPONENT_OUT_OF_RANGE_ERROR };
  }

  // 4. Hex via formatHex (lowercase #rrggbb; clamps silently — accuracy is
  //    reported separately through `inGamut`).
  const hex = formatHex(rgb);

  // 5. culori RGB channels are 0-1 floats; AC-1 requires exact integer channels.
  //    ALG-4/MCP-6: clamp each channel into [0,255] so the `rgb` projection is a
  //    valid sRGB triple even for out-of-gamut inputs (consistent with `hex`).
  const rgbInts = {
    r: clampChannel(rgb.r),
    g: clampChannel(rgb.g),
    b: clampChannel(rgb.b),
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
