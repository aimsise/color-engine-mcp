import * as z from 'zod/v4';

/**
 * Single source of truth for the `parse_color` tool schemas. Imported by the tool
 * registration (`src/tools/parse_color.ts`) AND the test suite so the registered
 * contract and the asserted contract never drift.
 *
 * Raw shapes (plain `{ field: z.xxx() }` objects, NOT wrapped in `z.object()`):
 * the MCP SDK `registerTool` auto-wraps them — matches the part-1 convention.
 */
export const parseColorInput = {
  input: z
    .string()
    // B1/SEC-1: bound the input length BEFORE any culori parsing to defend
    // against unbounded-input DoS. A real CSS color is < ~64 chars.
    .max(256)
    .describe('CSS color string, e.g. "tomato", "#ff6347", "oklch(0.6 0.18 27)" (max 256 chars)'),
};

export const parseColorOutput = {
  // MCP-7: concise output-field descriptions.
  hex: z.string().describe('Lowercase #rrggbb sRGB-clamped hex of the parsed color'),
  // ALG-4/MCP-7: rgb channels are the sRGB-clamped 0-255 integer projection;
  // use `inGamut` to detect inputs that were outside the sRGB gamut.
  rgb: z
    .object({ r: z.number(), g: z.number(), b: z.number() })
    .describe('sRGB-clamped 0-255 integer channels; see inGamut'),
  oklch: z
    .object({
      l: z.number(),
      c: z.number(),
      h: z.number().describe('0 for achromatic'),
    })
    .describe('Raw (lossless) OKLCH components of the parsed color'),
  inGamut: z.boolean().describe('false when the input fell outside the sRGB gamut'),
};
