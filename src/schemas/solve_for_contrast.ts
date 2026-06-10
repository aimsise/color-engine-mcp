import * as z from 'zod/v4';

/**
 * Single source of truth for the `solve_for_contrast` tool schemas. Imported by
 * the tool registration (`src/tools/solve_for_contrast.ts`) AND the test suite so
 * the registered contract and the asserted contract never drift.
 *
 * Raw shapes (plain `{ field: z.xxx() }` objects, NOT wrapped in `z.object()`):
 * the MCP SDK 1.29.0 `registerTool` auto-wraps them (`normalizeObjectSchema` →
 * `objectFromShape`) — matches the passing sibling pattern (`gamut_map.ts`,
 * `generate_ramp.ts`).
 */

/**
 * Input raw shape. `target` (single) and `targets` (multi) are both optional at
 * the schema level; the tool wrapper enforces that at least one is present and
 * rejects malformed combinations (missing background / negative target) per AC-10.
 *
 * MCP-3 PRECEDENCE: if BOTH `target` and `targets` are provided, `targets` takes
 * precedence (the single `target` is ignored). The two paths return DIFFERENT
 * response shapes — see SolveForContrastOutputSchema below (single -> {met,color,
 * ratio[,nearMiss]}; targets -> {results:[...]}).
 */
export const solveForContrastInput = {
  // B1/SEC-1: .max(256) bounds the background BEFORE culori parsing (DoS defense).
  background: z
    .string()
    .max(256)
    .describe('Background CSS color string, e.g. "#FFFFFF", "oklch(0.6 0.1 240)" (max 256 chars).'),
  // MCP-4: .finite() rejects NaN/Infinity at the boundary (keeps existing .min(0)).
  target: z
    .number()
    .finite()
    .min(0)
    .optional()
    .describe('Single WCAG 2.1 contrast target (e.g. 4.5, 7). Use this OR `targets` (targets wins if both given).'),
  // MCP-4: each target element is finite and >= 0; the array is capped at 50.
  // SOLVE-2: .min(1) rejects an empty array at the protocol layer (an empty
  // `targets` would otherwise silently yield a useless `{ results: [] }`).
  targets: z
    .array(z.number().finite().min(0))
    .min(1)
    .max(50)
    .optional()
    .describe('Multiple WCAG 2.1 contrast targets (1-50 entries; an empty array is rejected). Takes precedence over `target`. Returns one result per target.'),
  prefer: z
    .enum(['lighter', 'darker', 'either'])
    .optional()
    .describe('Search direction relative to the background lightness. Default "either".'),
  // MCP-4: hue is a cyclic degree value — kept unbounded but must be finite.
  // SOLVE-3: the default-interplay wording below is GROUNDED in
  // `resolveCandidate` (src/lib/color/solve.ts): candidateC = chroma ?? bgC.
  hue: z
    .number()
    .finite()
    .optional()
    .describe('Fixed OKLCH hue (degrees, cyclic) held constant during the lightness search. Giving hue WITHOUT chroma does not add saturation: chroma then defaults to the background\'s own chroma, which is 0 for achromatic backgrounds (white/grey/black), so the result is an achromatic gray and the hue has no visible effect — pass chroma explicitly to keep saturation when fixing hue.'),
  // MCP-4: .finite() rejects NaN/Infinity at the boundary (keeps existing .min(0)).
  // SOLVE-3: grounded in `resolveCandidate`: candidateH = hue ?? (chromatic bg
  // ? bgH : 0); chroma may be reduced per-lightness to stay inside sRGB.
  chroma: z
    .number()
    .finite()
    .min(0)
    .optional()
    .describe('Fixed OKLCH chroma (>= 0) held constant during the lightness search (reduced along the fixed hue when the sRGB gamut requires it). Defaults to the background\'s own chroma when omitted; pass chroma explicitly to keep saturation when fixing hue. Giving chroma WITHOUT hue fixes the hue to the background\'s hue, or to 0 when the background is achromatic.'),
};

