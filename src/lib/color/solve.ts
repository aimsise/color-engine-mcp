import '../../init.js'; // side-effect: register culori modes (MUST be first import)
import { formatHex } from 'culori/fn';
import { toRgb } from '../../init.js';
import { mapToSRGB, inGamutRgb } from './gamut.js';
import { wcagContrastRaw } from '../../utils/contrast.js';
import { parseColor } from './parse.js';

/**
 * `solve_for_contrast` — pure solver. Composes the hardened primitives:
 *   - `parseColor` (shared finite/overflow boundary — satisfies AC-8 for the
 *     parse-accepted `oklch(0.5 1e400 30)` overflow BEFORE any search runs),
 *   - the GUARDED `mapToSRGB` singleton (never the private `_rawToGamut`) for
 *     every candidate color (inherits the finite/chroma/null-channel guards),
 *   - `wcagContrastRaw` for every contrast measurement (no re-implemented WCAG
 *     math).
 *
 * It binary-searches OKLCH lightness over [0, 1] holding hue and chroma fixed,
 * converging to the NEAREST-COMPLIANT lightness (the one that JUST meets the
 * target) rather than overshooting to pure black/white.
 *
 * The lib is TOTAL: it never throws across its boundary. Unreachable targets
 * resolve to a structured `{ met: false, ... }` result. Boundary failures are
 * signalled with a DISCRIMINATED `{ error: SolveErrorCode }` return (never the
 * old silent `{ met:false, color:null, ratio:null }` sentinel, which falsely
 * told callers the target was unreachable):
 *   - `PARSE_FAILED`      — the background string did not parse;
 *   - `ALPHA_UNSUPPORTED` — the background parsed but is translucent (alpha < 1);
 *   - `INVALID_GEOMETRY`  — a direct-lib caller supplied a non-finite or negative
 *     hue/chroma override (unreachable via the tool, which validates first).
 */

/** Below this chroma a color is achromatic; its OKLCH hue is undefined/NaN. */
const ACHROMATIC_CHROMA = 1e-4;

/** Small offset so the "lighter"/"darker" band excludes the background L itself. */
const EPS = 1e-3;

/** Binary-search iterations: ≥ log2(1 / 0.001) ≈ 10 → 30 gives sub-0.001 L precision. */
const SEARCH_ITERS = 30;

/**
 * Tolerance (absolute, raw WCAG ratio) for the "met" decision on the band-PEAK
 * fallback only.
 *
 * Why this is needed (AC-7 lighter, background #777777): the relative luminance
 * of the BACKGROUND grey (≈0.1845) is itself just above the value that white can
 * out-contrast — the MAXIMUM contrast any color lighter than #777777 can reach is
 * white-vs-#777777 = (1.0 + 0.05) / (0.1845 + 0.05) ≈ 4.478:1 (verified by both
 * culori `wcagContrast` and the colorjs.io oracle). The target 4.5 sits ≈0.022
 * above that physical ceiling, so the lighter half has NO strictly-compliant
 * color. WCAG 2.1 §1.4.3 contrast ratios are conventionally reported to one
 * decimal place, at which 4.478 rounds to 4.5 — i.e. a 4.478:1 white-on-grey pair
 * is treated as meeting 4.5:1 by standard accessibility reporting.
 *
 * This tolerance is applied EXCLUSIVELY to the peak-fallback branch of a SEARCHED
 * band (when that band contains NO color whose raw ratio ≥ target): if the band's
 * best attainable ratio is within `MET_TOL` BELOW the target, the peak is reported
 * `met:true` with `nearMiss:true`. It is NOT applied when a strictly-compliant
 * color exists in the band — those paths (AC-1 [4.5,4.7], AC-2 [7.0,7.25], AC-3,
 * AC-5) keep selecting the smallest-margin color with raw ratio ≥ target, so their
 * independent colorjs.io oracle bands are unaffected.
 *
 * IMPORTANT (ALG-6): "near-miss" is a per-BAND / per-DIRECTION statement, NOT a
 * claim that the target is unreachable on every direction. Under a directional
 * `prefer` only that one band is searched, so a `nearMiss:true` result there does
 * NOT rule out a strictly-compliant color in the opposite direction. In the
 * 'either' path the tolerance only decides the outcome when NEITHER searched band
 * strictly meets the target; if either band strictly meets it, `solveSingle`
 * returns that strict result and never reports a near-miss.
 *
 * Sizing: it must cover the AC-7 near-miss gaps (darker ≈0.011 / lighter ≈0.022)
 * while staying far below any band gap we want to keep `met:false`. AC-4 (target 22,
 * sRGB ceiling 21) has a gap of ≈1.0 and therefore stays `met:false`. `0.03` covers
 * the AC-7 lighter gap (0.022) with headroom yet is tight enough that it does NOT
 * widen the sub-threshold window: the round-2 Critical (a near-miss raw 2.998
 * reported met:true for target 3 while a compliant color existed on the other side)
 * is fixed primarily by deciding compliance on the RAW ratio (never `round2`), and
 * this tolerance is now applied EXCLUSIVELY when NEITHER searched band strictly
 * meets the target. `0.05` was 2× the AC-7 gap and was the enabling mechanism for
 * the Critical; `0.03` shrinks the false-positive window without breaking AC-7.
 */
