import * as z from 'zod/v4';

/**
 * Single source of truth for the `gamut_map` tool schemas. Imported by the tool
 * registration (`src/tools/gamut_map.ts`) AND the test suite so the registered
 * contract and the asserted contract never drift.
 *
 * Raw shapes (plain `{ field: z.xxx() }` objects, NOT wrapped in `z.object()`):
 * the MCP SDK `registerTool` auto-wraps them — matches the Part-2 convention.
 */
export const gamutMapInput = {
  input: z
    .string()
    .describe('Any CSS color string, e.g. "#ff0000", "oklch(0.6 0.4 30)"'),
};

/**
 * Output schema for the `gamut_map` tool.
 * - `hex`: lowercase #rrggbb of the gamut-mapped color
 * - `oklch`: raw (pre-rounding) OKLCH components of the mapped result
 * - `clamped`: true when the input was outside sRGB gamut and was mapped
 */
export const GamutMapOutputSchema = {
  hex: z.string(),
  oklch: z.object({
    l: z.number(),
    c: z.number(),
    h: z.number(),
  }),
  clamped: z.boolean(),
};
