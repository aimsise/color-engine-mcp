import * as z from 'zod/v4';

/**
 * Single source of truth for the `convert_color` tool schemas. Imported by the
 * tool registration (`src/tools/convert_color.ts`) AND the test suite.
 *
 * Raw shapes (plain objects, auto-wrapped by the MCP SDK `registerTool`).
 */
export const convertColorInput = {
  input: z.string().describe('CSS color string to convert, e.g. "#ff0000", "tomato"'),
  to: z
    .enum(['hex', 'rgb', 'hsl', 'oklch'])
    .describe('Target color format to convert the input into'),
};

export const convertColorOutput = {
  result: z.string().describe('The input color formatted in the requested target format'),
};
