/**
 * tests/dos-input-bound.test.ts — TEST-5 / SEC-1 unbounded-input DoS bound.
 *
 * The B1/SEC-1 hardening adds a `MAX_INPUT_LENGTH = 256` guard at the very top of
 * `parseColor` (BEFORE `toRgb`), plus `.max(256)` on every color STRING schema
 * input. A real CSS color is < ~64 chars, so a megabyte-scale input is always a
 * DoS attempt and must be rejected in O(1)-ish time — the cap MUST precede the
 * culori tokenizer, which exhibits super-linear blow-up on pathological numeric
 * tokens (measured here: rgb() with 50k digits ≈ 2.2 s).
 *
 * The pathological vector is the one named in the SPEC: `rgb(` + a million `9`s
 * + `)` + a million `a`s (~2 MB).
 *
 * WHO SHORT-CIRCUITS (verified against the FINAL src, not assumed):
 *   - parse_color  : handler calls parseColor(input) first → INPUT_TOO_LONG.
 *   - convert_color: handler calls parseColor(input) first → INPUT_TOO_LONG.
 *   - contrast     : wcagContrastRaw(a,b) → parseColor(a) first → INPUT_TOO_LONG.
 *   - generate_ramp: lib generateRamp → parseColor(base) first → INPUT_TOO_LONG.
 *   - solve_for_contrast: an unparseable (here oversize) background now yields a
 *     typed isError (sanctioned change: PARSE_FAILED background / forwarded
 *     INPUT_TOO_LONG — no more silent met:false/color:null/ratio:null sentinel),
 *     still in O(1) time because the length cap precedes culori.
 *   - gamut_map   : SEC-1 — `gamutMapColor` now enforces the 256-char cap at its
 *     OWN top (typed GamutError INPUT_TOO_LONG), mirroring parseColor, so direct
 *     lib callers are capped too — the SDK schema `.max(256)` remains the
 *     protocol-boundary defense and is asserted separately below.
 *
 * All six paths resolve well under the 200 ms ceiling, proving the cap precedes
 * culori for the lib boundary every entry tool funnels through.
 */

import { describe, it, expect } from 'vitest';
import { parseColorTool } from '../src/tools/parse_color.js';
import { convertColorTool } from '../src/tools/convert_color.js';
import { contrastTool } from '../src/tools/contrast.js';
import { generateRampTool } from '../src/tools/generate_ramp.js';
import { solveTool } from '../src/tools/solve_for_contrast.js';
import { gamutMapInput } from '../src/schemas/gamut_map.js';

// The exact SPEC pathological vector: rgb( + 1e6 '9' + ) + 1e6 'a' (~2 MB).
const PATHOLOGICAL = 'rgb(' + '9'.repeat(1_000_000) + ')' + 'a'.repeat(1_000_000);

/** Generous-but-meaningful DoS ceiling: the cap is O(string length check), so even
 *  a 2 MB input must resolve far under this. 200 ms per the SPEC. */
const DOS_MS = 200;

/** Pull content[0].text from a CallToolResult. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(res: any): string {
  return res.content?.[0]?.type === 'text' ? res.content[0].text : '';
}

/** Time a synchronous handler call, returning [result, elapsedMs]. */
function timed<T>(fn: () => T): [T, number] {
  const t0 = performance.now();
  const r = fn();
  return [r, performance.now() - t0];
}

