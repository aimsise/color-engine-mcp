import * as z from 'zod/v4';

/**
 * Single source of truth for the `contrast` tool schemas. Imported by the tool
 * registration (`src/tools/contrast.ts`) AND the test suite so the registered
 * contract and the asserted contract never drift.
 *
 * Raw shapes (plain `{ field: z.xxx() }` objects, NOT wrapped in `z.object()`):
 * the MCP SDK `registerTool` auto-wraps them — matches the Part-2 convention.
 */
export const contrastInput = {
  a: z.string().describe('First CSS color string, e.g. "#000000", "black", "oklch(0 0 0)"'),
  b: z.string().describe('Second CSS color string, e.g. "#ffffff", "white", "oklch(1 0 0)"'),
};

/**
 * WCAG tier flags shape — re-usable by Part 5 (generate_ramp) and Part 6
 * (solve_for_contrast) which will call `wcagTiers` directly.
 */
export const WcagTiersSchema = {
  aaNormal: z.boolean(),
  aaLarge: z.boolean(),
  aaaNormal: z.boolean(),
  aaaLarge: z.boolean(),
};

/**
 * Full output schema for the `contrast` tool. `ratio` is the 2-dp display value;
 * tier flags are derived from the raw pre-rounding ratio inside `wcagTiers`.
 */
export const ContrastOutputSchema = {
  ratio: z.number(),
  aaNormal: z.boolean(),
  aaLarge: z.boolean(),
  aaaNormal: z.boolean(),
  aaaLarge: z.boolean(),
};
