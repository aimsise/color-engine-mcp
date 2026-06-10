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
  // B1/SEC-1: .max(256) bounds each color input BEFORE culori parsing (DoS defense).
  a: z
    .string()
    .max(256)
    .describe('First CSS color string, e.g. "#000000", "black", "oklch(0 0 0)" (max 256 chars)'),
  b: z
    .string()
    .max(256)
    .describe('Second CSS color string, e.g. "#ffffff", "white", "oklch(1 0 0)" (max 256 chars)'),
  apca: z
    .boolean()
    .optional()
    .describe(
      'When true, additionally compute the APCA-W3 (SAPC-4g) lightness contrast Lc for text `a` over background `b` (returned as `apcaLc`)'
    ),
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
  // MCP-7: concise output-field descriptions. The tier booleans derive from the
  // UNROUNDED raw ratio; `ratio` is only the 2-dp display value.
  ratio: z
    .number()
    .describe('2-decimal display value; tier flags derive from the unrounded raw ratio'),
  aaNormal: z.boolean().describe('Meets WCAG 2.1 AA for normal text (raw ratio >= 4.5)'),
  aaLarge: z.boolean().describe('Meets WCAG 2.1 AA for large text (raw ratio >= 3)'),
  aaaNormal: z.boolean().describe('Meets WCAG 2.1 AAA for normal text (raw ratio >= 7)'),
  aaaLarge: z.boolean().describe('Meets WCAG 2.1 AAA for large text (raw ratio >= 4.5)'),
  apcaLc: z
    .number()
    .optional()
    .describe(
      'Signed APCA-W3 (SAPC-4g) Lc for text `a` over background `b`, rounded to 2 decimals (positive = dark-on-light, negative = light-on-dark); present only when input `apca` is true'
    ),
};