describe('TEST-5/SEC-1 — pathological 2 MB input is rejected QUICKLY (cap precedes culori)', () => {
  it('parse_color → isError INPUT_TOO_LONG in < 200 ms', () => {
    const [res, ms] = timed(() => parseColorTool(PATHOLOGICAL));
    expect(res.isError, 'parse_color must reject the oversize input').toBe(true);
    expect(textOf(res)).toBe('INPUT_TOO_LONG: color string exceeds 256 characters');
    expect(res.structuredContent, 'isError must not carry structuredContent').toBeUndefined();
    expect(ms, `parse_color took ${ms.toFixed(2)}ms (must be < ${DOS_MS})`).toBeLessThan(DOS_MS);
  });

  it('convert_color → isError INPUT_TOO_LONG in < 200 ms', () => {
    const [res, ms] = timed(() => convertColorTool(PATHOLOGICAL, 'hex'));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe('INPUT_TOO_LONG: color string exceeds 256 characters');
    expect(res.structuredContent).toBeUndefined();
    expect(ms, `convert_color took ${ms.toFixed(2)}ms (must be < ${DOS_MS})`).toBeLessThan(DOS_MS);
  });

  it('contrast → isError INPUT_TOO_LONG in < 200 ms (oversize on either side)', () => {
    // Oversize `a` (first parse) and oversize `b` (second parse) both short-circuit.
    const [resA, msA] = timed(() => contrastTool(PATHOLOGICAL, '#ffffff'));
    expect(resA.isError).toBe(true);
    expect(textOf(resA)).toBe('INPUT_TOO_LONG: color string exceeds 256 characters');
    expect(resA.structuredContent).toBeUndefined();
    expect(msA, `contrast(a) took ${msA.toFixed(2)}ms`).toBeLessThan(DOS_MS);

    const [resB, msB] = timed(() => contrastTool('#ffffff', PATHOLOGICAL));
    expect(resB.isError).toBe(true);
    expect(textOf(resB)).toBe('INPUT_TOO_LONG: color string exceeds 256 characters');
    expect(msB, `contrast(b) took ${msB.toFixed(2)}ms`).toBeLessThan(DOS_MS);
  });

  it('generate_ramp → isError INPUT_TOO_LONG in < 200 ms', () => {
    const [res, ms] = timed(() => generateRampTool({ base: PATHOLOGICAL, steps: 5 }));
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe('INPUT_TOO_LONG: color string exceeds 256 characters');
    expect(res.structuredContent).toBeUndefined();
    expect(ms, `generate_ramp took ${ms.toFixed(2)}ms (must be < ${DOS_MS})`).toBeLessThan(DOS_MS);
  });

  it('solve_for_contrast → typed isError for the oversize background in < 200 ms, no throw', () => {
    // Sanctioned contract change: an unparseable background is now a typed isError
    // (PARSE_FAILED background message, or the forwarded INPUT_TOO_LONG code for an
    // oversize string) instead of the old silent { met:false, color:null, ratio:null }
    // sentinel. Either way it resolves in O(1) time: the parseColor length cap fires
    // BEFORE culori ever tokenizes the 2 MB string.
    let res: ReturnType<typeof solveTool> | undefined;
    let ms = NaN;
    expect(() => {
      const t = timed(() => solveTool({ background: PATHOLOGICAL, target: 4.5 }));
      res = t[0];
      ms = t[1];
    }).not.toThrow();
    expect(res).toBeDefined();
    if (!res) return;
    expect(res.isError, 'oversize background must be a typed isError').toBe(true);
    expect(res.structuredContent, 'isError must not carry structuredContent').toBeUndefined();
    expect(textOf(res)).toMatch(/^(INPUT_TOO_LONG|PARSE_FAILED): /);
    expect(ms, `solve_for_contrast took ${ms.toFixed(2)}ms (must be < ${DOS_MS})`).toBeLessThan(DOS_MS);
  });
});

describe('TEST-5/SEC-1 — gamut_map oversize-input defense', () => {
  // Protocol boundary: the SDK schema `.max(256)` rejects the 2 MB string BEFORE
  // the handler (and culori) ever runs in real MCP traffic.
  it('schema .max(256) rejects the 2 MB input at the protocol boundary, instantly', () => {
    const [parsed, ms] = timed(() => gamutMapInput.input.safeParse(PATHOLOGICAL));
    expect(parsed.success, 'gamut_map input schema must reject the oversize string').toBe(false);
    expect(ms, `schema validation took ${ms.toFixed(2)}ms`).toBeLessThan(DOS_MS);

    // A length-256 input is the boundary the schema admits (a real color fits easily).
    expect(gamutMapInput.input.safeParse('a'.repeat(256)).success).toBe(true);
    expect(gamutMapInput.input.safeParse('a'.repeat(257)).success).toBe(false);
  });

  // SEC-1: the lib function itself now enforces the cap — direct callers that
  // bypass the SDK schema are bounded too, with the typed GamutError contract.
  it('gamutMapColor(100k-char string) throws typed GamutError INPUT_TOO_LONG in < 200 ms', () => {
    return import('../src/lib/color/gamut.js').then(({ gamutMapColor, GamutError }) => {
      const big = '9'.repeat(100_000);
      let caught: unknown;
      const [, ms] = timed(() => {
        try {
          gamutMapColor(big);
        } catch (e) {
          caught = e;
        }
      });
      expect(caught, 'oversize input must throw').toBeDefined();
      expect(caught).toBeInstanceOf(GamutError);
      expect((caught as Error).message).toBe(
        'INPUT_TOO_LONG: color string exceeds 256 characters'
      );
      expect(ms, `gamutMapColor took ${ms.toFixed(2)}ms (must be < ${DOS_MS})`).toBeLessThan(
        DOS_MS
      );
    });
  });

  it('gamut_map handler returns a clean isError INPUT_TOO_LONG (never throws) for an over-limit input', () => {
    // Defense-in-depth: the handler inherits the lib-level cap (SEC-1), so even an
    // over-limit string that bypassed the SDK schema yields the typed isError — no
    // throw, no structuredContent.
    const overLimitGarbage = 'z'.repeat(300);
    // Lazy import keeps the heavy culori path out of the fast-bound suite above.
    return import('../src/tools/gamut_map.js').then(({ gamutMapTool }) => {
      let res: ReturnType<typeof gamutMapTool> | undefined;
      expect(() => {
        res = gamutMapTool(overLimitGarbage);
      }).not.toThrow();
      expect(res).toBeDefined();
      if (!res) return;
      expect(res.isError).toBe(true);
      expect(res.structuredContent).toBeUndefined();
      // Uniform "<CODE>: msg" contract — now the typed SEC-1 cap, fast-failing.
      expect(textOf(res)).toBe('INPUT_TOO_LONG: color string exceeds 256 characters');
    });
  });
});
