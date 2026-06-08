import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { generateRamp } from '../lib/color/ramp.js';
import { generateRampInput, GenerateRampOutputSchema } from '../schemas/generate_ramp.js';

/** Arguments for the `generate_ramp` tool (mirrors `generateRampInput`). */
export interface GenerateRampArgs {
  base: string;
  steps?: number;
  lightnessMin?: number;
  lightnessMax?: number;
  deltaL?: number;
}

/**
 * Pure tool wrapper for the `generate_ramp` computation. Delegates to
 * `src/lib/color/ramp.ts` exclusively — MUST NOT import culori OKLCH/RGB
 * converters directly (preserves the sibling-guard; the test greps
 * src/tools/generate_ramp.ts for the forbidden converter tokens).
 *
 * Success: returns `structuredContent: { swatches: [...] }` — a top-level OBJECT
 *   as the MCP SDK 1.29.0 `validateToolOutput` requires (see schema R1 comment).
 * Error:   returns `isError: true` with a non-empty `content[0].text` and NEVER
 *   includes `structuredContent` (the SDK skips output validation on isError).
 *
 * NO network I/O and NO filesystem writes in this handler (AC-10).
 */
export function generateRampTool(args: GenerateRampArgs): CallToolResult {
  try {
    const r = generateRamp(args.base, args.steps ?? 5, {
      lightnessMin: args.lightnessMin,
      lightnessMax: args.lightnessMax,
      deltaL: args.deltaL,
    });
    if (!r.ok) {
      return {
        content: [{ type: 'text', text: `RampError: ${r.error}` }],
        isError: true,
      };
    }
    // Object-shaped structuredContent (wrap the array — see schema R1 comment).
    const payload = { swatches: r.swatches };
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  } catch (e) {
    // Mask unexpected internals so nothing leaks across the MCP boundary.
    const errText =
      e instanceof Error ? `RampError: ${e.message}` : 'RampError: INTERNAL_ERROR';
    return {
      content: [{ type: 'text', text: errText }],
      isError: true,
    };
  }
}

/** Register the `generate_ramp` tool (with input + output zod schemas — AC-9) on the server. */
export function registerGenerateRamp(server: McpServer): void {
  server.registerTool(
    'generate_ramp',
    {
      description:
        'Generate a tint-to-shade color ramp from a base CSS color. Returns an ordered list of swatches (light → dark) each with its in-gamut hex, raw OKLCH components, WCAG contrast ratios + tiers vs white and black, and an in-gamut flag.',
      inputSchema: generateRampInput,
      outputSchema: GenerateRampOutputSchema,
    },
    async (args) => generateRampTool(args as GenerateRampArgs)
  );
}
