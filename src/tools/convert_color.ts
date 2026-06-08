import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { convertColor, type ConvertTo } from '../lib/color/convert.js';
import { convertColorInput, convertColorOutput } from '../schemas/convert_color.js';

/**
 * Black-box tool wrapper for `convert_color`. Delegates to the shared
 * `convertColor` boundary (which routes through `parseColor`, inheriting the
 * finite-value guard). Malformed (AC-7) and overflow (AC-8) inputs surface as
 * `{ isError: true }`; an unexpected throw is also caught — no uncaught exception.
 */
export function convertColorTool(input: string, to: ConvertTo): CallToolResult {
  try {
    const r = convertColor(input, to);
    if (!r.ok) {
      return {
        content: [{ type: 'text', text: `Error: ${r.error}` }],
        isError: true,
      };
    }
    const structured = { result: r.result };
    return {
      content: [{ type: 'text', text: r.result }],
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

/** Register the `convert_color` tool (with input + output zod schemas — AC-6) on the server. */
export function registerConvertColor(server: McpServer): void {
  server.registerTool(
    'convert_color',
    {
      description:
        'Convert a CSS color string into a canonical hex, rgb, hsl, or oklch format string.',
      inputSchema: convertColorInput,
      outputSchema: convertColorOutput,
    },
    async ({ input, to }) => convertColorTool(input, to)
  );
}
