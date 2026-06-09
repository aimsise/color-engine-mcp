/**
 * Shared finiteness/range guard for color components. This is the project-wide
 * shared boundary (AC-6 / KB entry-001): all 6 tool handlers call this AFTER
 * culori parse and BEFORE computation. It is ADDITIVE to the existing per-tool
 * guards (parseColor finite guard in parse.ts, assertFiniteOklch + MAX_FINITE_CHROMA
 * in gamut.ts, wcagContrastRaw non-finite guard in contrast.ts).
 *
 * Error code: NON_FINITE_COMPONENTS (KB entry-002: code-keyed, never e.message).
 */

/** Maximum physically realizable color component magnitude (absolute value). */
const MAX_COMPONENT_MAGNITUDE = 1e6;

/**
 * Validate a map of named numeric color components (e.g. OKLCH `{l, c, h}`).
 * Throws a code-keyed Error when any present value is non-finite (NaN, Infinity,
 * -Infinity) or has an absolute value above MAX_COMPONENT_MAGNITUDE.
 *
 * `undefined` values are skipped (optional fields).
 *
 * @throws {Error} with message `NON_FINITE_COMPONENTS` when validation fails.
 */
export function validateColorComponents(
  components: Record<string, number | undefined>
): void {
  for (const [, v] of Object.entries(components)) {
    if (v === undefined) continue;
    if (!Number.isFinite(v) || Math.abs(v) > MAX_COMPONENT_MAGNITUDE) {
      throw new Error('NON_FINITE_COMPONENTS');
    }
  }
}
