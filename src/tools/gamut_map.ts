import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { gamutMapColor, GamutError } from '../lib/color/gamut.js';
import { parseColor } from '../lib/color/parse.js';
import { gamutMapInput, GamutMapOutputSchema } from '../schemas/gamut_map.js';
import { validateColorComponents } from '../shared/validation.js';

/**
 * Pure tool wrapper for the `gamut_map` computation. Delegates to
 * `src/lib/color/gamut.ts` exclusively — MUST NOT import culori converters
 * directly (preserves the sibling-guard; DoD verifies the tools/ dir is clean).
 *
 * Success: returns `structuredContent` with the 3-field contract.
 * Error:   returns `isError: true` — NEVER includes `structuredContent` (mirrors AC-7 of contrast tool).
 */
export function gamutMapTool(input: string): CallToolResult {
  try {
    // Shared finiteness/range guard BEFORE gamutMapColor (AC-6 belt-and-suspenders).
    // parseColor has its own finite guard; this is ADDITIVE — the shared boundary
    // intercepts oklch(0.5 1e400 30) before any computation.
    const preCheck = parseColor(input);
    if (preCheck.ok) {
      validateColorComponents({ l: preCheck.oklch.l, c: preCheck.oklch.c, h: preCheck.oklch.h });
    }
    // gamutMapColor runs its own assertFiniteOklch + MAX_FINITE_CHROMA guard;
    // if parseColor returned ok:false, gamutMapColor will also throw GamutError PARSE_FAILED.
    const r = gamutMapColor(input);
    return {
      content: [{ type: 'text', text: JSON.stringify(r) }],
      structuredContent: r,
    };
  } catch (e) {
    // Sanitize: do not reflect raw user input into the error response.
    // GamutError messages are code-keyed (PARSE_FAILED, NULL_OKLCH_CHANNELS,
    // NON_FINITE_OKLCH_COMPONENTS, NON_FINITE_OKLCH_HUE, CHROMA_OUT_OF_RANGE,
    // GAMUT_MAP_COLLAPSE). Unknown errors are masked to prevent accidental PII /
    // internal detail leakage.
    const errText =
      e instanceof GamutError
        ? `GamutError: ${e.message}`
        : 'GamutError: INTERNAL_ERROR';
    return {
      content: [{ type: 'text', text: errText }],
      isError: true,
    };
  }
}

/** Register the `gamut_map` tool (with input + output zod schemas — AC-6) on the server. */
export function registerGamutMap(server: McpServer): void {
  server.registerTool(
    'gamut_map',
    {
      description:
        'Map any CSS color string into the sRGB gamut via perceptual OKLCH chroma reduction. Returns the nearest in-gamut hex, raw OKLCH components, and a `clamped` flag indicating whether the input was out-of-gamut.',
      inputSchema: gamutMapInput,
      outputSchema: GamutMapOutputSchema,
    },
    async ({ input }) => gamutMapTool(input)
  );
}