/**
 * One solved result item.
 * - `met`: whether the target contrast was achievable.
 * - `color`: the nearest-compliant foreground hex, or `null` when unreachable.
 * - `ratio`: the achieved WCAG 2.1 ratio (engine-rounded for display), or the
 *   peak attainable ratio when `met === false`; `null` only in the degenerate
 *   case where no candidate color in the searched band was measurable.
 *   (SOLVE-1: an unparseable background no longer reaches a result — the tool
 *   returns the PARSE_FAILED error instead of the old null/null sentinel.)
 */
export const SolveResultSchema = z.object({
  // MCP-7: concise per-field descriptions.
  met: z.boolean().describe('Whether the target contrast was achievable'),
  color: z
    .string()
    .nullable()
    .describe('Nearest-compliant foreground hex, or null when no candidate in the searched band was measurable'),
  ratio: z
    .number()
    .nullable()
    .describe('Achieved WCAG 2.1 ratio (display-rounded), or peak attainable when met is false; null only when no candidate was measurable (an unparseable background returns the PARSE_FAILED tool error instead)'),
  // T-6 hardening: nearMiss is an optional additive field present only when
  // met was granted via the near-ceiling tolerance (not a strict raw >= target).
  // ALG-6: the best achievable raw ratio in the searched direction is within
  // MET_TOL below the target; under a directional `prefer` the other direction
  // may still strictly meet it.
  nearMiss: z
    .boolean()
    .optional()
    .describe('Present/true when met was granted via the near-ceiling tolerance (raw ratio within MET_TOL below target)'),
});

/**
 * Output schema for the `solve_for_contrast` tool — a SUPERSET raw-shape object
 * that accommodates BOTH the single-target path and the multi-target path.
 *
 * WHY THE SUPERSET (see plan Risk R1, confirmed against installed
 * `@modelcontextprotocol/sdk@1.29.0` via context7): the MCP `structuredContent`
 * returned by a tool handler MUST be a top-level OBJECT — `validateToolOutput`
 * runs `validateStandardSchema(outputSchema, structuredContent)` and skips
 * validation entirely when `isError === true`. A bare `z.array(...)` cannot
 * describe a top-level object. So we register ONE superset object schema:
 *   - single-target handler returns `{ met, color, ratio }`
 *   - multi-target handler returns `{ results: [...] }`
 * and both validate against this single schema (all fields optional).
 *
 * AC-9: the single-result fields `met`/`color`/`ratio` and the array variant
 * `results` are all present here.
 *
 * MCP-5 SHAPE NOTE (which fields are present for single vs multi):
 *   - SINGLE target  -> `{ met, color, ratio[, nearMiss] }`; `results` absent.
 *   - MULTI  targets -> `{ results: [ {met,color,ratio[,nearMiss]}, ... ] }`;
 *     the top-level `met`/`color`/`ratio`/`nearMiss` are absent.
 * All fields are optional here only because SDK 1.29 needs ONE superset object
 * schema to validate both shapes; the handler emits exactly one of the two.
 */
export const SolveForContrastOutputSchema = {
  // MCP-7: descriptions clarify these are the SINGLE-target fields.
  met: z
    .boolean()
    .optional()
    .describe('SINGLE-target: whether the target contrast was achievable'),
  color: z
    .string()
    .nullable()
    .optional()
    .describe('SINGLE-target: nearest-compliant foreground hex, or null when unreachable'),
  ratio: z
    .number()
    .nullable()
    .optional()
    .describe('SINGLE-target: achieved WCAG 2.1 ratio (display-rounded), or peak attainable when not met'),
  results: z
    .array(SolveResultSchema)
    .optional()
    .describe('MULTI-target: one result per requested target (present only for the `targets` path)'),
  // T-6 hardening: mirror nearMiss in the superset schema so MCP validateToolOutput
  // does not strip it from single-target results.
  nearMiss: z
    .boolean()
    .optional()
    .describe('SINGLE-target: present/true when met was granted via the near-ceiling tolerance'),
};
