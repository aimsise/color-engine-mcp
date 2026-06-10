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
  // B1/SEC-1: .max(256) bounds the input BEFORE culori parsing (DoS defense).
  input: z
    .string()
    .max(256)
    .describe('Any CSS color string, e.g. "#ff0000", "oklch(0.6 0.4 30)" (max 256 chars)'),
};

/**
 * Output schema for the `gamut_map` tool.
 * - `hex`: lowercase #rrggbb of the gamut-mapped color
 * - `oklch`: raw (pre-rounding) OKLCH components of the mapped result
 * - `clamped`: true when the input was outside sRGB gamut and was mapped
 */
export const GamutMapOutputSchema = {
  // MCP-7: concise output-field descriptions.
  hex: z.string().describe('Lowercase #rrggbb of the gamut-mapped (in-sRGB) color'),
  oklch: z
    .object({
      l: z.number(),
      c: z.number(),
      h: z.number(),
    })
    .describe('Raw (pre-rounding) OKLCH components of the mapped result'),
  clamped: z
    .boolean()
    .describe('true when input was out-of-sRGB-gamut and was mapped'),
};
