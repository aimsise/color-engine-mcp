import * as z from 'zod/v4';

/**
 * Single source of truth for the `generate_ramp` tool schemas. Imported by the
 * tool registration (`src/tools/generate_ramp.ts`) AND the test suite so the
 * registered contract and the asserted contract never drift.
 *
 * Raw shapes (plain `{ field: z.xxx() }` objects, NOT wrapped in `z.object()`):
 * the MCP SDK 1.29.0 `registerTool` auto-wraps them (`normalizeObjectSchema` →
 * `objectFromShape`) — matches the passing sibling pattern (`gamut_map.ts`).
 */
export const generateRampInput = {
  base: z
    .string()
    .describe('Any CSS color string, e.g. "#3b82f6", "oklch(0.6 0.35 30)"'),
  steps: z
    .number()
    .int()
    .optional()
    .describe('Number of swatches (2..512). Default 5.'),
  // Optional lightness controls (all optional; defaults applied in the lib).
  lightnessMin: z
    .number()
    .optional()
    .describe('Lower lightness endpoint (OKLCH L, 0..1). Default 0.05.'),
  lightnessMax: z
    .number()
    .optional()
    .describe('Upper lightness endpoint (OKLCH L, 0..1). Default 0.97.'),
  deltaL: z
    .number()
    .optional()
    .describe('Symmetric lightness span centered on the base L (overrides the fixed range).'),
};

/** WCAG tier reported per swatch (computed from the RAW pre-rounding ratio). */
const tierSchema = z.enum(['AAA', 'AA', 'FAIL']);

/** One swatch in a tint-to-shade ramp. */
export const swatchSchema = z.object({
  step: z.number(),
  hex: z.string(),
  oklch: z.object({
    l: z.number(),
    c: z.number(),
    h: z.number(),
  }),
  vsWhite: z.object({ ratio: z.number(), tier: tierSchema }),
  vsBlack: z.object({ ratio: z.number(), tier: tierSchema }),
  inGamut: z.boolean(),
});

/**
 * Array of swatches. AC-9 part (a) parses the LIVE tool output against THIS
 * schema (`swatchArraySchema.parse(result.structuredContent.swatches)`).
 */
export const swatchArraySchema = z.array(swatchSchema);

/**
 * Output schema for the `generate_ramp` tool — an OBJECT raw shape wrapping the
 * array in a `swatches` field.
 *
 * WHY THE WRAPPER (see plan Risk R1, confirmed against installed
 * `@modelcontextprotocol/sdk@1.29.0`): the MCP `structuredContent` returned by a
 * tool handler MUST be a top-level OBJECT — `validateToolOutput` runs
 * `safeParseAsync(normalizeObjectSchema(outputSchema), structuredContent)` and a
 * bare `z.array(...)` cannot describe a top-level object. So we register
 * `outputSchema: { swatches: swatchArraySchema }` (raw shape) and the handler
 * returns `structuredContent: { swatches: [...] }`. AC-9 still holds because the
 * test parses `swatchArraySchema.parse(result.structuredContent.swatches)`
 * against the array itself, not the wrapper object.
 */
export const GenerateRampOutputSchema = { swatches: swatchArraySchema };
