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
 */
export const solveForContrastInput = {
  background: z
    .string()
    .describe('Background CSS color string, e.g. "#FFFFFF", "oklch(0.6 0.1 240)".'),
  target: z
    .number()
    .min(0)
    .optional()
    .describe('Single WCAG 2.1 contrast target (e.g. 4.5, 7). Use this OR `targets`.'),
  targets: z
    .array(z.number().min(0))
    .max(50)
    .optional()
    .describe('Multiple WCAG 2.1 contrast targets (max 50). Returns one result per target.'),
  prefer: z
    .enum(['lighter', 'darker', 'either'])
    .optional()
    .describe('Search direction relative to the background lightness. Default "either".'),
  hue: z
    .number()
    .optional()
    .describe('Fixed OKLCH hue (degrees) held constant during the lightness search.'),
  chroma: z
    .number()
    .min(0)
    .optional()
    .describe('Fixed OKLCH chroma (>= 0) held constant during the lightness search.'),
};

/**
 * One solved result item.
 * - `met`: whether the target contrast was achievable.
 * - `color`: the nearest-compliant foreground hex, or `null` when unreachable.
 * - `ratio`: the achieved WCAG 2.1 ratio (engine-rounded for display), or the
 *   peak attainable ratio when `met === false`; `null` only when the background
 *   itself could not be parsed.
 */
export const SolveResultSchema = z.object({
  met: z.boolean(),
  color: z.string().nullable(),
  ratio: z.number().nullable(),
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
 */
export const SolveForContrastOutputSchema = {
  met: z.boolean().optional(),
  color: z.string().nullable().optional(),
  ratio: z.number().nullable().optional(),
  results: z.array(SolveResultSchema).optional(),
};