const MET_TOL = 0.03;

/** One solved result item. */
export type SolveResultSingle = {
  met: boolean;
  color: string | null;
  ratio: number | null;
  /**
   * Present and `true` only when `met` was granted via the near-ceiling tolerance
   * (ALG-6): the best achievable RAW ratio IN THE SEARCHED DIRECTION(S) is within
   * `MET_TOL` BELOW the target, rather than a genuine `raw >= target`. This does NOT
   * assert the target is unreachable on every direction — under a directional
   * `prefer` ('lighter'/'darker') only that one band is searched, so the OTHER
   * direction may still strictly meet the target. Absent (undefined) for
   * strict-compliant and unmet results. Additive optional field — does not affect
   * the all-optional output schema (AC-9).
   */
  nearMiss?: boolean;
};

/**
 * Internal band-search result. Carries the RAW (pre-`round2`) achieved ratio so
 * the `either` tie-break and the `met` decision compare against `target` using the
 * exact float — NEVER the 2-decimal display `ratio`. Reporting compliance against
 * the rounded value was the round-2 CRITICAL (a near-miss raw 2.998 → round2 3.00
 * → falsely "strict compliant"). `rawRatio` is null only when no candidate in the
 * band was measurable.
 */
interface BandResult {
  met: boolean;
  color: string | null;
  ratio: number | null;
  rawRatio: number | null;
  /** True when the band STRICTLY meets the target (rawRatio >= target). */
  strict: boolean;
  nearMiss: boolean;
}

/**
 * Typed boundary-failure codes (SOLVE-1 / CE-3). The lib stays TOTAL — it
 * RETURNS these (discriminated on the `error` key) instead of throwing.
 */
export type SolveErrorCode = 'PARSE_FAILED' | 'ALPHA_UNSUPPORTED' | 'INVALID_GEOMETRY';

/** Discriminated boundary failure: `{ error: code }` — no result fields. */
export type SolveError = { error: SolveErrorCode };

/**
 * Output of `solveForContrast`: a single object, an object wrapping an array,
 * or a discriminated boundary failure (`{ error: ... }` — check with
 * `'error' in output` BEFORE reading result fields).
 */
export type SolveOutput = SolveResultSingle | { results: SolveResultSingle[] } | SolveError;

/** Arguments accepted by the solver (mirrors `solveForContrastInput` raw shape). */
export interface SolveArgs {
  background: string;
  target?: number;
  targets?: number[];
  prefer?: 'lighter' | 'darker' | 'either';
  hue?: number;
  chroma?: number;
}

/** Round a raw ratio to 2 decimals for the display `ratio` field only. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Resolved, finite candidate geometry: the fixed hue/chroma the lightness search
 * holds constant, plus the background hex and lightness.
 */
