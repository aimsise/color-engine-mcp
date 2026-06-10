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
  // B1/SEC-1: .max(256) bounds the base color BEFORE culori parsing (DoS defense).
  base: z
    .string()
    .max(256)
    .describe('Any CSS color string, e.g. "#3b82f6", "oklch(0.6 0.35 30)" (max 256 chars)'),
  // MCP-4: declare the numeric constraints in the schema so out-of-range steps
  // are rejected at the boundary. Default 5 applied here (matches the lib default).
  steps: z
    .number()
    .int()
    .min(2)
    .max(512)
    .default(5)
    .describe('Number of swatches (integer 2..512). Default 5.'),
  // Optional lightness controls (all optional; defaults applied in the lib).
  // MCP-4: .finite() rejects NaN/Infinity and .min(0).max(1) bounds OKLCH L at
  // the schema boundary; the lib still validates lightnessMin < lightnessMax.
  lightnessMin: z
    .number()
    .finite()
    .min(0)
    .max(1)
    .optional()
    .describe('Lower lightness endpoint (OKLCH L, 0..1). Default 0.05.'),
  lightnessMax: z
    .number()
    .finite()
    .min(0)
    .max(1)
    .optional()
    .describe('Upper lightness endpoint (OKLCH L, 0..1). Default 0.97.'),
  // MCP-4: deltaL must be a finite number strictly > 0 (the lib also enforces this).
  // DOC-2: deltaL is the TOTAL lightness span — the ramp is centered on the base L
  // with endpoints at base L ± deltaL/2, NOT base L ± deltaL.
  deltaL: z
    .number()
    .finite()
    .gt(0)
    .optional()
    .describe(
      'Total lightness span (> 0) centered on the base L — endpoints at base L ± deltaL/2 (overrides the fixed range).'
    ),
  // TOKENS: optional design-token emission. When tokenFormat is present the
  // output additionally contains a `tokens` string.
  tokenFormat: z
    .enum(['tailwind', 'css-variables'])
    .optional()
    .describe(
      'Optional design-token format for the ramp ("tailwind" JSON object or a "css-variables" :root block); when present the output includes a `tokens` string.'
    ),
  // Token base name: 1-64 chars, must start with a letter, then letters/digits/
  // hyphens (case-insensitive). Rejects spaces/braces so the name embeds safely
  // in a CSS custom-property name or a JSON key.
  tokenName: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/i)
    .optional()
    .describe(
      'Base name for emitted tokens (letters/digits/hyphens, must start with a letter, 1-64 chars). Default "color".'
    ),
};

/** WCAG tier reported per swatch (computed from the RAW pre-rounding ratio). */
const tierSchema = z.enum(['AAA', 'AA', 'FAIL']);

/** One swatch in a tint-to-shade ramp. MCP-7: concise per-field descriptions. */
export const swatchSchema = z.object({
  step: z.number().describe('Zero-based swatch index (0 is the lightest end)'),
  hex: z.string().describe('Lowercase #rrggbb sRGB-clamped hex of the swatch'),
  // ALG-7: this is the requested-L / clampChroma projection, which can differ
  // slightly (~ deltaL 0.013) from the exact OKLCH of `hex` — a deliberate
  // choice to preserve strict L monotonicity across the ramp.
  // OUT-1: display-rounded like the sibling tools (l/c 5dp, h 2dp).
  oklch: z
    .object({
      l: z.number().describe('OKLCH lightness, display-rounded to 5 decimal places'),
      c: z.number().describe('OKLCH chroma, display-rounded to 5 decimal places'),
      h: z.number().describe('OKLCH hue in degrees, display-rounded to 2 decimal places'),
    })
    .describe(
      'Requested-L / clampChroma OKLCH projection, display-rounded (l/c 5dp, h 2dp; may differ slightly from hex; preserves L monotonicity)'
    ),
  vsWhite: z
    .object({
      ratio: z
        .number()
        .describe('WCAG ratio vs white (2-decimal display value; tier derives from the unrounded raw ratio)'),
      tier: tierSchema.describe('WCAG tier (AAA/AA/FAIL) of ratio vs white'),
    })
    .describe('WCAG contrast of this swatch against white'),
  vsBlack: z
    .object({
      ratio: z
        .number()
        .describe('WCAG ratio vs black (2-decimal display value; tier derives from the unrounded raw ratio)'),
      tier: tierSchema.describe('WCAG tier (AAA/AA/FAIL) of ratio vs black'),
    })
    .describe('WCAG contrast of this swatch against black'),
  inGamut: z.boolean().describe('false when the swatch fell outside the sRGB gamut'),
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
 *
 * TOKENS: `tokens` is OPTIONAL — present only when the request supplied
 * `tokenFormat` (the SDK output validation accepts its absence).
 */
export const GenerateRampOutputSchema = {
  swatches: swatchArraySchema,
  tokens: z
    .string()
    .optional()
    .describe(
      'Design-token string for the ramp (pretty-printed Tailwind JSON or a :root CSS-variables block); present only when tokenFormat was supplied'
    ),
};
