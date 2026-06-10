import * as z from 'zod/v4';

/**
 * Single source of truth for the `convert_color` tool schemas. Imported by the
 * tool registration (`src/tools/convert_color.ts`) AND the test suite.
 *
 * Raw shapes (plain objects, auto-wrapped by the MCP SDK `registerTool`).
 */
export const convertColorInput = {
  // B1/SEC-1: .max(256) bounds the input BEFORE culori parsing (DoS defense).
  input: z
    .string()
    .max(256)
    .describe('CSS color string to convert, e.g. "#ff0000", "tomato" (max 256 chars)'),
  to: z
    .enum(['hex', 'rgb', 'hsl', 'oklch'])
    .describe('Target color format to convert the input into'),
};

export const convertColorOutput = {
  // ALG-5: for out-of-gamut inputs, `oklch` output is RAW (lossless) while
  // hex/rgb/hsl are the sRGB-clamped projection (rgb channels are 0-255 ints).
  result: z
    .string()
    .describe(
      'The input color formatted in the requested target format (oklch is raw/lossless; hex/rgb/hsl are sRGB-clamped for out-of-gamut inputs)',
    ),
};