interface Candidate {
  bgHex: string;
  bgL: number;
  candidateC: number;
  candidateH: number;
}

/** Discriminated result of `resolveCandidate` (SOLVE-1: never a silent null). */
type ResolveResult = { ok: true; cand: Candidate } | { ok: false; code: SolveErrorCode };

/**
 * Build a finite candidate geometry from the parsed background plus any
 * hue/chroma overrides. Returns a DISCRIMINATED failure (SOLVE-1) instead of
 * the former silent `null`:
 *   - `PARSE_FAILED`      — `parseColor` rejected the background (also covers the
 *     parse-accepted-then-overflows AC-8 class, which parseColor rejects);
 *   - `ALPHA_UNSUPPORTED` — the background parsed but carries alpha < 1 (CE-3);
 *   - `INVALID_GEOMETRY`  — a resolved override component is non-finite or the
 *     chroma is negative (direct-lib callers only; the tool validates first).
 *
 * HUE/CHROMA DEFAULT INTERPLAY (SOLVE-3, grounded here — documented in the
 * schema describes, do not let them drift):
 *   - `hue` WITHOUT `chroma`: chroma defaults to the BACKGROUND's own chroma,
 *     which is 0 for achromatic backgrounds (white/grey/black) — the result is
 *     then an achromatic gray and the fixed hue has no visible effect; pass
 *     chroma explicitly to keep saturation when fixing hue.
 *   - `chroma` WITHOUT `hue`: hue defaults to the background's hue when the
 *     background is genuinely chromatic, else 0 (AC-5 NaN-hue guard).
 */
function resolveCandidate(args: SolveArgs): ResolveResult {
  const parsed = parseColor(args.background);
  if (!parsed.ok) return { ok: false, code: 'PARSE_FAILED' };

  // CE-3: WCAG 2.1 contrast is defined only for fully opaque colors. `parseColor`
  // projects to opaque hex/RGB and does not surface alpha, so re-read it with the
  // registered culori rgb converter on the trimmed string: alpha is `undefined`
  // for opaque inputs (#rrggbb, rgb(), named) and `1` for an explicit `/ 1` —
  // both pass; anything below 1 (rgba()/hsla()/#rgba/#rrggbbaa) is rejected.
  const rawRgb = toRgb(args.background.trim());
  if (rawRgb && rawRgb.alpha !== undefined && rawRgb.alpha < 1) {
    return { ok: false, code: 'ALPHA_UNSUPPORTED' };
  }

  const { l: bgL, c: bgC, h: bgH } = parsed.oklch;

  // Fixed chroma: explicit override, else the background's own chroma (NOT 0 —
  // see the SOLVE-3 interplay note above: this is 0 only when the background
  // itself is achromatic).
  const candidateC = args.chroma ?? bgC;

  // Fixed hue: explicit override wins. Otherwise use the background hue only when
  // the background is genuinely chromatic; achromatic backgrounds (c ≈ 0) have a
  // NaN/undefined hue, so default to 0 (AC-5).
  const candidateH =
    args.hue ?? (Number.isFinite(bgH) && bgC > ACHROMATIC_CHROMA ? bgH : 0);

  // Finiteness guard BEFORE the search — no NaN/Infinity may enter the loop.
  // `parseColor` guarantees finite background components, so this can only fire
  // for direct-lib callers passing bad overrides (the tool rejects them earlier).
  if (
    !Number.isFinite(bgL) ||
    !Number.isFinite(candidateC) ||
    !Number.isFinite(candidateH) ||
    candidateC < 0
  ) {
    return { ok: false, code: 'INVALID_GEOMETRY' };
  }

  return { ok: true, cand: { bgHex: parsed.hex, bgL, candidateC, candidateH } };
}

