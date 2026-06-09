import '../init.js'; // side-effect: register culori modes (MUST be first import)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { solveForContrast, type SolveArgs, type SolveOutput } from '../lib/color/solve.js';
import { solveForContrastInput, SolveForContrastOutputSchema } from '../schemas/solve_for_contrast.js';
import { validateColorComponents } from '../shared/validation.js';

/**
 * Pure tool wrapper for the `solve_for_contrast` computation. Delegates to
 * `src/lib/color/solve.ts` exclusively — MUST NOT import culori OKLCH/RGB
 * converters directly (preserves the sibling-guard; the test greps this file
 * for the forbidden culori converter tokens and asserts they are absent).
 *
 * Success: returns `structuredContent` — a top-level OBJECT as MCP SDK 1.29.0
 *   `validateToolOutput` requires (single: `{met,color,ratio}`; multi: `{results:[...]}`),
 *   both validating against the superset `SolveForContrastOutputSchema`.
 * Error:   returns `isError: true` with code-keyed `content[0].text` and NEVER
 *   `structuredContent` (the SDK skips output validation on isError).
 *
 * NO network I/O and NO filesystem writes in this handler.
 */
export function solveTool(args: SolveArgs): CallToolResult {
  try {
    // --- Minimal input validation (malformed → isError:true, AC-10) ---
    if (
      args == null ||
      typeof args.background !== 'string' ||
      args.background.length === 0
    ) {
      return {
        content: [{ type: 'text', text: 'SolveError: MISSING_BACKGROUND' }],
        isError: true,
      };
    }

    const hasTargets = Array.isArray(args.targets);
    const hasTarget = typeof args.target === 'number';
    if (!hasTargets && !hasTarget) {
      return {
        content: [{ type: 'text', text: 'SolveError: MISSING_TARGET' }],
        isError: true,
      };
    }

    // Bound the `targets` array (DoS / CPU-amplification hardening; mirrors the
    // schema `.max(50)` for direct-handler callers that bypass SDK validation).
    if (hasTargets && (args.targets as number[]).length > 50) {
      return {
        content: [{ type: 'text', text: 'SolveError: TOO_MANY_TARGETS' }],
        isError: true,
      };
    }

    // Reject non-finite / negative numeric targets (AC-10 `target:-1`).
    const targetList: number[] = hasTargets ? (args.targets as number[]) : [args.target as number];
    for (const t of targetList) {
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
        return {
          content: [{ type: 'text', text: 'SolveError: INVALID_TARGET' }],
          isError: true,
        };
      }
    }

    // Reject invalid chroma at the boundary (mirrors schema `.min(0)`; negative
    // chroma is physically meaningless in OKLCH). Direct-handler callers bypass
    // SDK schema validation, so guard here too — clean isError, never a throw.
    if (args.chroma != null && (typeof args.chroma !== 'number' || !Number.isFinite(args.chroma) || args.chroma < 0)) {
      return {
        content: [{ type: 'text', text: 'SolveError: INVALID_CHROMA' }],
        isError: true,
      };
    }

    // T-7 hardening: reject non-finite hue (mirrors INVALID_CHROMA above).
    // A non-finite hue is physically meaningless in OKLCH — guard before solve.
    if (args.hue != null && (typeof args.hue !== 'number' || !Number.isFinite(args.hue))) {
      return {
        content: [{ type: 'text', text: 'SolveError: INVALID_HUE' }],
        isError: true,
      };
    }

    // Shared finiteness/range guard (AC-6 belt-and-suspenders). Additive over the
    // per-field guards above — intercepts the parse-accepted-then-overflows class.
    validateColorComponents({
      hue: args.hue,
      chroma: args.chroma,
    });

    const result: SolveOutput = solveForContrast(args);

    // The solver is total; `structuredContent` is already a top-level object.
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  } catch {
    // Mask unexpected internals so nothing leaks across the MCP boundary: use a
    // FIXED code-keyed string, never the raw `e.message` (which could embed
    // input-derived text from a future library throw — info-disclosure channel).
    // T4/T5 code-keyed-error convention. The solver is total, so this is a
    // defence-in-depth path that should not be reachable in practice.
    return {
      content: [{ type: 'text', text: 'SolveError: INTERNAL_ERROR' }],
      isError: true,
    };
  }
}

/** Register the `solve_for_contrast` tool (with input + output zod schemas — AC-9) on the server. */
export function registerSolveForContrast(server: McpServer): void {
  server.registerTool(
    'solve_for_contrast',
    {
      description:
        'Find a foreground color that meets one or more WCAG 2.1 contrast targets against a background. Binary-searches OKLCH lightness (holding hue/chroma fixed) and returns the nearest-compliant hex plus the achieved ratio. Pass `target` for one target or `targets` for several; `prefer` selects lighter/darker/either; `hue`/`chroma` pin the foreground chromaticity.',
      inputSchema: solveForContrastInput,
      outputSchema: SolveForContrastOutputSchema,
    },
    async (args) => solveTool(args as SolveArgs)
  );
}
