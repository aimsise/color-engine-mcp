import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseColor } from '../lib/color/parse.js';
import { parseColorInput, parseColorOutput } from '../schemas/parse_color.js';
import { validateColorComponents } from '../shared/validation.js';

/**
 * Black-box tool wrapper for `parse_color`. Delegates to the shared `parseColor`
 * boundary (no direct culori converter calls — sibling-guard) and maps the
 * `{ ok }` discriminated union onto a `CallToolResult`. Every failure path —
 * parse error, finite-value-guard rejection, or an unexpected throw — returns
 * `{ isError: true }` so the process never exits and no rejection escapes (AC-4).
 */
export function parseColorTool(input: string): CallToolResult {
  try {
    const r = parseColor(input);
    if (!r.ok) {
      // r.error is now a full "<CODE>: msg" string (INPUT_TOO_LONG / PARSE_FAILED /
      // NON_FINITE_COMPONENTS) — forward verbatim, no extra prefix (uniform error contract).
      return {
        content: [{ type: 'text', text: r.error }],
        isError: true,
      };
    }
    // Shared finiteness/range guard — additive over parseColor's own finite guard.
    validateColorComponents({ l: r.oklch.l, c: r.oklch.c, h: r.oklch.h });
    const structured = { hex: r.hex, rgb: r.rgb, oklch: r.oklch, inGamut: r.inGamut };
    return {
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
    };
  } catch {
    // Static, sanitized code-keyed message — never forward internal error detail
    // (path, stack, library internals) to the caller (uniform catch-all).
    return {
      content: [{ type: 'text', text: 'INTERNAL_ERROR: unexpected internal error' }],
      isError: true,
    };
  }
}

/** Register the `parse_color` tool (with input + output zod schemas — AC-6) on the server. */
export function registerParseColor(server: McpServer): void {
  server.registerTool(
    'parse_color',
    {
      description: 'Parse a CSS color string and return hex, rgb, oklch, and gamut info.',
      inputSchema: parseColorInput,
      outputSchema: parseColorOutput,
      // MCP-1: read-only, side-effect-free, deterministic, local-only computation.
      annotations: {
        title: 'Parse CSS Color',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ input }) => parseColorTool(input)
  );
}