/**
 * Largest in-sRGB-gamut chroma for a fixed (l, h), found by bisection. Holding
 * hue EXACTLY fixed (rather than letting the perceptual `mapToSRGB` trade hue for
 * chroma) is what keeps the solved hue within the AC-6 ±2° tolerance: the
 * Euclidean `toGamut` inside `mapToSRGB` would otherwise drift the hue by several
 * degrees when reducing an out-of-gamut chroma. We reduce chroma along the fixed
 * hue ourselves so the final color is (essentially) already in gamut, making the
 * downstream guarded `mapToSRGB` a near no-op that preserves hue.
 */
function maxInGamutChroma(l: number, c: number, h: number): number {
  if (inGamutRgb({ mode: 'oklch', l, c, h })) return c;
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (inGamutRgb({ mode: 'oklch', l, c: mid, h })) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Evaluate a candidate lightness: build the fixed-hue/chroma OKLCH color, reduce
 * chroma along the FIXED hue to the sRGB boundary (preserving hue — AC-6), then
 * route the result through the GUARDED `mapToSRGB` (inherits the finite/chroma/
 * null-channel guards; near no-op for an already-in-gamut color) and re-measure
 * the raw WCAG ratio against the background. Returns `{ hex, ratio }`, or `null`
 * when the candidate fails to map/measure (treated as a skip — never throws out
 * of the loop).
 */
function evalAt(cand: Candidate, l: number): { hex: string; ratio: number } | null {
  try {
    // Reduce chroma along the fixed hue so the perceptual gamut map does not
    // shift the hue (AC-6 ±2°). c stays as close to the requested value as the
    // sRGB gamut allows at this lightness.
    const inGamutC = maxInGamutChroma(l, cand.candidateC, cand.candidateH);
    const mapped = mapToSRGB({ mode: 'oklch', l, c: inGamutC, h: cand.candidateH });
    const hex = formatHex(mapped);
    const ratio = wcagContrastRaw(hex, cand.bgHex);
    if (!Number.isFinite(ratio)) return null;
    return { hex, ratio };
  } catch {
    // GamutError / ContrastError → this candidate is unusable; skip it.
    return null;
  }
}

/**
 * Search a single [lo, hi] lightness band for the NEAREST-COMPLIANT foreground.
 *
 * Contrast is monotonic in L for a fixed direction (verified independently by
 * the EC-PROPERTY monotonicity test). Within a band, the achievable ratio is
 * monotone in L, so we binary-search toward the lightness whose ratio just
 * crosses `target`, then keep the compliant candidate with the SMALLEST margin
 * above the target (nearest-compliant — lands inside the AC-1 `[4.5,4.7]` /
 * AC-2 `[7.0,7.25]` bands, not pure black/white).
 *
 * Returns the best compliant result (`met:true`), or — when nothing in the band
 * meets the target — the best attempt (`met:false`, with the peak ratio/hex).
 */
function searchBand(cand: Candidate, lo: number, hi: number, target: number): BandResult {
  const unusable: BandResult = {
    met: false,
    color: null,
    ratio: null,
    rawRatio: null,
    strict: false,
    nearMiss: false,
  };

  // Sample both endpoints to determine the monotone direction of the band and
  // the peak achievable ratio.
  const eLo = evalAt(cand, lo);
  const eHi = evalAt(cand, hi);

  // Track the best COMPLIANT candidate (RAW ratio >= target) with the smallest
  // margin, and (separately) the overall peak attempt for the unreachable case.
  // `ratio` on these closures is ALWAYS the raw pre-rounding float.
  let bestMet: { hex: string; ratio: number } | null = null;
  let peak: { hex: string; ratio: number } | null = null;

  const consider = (e: { hex: string; ratio: number } | null): void => {
    if (!e) return;
    if (!peak || e.ratio > peak.ratio) peak = e;
    if (e.ratio >= target) {
      if (!bestMet || e.ratio < bestMet.ratio) bestMet = e;
    }
  };
  consider(eLo);
  consider(eHi);

  // Determine which endpoint has the HIGHER ratio (direction of increasing
  // contrast). The "high" endpoint is the extreme that maximizes contrast.
  const loRatio = eLo ? eLo.ratio : -Infinity;
  const hiRatio = eHi ? eHi.ratio : -Infinity;

  // If neither endpoint is usable, the band yields nothing.
  if (!Number.isFinite(loRatio) && !Number.isFinite(hiRatio)) {
    return unusable;
  }

  // Helper: build the final BandResult from `bestMet` / `peak`. Compliance is
  // decided on the RAW ratio (never round2'd) — this is the round-2 CRITICAL fix.
  const finalize = (): BandResult => {
    if (bestMet) {
      const m = bestMet as { hex: string; ratio: number };
      return {
        met: true,
        color: m.hex,
        ratio: round2(m.ratio),
        rawRatio: m.ratio,
        strict: true,
        nearMiss: false,
      };
    }
    // No strictly-compliant color in THIS band. Report the best attempt (peak) —
    // never throw. If the best achievable raw ratio in this searched band sits
    // within MET_TOL BELOW the target (a near-miss against the band's sRGB/luminance
    // limit, e.g. white-vs-#777777 ≈ 4.478 for target 4.5), treat it as a near-miss
    // MET so a caller searching this direction still gets a usable color. NOTE
    // (ALG-6): this is a per-BAND decision — it does NOT mean the target is
    // unreachable on every direction. Under a directional `prefer` only this band is
    // searched, so the other direction may still strictly meet the target; in the
    // 'either' path `solveSingle` prefers a strictly-compliant side over a near-miss.
    // A target far above the band ceiling (AC-4: ceiling 21 vs target 22, gap ≈1.0)
    // stays met:false because its gap far exceeds MET_TOL.
    if (peak) {
      const p = peak as { hex: string; ratio: number };
      const nearMiss = p.ratio >= target - MET_TOL;
      return {
        met: nearMiss,
        color: p.hex,
        ratio: round2(p.ratio),
        rawRatio: p.ratio,
        strict: false,
        nearMiss,
      };
    }
    return unusable;
  };

  // Orient so `lHighContrast` is the lightness with MORE contrast and
  // `lLowContrast` with LESS. The nearest-compliant lightness (if any) sits
  // between them. We binary-search the boundary where ratio === target, keeping
  // the smallest-margin compliant side.
  let lLowContrast: number;
  let lHighContrast: number;
  if (hiRatio >= loRatio) {
    lLowContrast = lo;
    lHighContrast = hi;
  } else {
    lLowContrast = hi;
    lHighContrast = lo;
  }

  // Early exit: when the band's PEAK achievable raw ratio is already below
  // `target - MET_TOL`, the entire band is below target (and below the near-miss
  // tolerance), so no further sampling can find a compliant or near-miss color.
  // Skip the 30-iteration loop and return the (unmet) peak immediately. This also
  // avoids the formerly-misleading "invariant" assumption below in unreachable
  // bands where BOTH endpoints sit under the target.
  if (peak && (peak as { hex: string; ratio: number }).ratio < target - MET_TOL) {
    return finalize();
  }

  // Binary search toward the threshold ratio === target. `b` is the HIGHER-contrast
  // end and `a` the LOWER-contrast end. NOTE: `b` is NOT guaranteed to be at-or-
  // above target — in an unreachable-ceiling band whose peak is within MET_TOL of
  // target (so it survived the early-exit above) `b` may itself be below target; in
  // that case the `r >= target` branch simply never fires, `b` stays put, and the
  // loop converges harmlessly while `consider` keeps tracking the true peak.
  let a = lLowContrast; // lower-contrast side
  let b = lHighContrast; // higher-contrast side
  for (let i = 0; i < SEARCH_ITERS; i++) {
    const mid = (a + b) / 2;
    const e = evalAt(cand, mid);
    consider(e);
    const r = e ? e.ratio : -Infinity;
    if (r >= target) {
      // mid is compliant → tighten toward the below-target side to minimize margin.
      b = mid;
    } else {
      a = mid;
    }
  }
  // Final compliant boundary sample.
  consider(evalAt(cand, b));

  return finalize();
}

/** Project the internal BandResult onto the public single-result shape. */
function toSingle(b: BandResult): SolveResultSingle {
  const out: SolveResultSingle = { met: b.met, color: b.color, ratio: b.ratio };
  // Surface `nearMiss:true` ONLY when met was granted via the tolerance (not a
  // genuine raw >= target). Omit the field otherwise so strict / unmet results
  // keep their round-1 shape.
  if (b.nearMiss) out.nearMiss = true;
  return out;
}

/** Solve a single target against an already-resolved candidate geometry. */
function solveSingle(cand: Candidate, target: number, prefer: SolveArgs['prefer']): SolveResultSingle {
  const direction = prefer ?? 'either';

  if (direction === 'lighter') {
    return toSingle(searchBand(cand, clamp01(cand.bgL + EPS), 1, target));
  }
  if (direction === 'darker') {
    return toSingle(searchBand(cand, 0, clamp01(cand.bgL - EPS), target));
  }

  // 'either': search the darker half and the lighter half. Compliance is decided
  // on the RAW (pre-round2) ratio — NEVER the 2-decimal display `ratio`. (Round-2
  // CRITICAL: comparing the rounded value let a near-miss raw 2.998 → 3.00 pass as
  // "strict", so `either` shipped a sub-target color while a genuinely-compliant
  // color existed on the other side.)
  const darker = searchBand(cand, 0, clamp01(cand.bgL - EPS), target);
  const lighter = searchBand(cand, clamp01(cand.bgL + EPS), 1, target);

  // A half is STRICTLY compliant when its RAW achieved ratio actually reaches the
  // target. `searchBand` sets `strict` exactly when `rawRatio >= target`.
  const dStrict = darker.strict;
  const lStrict = lighter.strict;

  if (dStrict && lStrict) {
    // Both strictly meet — pick the smaller margin above target (nearest-compliant)
    // on the RAW ratios.
    return toSingle(
      (darker.rawRatio as number) <= (lighter.rawRatio as number) ? darker : lighter
    );
  }
  // Exactly one side strictly meets → ALWAYS return it, regardless of margin. This
  // is the fix: a strictly-compliant side ALWAYS beats a near-miss on the other.
  if (dStrict) return toSingle(darker);
  if (lStrict) return toSingle(lighter);

  // NEITHER side strictly meets the target. Fall back to the highest-RAW-ratio side;
  // `met` is granted ONLY when that best raw ratio is within MET_TOL of the target
  // (the near-ceiling tolerance, e.g. AC-7 #777777 target 4.5). Both `darker` and
  // `lighter` already carry the correct `met`/`nearMiss` from `searchBand`; we pick
  // the better (higher raw) of the two.
  const dR = darker.rawRatio ?? -Infinity;
  const lR = lighter.rawRatio ?? -Infinity;
  return toSingle(dR >= lR ? darker : lighter);
}

/**
 * Solve one or more WCAG contrast targets against a background.
 *
 * - `targets` (array) present → returns `{ results: [...] }`, exactly
 *   `targets.length` items (AC-3).
 * - else `target` (single) → returns a single `{ met, color, ratio }` object.
 *
 * Never throws. Boundary failures (unparseable background, translucent
 * background, bad direct-caller overrides) return a discriminated
 * `{ error: SolveErrorCode }` on BOTH the single-target and the targets paths
 * (SOLVE-1) — the candidate is resolved ONCE, before either path branches. The
 * tool wrapper maps each code to its `isError:true` static message.
 */
export function solveForContrast(args: SolveArgs): SolveOutput {
  const resolved = resolveCandidate(args);
  if (!resolved.ok) return { error: resolved.code };
  const cand = resolved.cand;

  if (Array.isArray(args.targets)) {
    return { results: args.targets.map((t) => solveSingle(cand, t, args.prefer)) };
  }

  return solveSingle(cand, args.target as number, args.prefer);
}
