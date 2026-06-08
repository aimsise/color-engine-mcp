import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { parseColor } from '../lib/color/parse.js';
import { parseColorInput, parseColorOutput } from '../schemas/parse_color.js';

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
      return {
        content: [{ type: 'text', text: `Error: ${r.error}` }],
        isError: true,
      };
    }
    const structured = { hex: r.hex, rgb: r.rgb, oklch: r.oklch, inGamut: r.inGamut };
    return {
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
    };
  } catch {
    // Static, sanitized message — never forward internal error detail (path,
    // stack, library internals) to the caller.
    return {
      content: [{ type: 'text', text: 'unexpected internal error' }],
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
    },
    async ({ input }) => parseColorTool(input)
  );
}
