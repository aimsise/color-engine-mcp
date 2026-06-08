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
    .describe('CSS color string, e.g. "tomato", "#ff6347", "oklch(0.6 0.18 27)"'),
};

export const parseColorOutput = {
  hex: z.string(),
  rgb: z.object({ r: z.number(), g: z.number(), b: z.number() }),
  oklch: z.object({ l: z.number(), c: z.number(), h: z.number() }),
  inGamut: z.boolean(),
};
