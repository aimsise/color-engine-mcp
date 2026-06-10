import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  generateRamp,
  formatRampTokens,
  DEFAULT_TOKEN_NAME,
  type TokenFormat,
  type RampSwatch,
} from '../lib/color/ramp.js';
import { parseColor } from '../lib/color/parse.js';
import { GamutError } from '../lib/color/gamut.js';
import { ContrastError } from '../utils/contrast.js';
import { generateRampInput, GenerateRampOutputSchema } from '../schemas/generate_ramp.js';
import { validateColorComponents } from '../shared/validation.js';

/** Arguments for the `generate_ramp` tool (mirrors `generateRampInput`). */
export interface GenerateRampArgs {
  base: string;
  steps?: number;
  lightnessMin?: number;
  lightnessMax?: number;
  deltaL?: number;
  /** Optional design-token output format; when present the result includes `tokens`. */
  tokenFormat?: TokenFormat;
  /** Token base name (validated by the schema regex). Default "color". */
  tokenName?: string;
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
    // Shared finiteness/range guard on base color + lightness overrides (AC-6).
    // parseColor has its own finite guard; this is ADDITIVE. Schema .finite() rejects
    // lightnessMin/Max/deltaL non-finite values at input boundary (T-5 hardening).
    const preCheck = parseColor(args.base);
    if (preCheck.ok) {
      validateColorComponents({ l: preCheck.oklch.l, c: preCheck.oklch.c, h: preCheck.oklch.h });
    }
    validateColorComponents({
      lightnessMin: args.lightnessMin,
      lightnessMax: args.lightnessMax,
      deltaL: args.deltaL,
    });

    const r = generateRamp(args.base, args.steps ?? 5, {
      lightnessMin: args.lightnessMin,
      lightnessMax: args.lightnessMax,
      deltaL: args.deltaL,
    });
    if (!r.ok) {
      // r.error is now a full "<CODE>: msg" string (STEPS_OUT_OF_RANGE,
      // INVALID_DELTA_L, INVALID_LIGHTNESS_RANGE, BASE_CHROMA_OUT_OF_RANGE,
      // PARSE_FAILED, INPUT_TOO_LONG, INTERNAL_ERROR, ...) — forward verbatim.
      return {
        content: [{ type: 'text', text: r.error }],
        isError: true,
      };
    }
    // Object-shaped structuredContent (wrap the array — see schema R1 comment).
    // TOKENS: `tokens` is added ONLY when the request asked for a tokenFormat
    // (the output schema declares it optional). tokenName falls back to the
    // documented default "color"; its shape is enforced by the schema regex at
    // the MCP boundary.
    const payload: { swatches: RampSwatch[]; tokens?: string } = { swatches: r.swatches };
    if (args.tokenFormat) {
      payload.tokens = formatRampTokens(
        r.swatches,
        args.tokenFormat,
        args.tokenName ?? DEFAULT_TOKEN_NAME
      );
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  } catch (e) {
    // SEC-2: do NOT forward arbitrary e.message (a future library throw could embed
    // input-derived text — info-disclosure channel). generateRamp is TOTAL and
    // wraps its swatch loop, so this path is defence-in-depth. Forward e.message
    // ONLY for known domain errors (GamutError/ContrastError, whose message is
    // already a vetted "<CODE>: msg" code string); otherwise the uniform catch-all.
    const errText =
      e instanceof GamutError || e instanceof ContrastError
        ? e.message
        : 'INTERNAL_ERROR: unexpected internal error';
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
        'Generate a tint-to-shade color ramp from a base CSS color. Returns an ordered list of swatches (light → dark) each with its in-gamut hex, display-rounded OKLCH components (l/c 5dp, h 2dp), WCAG contrast ratios (2dp) + tiers vs white and black, and an in-gamut flag. Optionally emits the ramp as design tokens via tokenFormat ("tailwind" JSON or a "css-variables" :root block).',
      inputSchema: generateRampInput,
      outputSchema: GenerateRampOutputSchema,
      // MCP-1: read-only, side-effect-free, deterministic, local-only computation.
      annotations: {
        title: 'Generate Color Ramp',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async (args) => generateRampTool(args as GenerateRampArgs)
  );
}
