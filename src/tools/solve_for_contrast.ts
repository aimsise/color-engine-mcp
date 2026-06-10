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
        content: [{ type: 'text', text: 'MISSING_BACKGROUND: background color string is required' }],
        isError: true,
      };
    }

    const hasTargets = Array.isArray(args.targets);
    const hasTarget = typeof args.target === 'number';
    if (!hasTargets && !hasTarget) {
      return {
        content: [{ type: 'text', text: 'MISSING_TARGET: provide target or targets' }],
        isError: true,
      };
    }

    // Mirror the schema `.min(1)` (SOLVE-2) for direct-handler callers: an empty
    // `targets` array is rejected at the protocol layer by the SDK, but a direct
    // call would otherwise yield a useless `{ results: [] }`.
    if (hasTargets && (args.targets as number[]).length === 0) {
      return {
        content: [{ type: 'text', text: 'EMPTY_TARGETS: targets must contain at least one target' }],
        isError: true,
      };
    }

    // Bound the `targets` array (DoS / CPU-amplification hardening; mirrors the
    // schema `.max(50)` for direct-handler callers that bypass SDK validation).
    if (hasTargets && (args.targets as number[]).length > 50) {
      return {
        content: [{ type: 'text', text: 'TOO_MANY_TARGETS: at most 50 targets are allowed' }],
        isError: true,
      };
    }

    // Reject non-finite / negative numeric targets (AC-10 `target:-1`).
    const targetList: number[] = hasTargets ? (args.targets as number[]) : [args.target as number];
    for (const t of targetList) {
      if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) {
        return {
          content: [{ type: 'text', text: 'INVALID_TARGET: each target must be a finite number >= 0' }],
          isError: true,
        };
      }
    }

    // Reject invalid chroma at the boundary (mirrors schema `.min(0)`; negative
    // chroma is physically meaningless in OKLCH). Direct-handler callers bypass
    // SDK schema validation, so guard here too — clean isError, never a throw.
    if (args.chroma != null && (typeof args.chroma !== 'number' || !Number.isFinite(args.chroma) || args.chroma < 0)) {
      return {
        content: [{ type: 'text', text: 'INVALID_CHROMA: chroma must be a finite number >= 0' }],
        isError: true,
      };
    }

    // T-7 hardening: reject non-finite hue (mirrors INVALID_CHROMA above).
    // A non-finite hue is physically meaningless in OKLCH — guard before solve.
    if (args.hue != null && (typeof args.hue !== 'number' || !Number.isFinite(args.hue))) {
      return {
        content: [{ type: 'text', text: 'INVALID_HUE: hue must be a finite number' }],
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

    // SOLVE-1 / CE-3: the lib signals boundary failures with a DISCRIMINATED
    // `{ error: code }` return (never the old silent met:false/color:null/
    // ratio:null sentinel, which falsely told callers the target was
    // unreachable). Map each code to its static, code-keyed message — applies
    // identically to the single-target and the `targets` paths, because the lib
    // resolves the background ONCE before either path branches.
    if ('error' in result) {
      const text =
        result.error === 'ALPHA_UNSUPPORTED'
          ? // CE-3: identical wording to the contrast tool.
            'ALPHA_UNSUPPORTED: contrast requires fully opaque colors (alpha = 1); composite the color over its backdrop first'
          : result.error === 'INVALID_GEOMETRY'
            ? // Unreachable via this tool (hue/chroma validated above); kept for
              // exhaustiveness over the lib's typed codes.
              'INVALID_GEOMETRY: hue and chroma must be finite numbers (chroma >= 0)'
            : 'PARSE_FAILED: could not parse the background color';
      return {
        content: [{ type: 'text', text }],
        isError: true,
      };
    }

    // The solver is total; `structuredContent` is already a top-level object.
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  } catch {
    // Mask unexpected internals so nothing leaks across the MCP boundary: use a
    // FIXED code-keyed string, never the raw `e.message` (which could embed
    // input-derived text from a future library throw — info-disclosure channel).
    // Uniform catch-all. The solver is total, so this is a defence-in-depth path
    // that should not be reachable in practice.
    return {
      content: [{ type: 'text', text: 'INTERNAL_ERROR: unexpected internal error' }],
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
        'Find a foreground color that meets one or more WCAG 2.1 contrast targets against a background. Binary-searches OKLCH lightness (holding hue/chroma fixed) and returns the nearest-compliant hex plus the achieved ratio. Pass `target` for one target or `targets` for several; `prefer` selects lighter/darker/either; `hue`/`chroma` pin the foreground chromaticity. ' +
        // MCP-3: target/targets precedence. MCP-5: single-vs-multi response shape.
        'If BOTH `target` and `targets` are provided, `targets` takes precedence. The response shape differs by mode: a single `target` returns `{ met, color, ratio }` (with an optional `nearMiss` flag); `targets` returns `{ results: [{ met, color, ratio, nearMiss? }, ...] }`. The output schema is an all-optional superset of both shapes (SDK 1.29 single-shape limitation). ' +
        // SOLVE-1 / CE-3: surface the typed error contract to LLM consumers.
        'An unparseable background returns the PARSE_FAILED error; a translucent background (alpha < 1, e.g. rgba()/hsla()/#rgba/#rrggbbaa) returns ALPHA_UNSUPPORTED — composite it over its backdrop first.',
      inputSchema: solveForContrastInput,
      outputSchema: SolveForContrastOutputSchema,
      // MCP-1: read-only, side-effect-free, deterministic, local-only computation.
      annotations: {
        title: 'Solve for Contrast Target',
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
        destructiveHint: false,
      },
    },
    async (args) => solveTool(args as SolveArgs)
  );
}
