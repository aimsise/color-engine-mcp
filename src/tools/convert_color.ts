import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { convertColor, type ConvertTo } from '../lib/color/convert.js';
import { parseColor } from '../lib/color/parse.js';
import { convertColorInput, convertColorOutput } from '../schemas/convert_color.js';
import { validateColorComponents } from '../shared/validation.js';

/**
 * Black-box tool wrapper for `convert_color`. Delegates to the shared
 * `convertColor` boundary (which routes through `parseColor`, inheriting the
 * finite-value guard). Malformed (AC-7) and overflow (AC-8) inputs surface as
 * `{ isError: true }`; an unexpected throw is also caught — no uncaught exception.
 */
export function convertColorTool(input: string, to: ConvertTo): CallToolResult {
  try {
    // Shared finiteness/range guard BEFORE conversion (AC-6 belt-and-suspenders).
    // parseColor routes through the existing finite guard; we extract OKLCH components
    // and pass them through the shared boundary as well.
    const parsed = parseColor(input);
    if (!parsed.ok) {
      // parsed.error is now a full "<CODE>: msg" string — forward verbatim (uniform contract).
      return {
        content: [{ type: 'text', text: parsed.error }],
        isError: true,
      };
    }
    validateColorComponents({ l: parsed.oklch.l, c: parsed.oklch.c, h: parsed.oklch.h });

    const r = convertColor(input, to);
    if (!r.ok) {
      // r.error is now a full "<CODE>: msg" string — forward verbatim (uniform contract).
      return {
        content: [{ type: 'text', text: r.error }],
        isError: true,
      };
    }
    const structured = { result: r.result };
    return {
      content: [{ type: 'text', text: r.result }],
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

/** Register the `convert_color` tool (with input + output zod schemas — AC-6) on the server. */
export function registerConvertColor(server: McpServer): void {
  server.registerTool(
    'convert_color',
    {
      description:
        'Convert a CSS color string into a canonical hex, rgb, hsl, or oklch format string.',
      inputSchema: convertColorInput,
      outputSchema: convertColorOutput,
      // MCP-1: read-only, side-effect-free, deterministic, local-only computation.
      annotations: {
        title: 'Convert CSS Color',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ input, to }) => convertColorTool(input, to)
  );
}
