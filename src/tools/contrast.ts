import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { wcagContrastRaw, wcagTiers, ContrastError } from '../utils/contrast.js';
import { contrastInput, ContrastOutputSchema } from '../schemas/contrast.js';

/**
 * Pure tool wrapper for the WCAG 2.1 `contrast` computation. Delegates to
 * `src/utils/contrast.ts` helpers exclusively — MUST NOT import culori converters
 * directly (preserves the sibling-guard; DoD verifies the tools/ dir is clean).
 *
 * Success: returns `structuredContent` with the 5-field contract.
 * Error:   returns `isError: true` — NEVER includes `structuredContent` (AC-7).
 */
export function contrastTool(a: string, b: string): CallToolResult {
  try {
    const raw = wcagContrastRaw(a, b);
    const tiers = wcagTiers(raw); // Tiers from RAW — before any rounding
    const ratio = Math.round(raw * 100) / 100; // Display value computed AFTER tiers
    const structured = { ratio, ...tiers };
    return {
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
    };
  } catch (e) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${e instanceof ContrastError ? e.message : 'unexpected internal error'}`,
        },
      ],
      isError: true,
    };
  }
}

/** Register the `contrast` tool (with input + output zod schemas — AC-7) on the server. */
export function registerContrast(server: McpServer): void {
  server.registerTool(
    'contrast',
    {
      description:
        'Compute the WCAG 2.1 contrast ratio between two CSS color strings and return WCAG tier flags (AA/AAA normal/large text).',
      inputSchema: contrastInput,
      outputSchema: ContrastOutputSchema,
    },
    async ({ a, b }) => contrastTool(a, b)
  );
}
