import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { wcagContrastRaw, wcagTiers, ContrastError, type WcagTiers } from '../utils/contrast.js';
import { apcaLc } from '../utils/apca.js';
import { parseColor } from '../lib/color/parse.js';
import { contrastInput, ContrastOutputSchema } from '../schemas/contrast.js';
import { validateColorComponents } from '../shared/validation.js';

/** Structured success payload: 5-field WCAG contract + optional APCA Lc. */
type ContrastStructured = WcagTiers & { ratio: number; apcaLc?: number };

/**
 * Magnitude guard on parse-ACCEPTED components (belt-and-suspenders). parseColor
 * already rejects non-finite values, so any throw from the shared validator here
 * means a finite-but-absurd magnitude — surfaced as the typed
 * COMPONENT_OUT_OF_RANGE code instead of the old INTERNAL_ERROR mask. An upstream
 * COMPONENT_OUT_OF_RANGE message is forwarded verbatim (still fully static text).
 */
function guardComponentMagnitude(oklch: { l: number; c: number; h: number }): void {
  try {
    validateColorComponents({ l: oklch.l, c: oklch.c, h: oklch.h });
  } catch (e) {
    throw new ContrastError(
      e instanceof Error && e.message.startsWith('COMPONENT_OUT_OF_RANGE')
        ? e.message
        : 'COMPONENT_OUT_OF_RANGE: color component magnitude exceeds the supported range'
    );
  }
}

/**
 * Pure tool wrapper for the WCAG 2.1 `contrast` computation. Delegates to
 * `src/utils/contrast.ts` / `src/utils/apca.ts` helpers exclusively — MUST NOT
 * import culori converters directly (preserves the sibling-guard; DoD verifies
 * the tools/ dir is clean).
 *
 * Success: returns `structuredContent` with the 5-field contract (+ `apcaLc`
 *          when the optional `apca` input is true).
 * Error:   returns `isError: true` — NEVER includes `structuredContent` (AC-7).
 *          Translucent inputs (alpha < 1) are rejected with ALPHA_UNSUPPORTED;
 *          parse failures name the offending parameter (foreground checked first).
 */
export function contrastTool(a: string, b: string, apca?: boolean): CallToolResult {
  try {
    // Shared finiteness/range guard on both input colors (AC-6 belt-and-suspenders).
    // wcagContrastRaw already routes through parseColor; this is additive.
    const pa = parseColor(a);
    if (pa.ok) guardComponentMagnitude(pa.oklch);
    const pb = parseColor(b);
    if (pb.ok) guardComponentMagnitude(pb.oklch);

    const raw = wcagContrastRaw(a, b);
    const tiers = wcagTiers(raw); // Tiers from RAW — before any rounding
    const ratio = Math.round(raw * 100) / 100; // Display value computed AFTER tiers
    const structured: ContrastStructured = { ratio, ...tiers };
    if (apca === true && pa.ok && pb.ok) {
      // Signed APCA-W3 Lc for text `a` over background `b`, display-rounded to
      // 2 dp. `+ 0` normalizes a potential -0 from rounding a tiny negative Lc.
      // WCAG tier flags above remain derived from the RAW pre-rounding ratio.
      structured.apcaLc = Math.round(apcaLc(pa.hex, pb.hex) * 100) / 100 + 0;
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
    };
  } catch (e) {
    // ContrastError.message is a full "<CODE>: msg" string (e.g. PARSE_FAILED,
    // ALPHA_UNSUPPORTED, COMPONENT_OUT_OF_RANGE, NON_FINITE_COMPONENTS,
    // NON_FINITE_LUMINANCE) — forward verbatim. Any other throw is masked to the
    // uniform catch-all (no internal detail leaks).
    return {
      content: [
        {
          type: 'text',
          text: e instanceof ContrastError ? e.message : 'INTERNAL_ERROR: unexpected internal error',
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
        'Compute the WCAG 2.1 contrast ratio between two fully opaque CSS color strings and return WCAG tier flags (AA/AAA normal/large text). Set apca:true to also get the signed APCA-W3 Lc for text `a` over background `b`.',
      inputSchema: contrastInput,
      outputSchema: ContrastOutputSchema,
      // MCP-1: read-only, side-effect-free, deterministic, local-only computation.
      annotations: {
        title: 'WCAG Contrast Ratio',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async ({ a, b, apca }) => contrastTool(a, b, apca)
  );
}
