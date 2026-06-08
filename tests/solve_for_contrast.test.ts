/**
 * tests/solve_for_contrast.test.ts — AC suite for the solve_for_contrast MCP tool (T-006).
 *
 * ANTI-CIRCULARITY (Gate 7): every numeric band assertion (AC-1/2/3) re-measures
 * the SOLVED color's WCAG 2.1 ratio with the INDEPENDENT colorjs.io oracle
 * (`oracleWcagContrast`) on the RAW pre-rounding float — NEVER the engine's own
 * 2-decimal `ratio` field. The engine uses culori `wcagContrast`; the oracle uses
 * colorjs.io `Color.contrast(..., 'WCAG21')`. Two independent implementations,
 * both traceable to WCAG 2.1 §1.4.3.
 *
 * The EC-PROPERTY monotonicity invariant (search foundation) is verified
 * independently of the solver via raw culori primitives.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatHex, converter } from 'culori/fn';
import { toOklch } from '../src/init.js'; // side-effect import registers culori rgb/oklch modes
import { mapToSRGB } from '../src/lib/color/gamut.js';
import { wcagContrastRaw } from '../src/utils/contrast.js';
import { solveTool } from '../src/tools/solve_for_contrast.js';
import { solveForContrast, type SolveResultSingle } from '../src/lib/color/solve.js';
import { oracleWcagContrast } from './helpers/oracle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Independently derived OKLCH lightness of a CSS color (for AC-7 reference). */
function bgLightness(css: string): number {
  const o = toOklch(css);
  return o?.l ?? NaN;
}

/** Extract the single-result structuredContent from a tool result. */
function asSingle(sc: unknown): SolveResultSingle {
  return sc as SolveResultSingle;
}

/** Smallest absolute angular difference between two hues, accounting for wrap. */
function hueDelta(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}

/**
 * INDEPENDENT oracle: the maximum in-gamut OKLCH chroma at a FIXED lightness/hue,
 * found by binary search on the raw sRGB boundary via culori's `converter('rgb')`
 * (NOT the solver). Used by AC-6 (3b) to prove the solved chroma is the gamut-forced
 * ceiling, not an arbitrary reduction.
 */
function maxInGamutChroma(l: number, h: number): number {
  const toRgb = converter('rgb');
  const eps = 1e-9;
  const inGamut = (c: number): boolean => {
    const r = toRgb({ mode: 'oklch', l, c, h });
    return (
      r.r >= -eps && r.r <= 1 + eps && r.g >= -eps && r.g <= 1 + eps && r.b >= -eps && r.b <= 1 + eps
    );
  };
  let lo = 0;
  let hi = 0.5; // OKLCH chroma well above the sRGB ceiling
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// EC-PROPERTY — monotonicity invariant (the search's foundation)
// ---------------------------------------------------------------------------

describe('EC-PROPERTY — contrast is strictly monotonic in OKLCH lightness', () => {
  it('sweep l 0.05→0.95 (c=0.1, h=270) vs white: STRICTLY decreasing over ADJACENT pairs', () => {
    const ls: number[] = [];
    for (let l = 0.05; l <= 0.951; l += 0.05) ls.push(Math.round(l * 100) / 100);

    const ratios = ls.map((l) =>
      wcagContrastRaw(formatHex(mapToSRGB({ mode: 'oklch', l, c: 0.1, h: 270 })), '#FFFFFF')
    );

    for (let i = 1; i < ratios.length; i++) {
      expect(
        ratios[i],
        `ratio at l=${ls[i]} (${ratios[i]}) must be < ratio at l=${ls[i - 1]} (${ratios[i - 1]})`
      ).toBeLessThan(ratios[i - 1]);
    }
  });

  it('sweep l 0.05→0.95 (c=0.1, h=270) vs black: STRICTLY increasing over ADJACENT pairs', () => {
    const ls: number[] = [];
    for (let l = 0.05; l <= 0.951; l += 0.05) ls.push(Math.round(l * 100) / 100);

    const ratios = ls.map((l) =>
      wcagContrastRaw(formatHex(mapToSRGB({ mode: 'oklch', l, c: 0.1, h: 270 })), '#000000')
    );

    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i], `ratio at l=${ls[i]} must be > ratio at l=${ls[i - 1]}`).toBeGreaterThan(
        ratios[i - 1]
      );
    }
  });
});

// ---------------------------------------------------------------------------
// AC-1 — Solve vs white, target 4.5, darker (computational, Gate 7)
// ---------------------------------------------------------------------------

describe('AC-1 — background #FFFFFF, target 4.5, prefer darker', () => {
  it('met===true and colorjs.io RAW ratio in [4.5, 4.7] (nearest-compliant)', () => {
    const res = solveTool({ background: '#FFFFFF', target: 4.5, prefer: 'darker' });
    expect(res.isError).toBeUndefined();
    const r = asSingle(res.structuredContent);
    expect(r.met).toBe(true);
    expect(r.color).toBeTypeOf('string');

    // Anti-circularity: independent colorjs.io re-measurement on the RAW float.
    const raw = oracleWcagContrast(r.color as string, '#FFFFFF');
    expect(raw, `raw colorjs.io ratio = ${raw}`).toBeGreaterThanOrEqual(4.5);
    expect(raw, `raw colorjs.io ratio = ${raw}`).toBeLessThanOrEqual(4.7);
  });
});

// ---------------------------------------------------------------------------
// AC-2 — Solve vs black, target 7, lighter (computational, Gate 7)
// ---------------------------------------------------------------------------

describe('AC-2 — background #000000, target 7, prefer lighter', () => {
  it('met===true and colorjs.io RAW ratio in [7.0, 7.25]', () => {
    const res = solveTool({ background: '#000000', target: 7, prefer: 'lighter' });
    expect(res.isError).toBeUndefined();
    const r = asSingle(res.structuredContent);
    expect(r.met).toBe(true);

    const raw = oracleWcagContrast(r.color as string, '#000000');
    expect(raw, `raw = ${raw}`).toBeGreaterThanOrEqual(7.0);
    expect(raw, `raw = ${raw}`).toBeLessThanOrEqual(7.25);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — multi-target array (computational, Gate 7)
// ---------------------------------------------------------------------------

describe('AC-3 — background #FFFFFF, targets [3, 4.5, 7]', () => {
  const targets = [3, 4.5, 7];

  it('returns exactly 3 results, each met===true and colorjs.io RAW >= targets[i]', () => {
    const res = solveTool({ background: '#FFFFFF', targets });
    expect(res.isError).toBeUndefined();
    const sc = res.structuredContent as { results: SolveResultSingle[] };
    expect(Array.isArray(sc.results)).toBe(true);
    expect(sc.results).toHaveLength(3);

    sc.results.forEach((r, i) => {
      expect(r.met, `result[${i}].met`).toBe(true);
      const raw = oracleWcagContrast(r.color as string, '#FFFFFF');
      expect(raw, `result[${i}] raw=${raw} >= ${targets[i]}`).toBeGreaterThanOrEqual(targets[i]);
    });
  });
});

// ---------------------------------------------------------------------------
// AC-4 — unreachable target → met:false, no throw, not isError
// ---------------------------------------------------------------------------

describe('AC-4 — background #FFFFFF, target 22 (ceiling 21)', () => {
  it('structured met===false, does NOT throw, NOT isError:true', () => {
    let res: ReturnType<typeof solveTool> | undefined;
    expect(() => {
      res = solveTool({ background: '#FFFFFF', target: 22 });
    }).not.toThrow();
    expect(res).toBeDefined();
    if (!res) return;
    expect(res.isError).not.toBe(true);
    const r = asSingle(res.structuredContent);
    expect(r.met).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — NaN-hue achromatic background guard
// ---------------------------------------------------------------------------

describe('AC-5 — background #808080 (achromatic, NaN hue), target 4.5, either', () => {
  it('no NaN in search; returned OKLCH l finite in [0,1]; defaults hue 0 when achromatic', () => {
    // Confirm the genuine NaN-hue path is exercised.
    expect(Number.isFinite(toOklch('#808080')?.h as number)).toBe(false);

    const res = solveTool({ background: '#808080', target: 4.5, prefer: 'either' });
    expect(res.isError).toBeUndefined();
    const r = asSingle(res.structuredContent);
    expect(r.met).toBe(true);
    expect(r.color).toBeTypeOf('string');

    const o = toOklch(r.color as string);
    expect(o).toBeDefined();
    const l = o?.l as number;
    expect(Number.isFinite(l)).toBe(true);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-6 — fixed hue/chroma overrides respected; search only the L axis
// ---------------------------------------------------------------------------

// AC-6 NOTE (T-006): the ticket's literal "chroma within ±0.01 of 0.15" is PHYSICALLY
// INFEASIBLE in sRGB — no in-gamut color at hue 240°±2°, chroma 0.15±0.01 reaches 4.5:1
// vs white (max achievable in that band = 4.047; exact 0.15 → 3.417). Independently proven
// by two opus agents (see eval-round-1.md). The solver is correct: it holds hue EXACT (240),
// meets contrast (met=true), and produces the max in-gamut chroma (~0.13) at the compliant
// lightness. This test verifies that FEASIBLE intent (hue-fixed, L-axis search, chroma is the
// gamut-clamped projection of the requested 0.15). The ticket AC-6 chroma tolerance is a
// ticket-authoring defect flagged for follow-up (T-007 / AC amendment).
describe('AC-6 — #FFFFFF, target 4.5, darker, hue:240, chroma:0.15', () => {
  it('met===true; hue held EXACT (±2° of 240); chroma is the sRGB-gamut-clamped projection of 0.15', () => {
    const res = solveTool({
      background: '#FFFFFF',
      target: 4.5,
      prefer: 'darker',
      hue: 240,
      chroma: 0.15,
    });
    expect(res.isError).toBeUndefined();
    const r = asSingle(res.structuredContent);

    // (1) Contrast target met (unchanged).
    expect(r.met).toBe(true);

    const o = toOklch(r.color as string)!;
    const h = o.h ?? 0;
    const c = o.c ?? 0;

    // (2) Hue override honored EXACT: solved hue within ±2° of 240 (solver holds it fixed).
    expect(hueDelta(h, 240), `hue ${h} vs 240, delta=${hueDelta(h, 240)}`).toBeLessThanOrEqual(2);

    // (3) Chroma is the sRGB-gamut-clamped projection of the requested 0.15:
    //   - it NEVER EXCEEDS the requested 0.15 (the override is an upper bound, not amplified), and
    //   - it is strictly > 0 (the chroma override was honored as the search input, not zeroed to grey).
    // The infeasible `|c − 0.15| ≤ 0.01` assertion is intentionally REPLACED here — see AC-6 NOTE
    // above and eval-round-1.md for the two-agent infeasibility proof.
    expect(c, `chroma ${c} must not exceed requested 0.15 (gamut-clamped, not amplified)`).toBeLessThanOrEqual(0.15 + 1e-6);
    expect(c, `chroma ${c} must be > 0 (override honored, not zeroed to grey)`).toBeGreaterThan(0);

    // (3b) Confirm the reduction is GAMUT-FORCED, not arbitrary: at the solved hue/lightness,
    // the TRUE maximum in-gamut chroma — computed by an INDEPENDENT culori binary search on the
    // raw sRGB boundary (not via the solver) — equals the solved chroma. If 0.15 were already
    // in-gamut at this l/h the ceiling would be ≥0.15; because it is not, the gamut ceiling
    // (≈0.129) is exactly the chroma the solver returned, proving the reduction is forced by the
    // sRGB boundary rather than chosen arbitrarily.
    const l = o.l as number;
    const maxInGamut = maxInGamutChroma(l, 240);
    expect(maxInGamut, `at l=${l}, h=240 the requested 0.15 must be OUT of sRGB gamut`).toBeLessThan(
      0.15
    );
    // 2-decimal precision: the solved chroma agrees with the raw sRGB ceiling to ~0.0006,
    // i.e. it IS the gamut boundary (any residual is the solver's small in-gamut tolerance
    // epsilon, not an arbitrary value). 3-decimal would over-assert on that epsilon.
    expect(c, `solved chroma ${c} should equal the sRGB gamut ceiling ${maxInGamut} at l=${l}, h=240`).toBeCloseTo(
      maxInGamut,
      2
    );
  });
});

// ---------------------------------------------------------------------------
// AC-7 — prefer direction semantics (background #777777)
// ---------------------------------------------------------------------------

describe('AC-7 — background #777777, target 4.5: direction semantics', () => {
  const bg = '#777777';
  const bgL = bgLightness(bg); // independently derived (≈0.5693), NOT hard-coded.

  it('prefer lighter → solved l > bgL', () => {
    const res = solveTool({ background: bg, target: 4.5, prefer: 'lighter' });
    const r = asSingle(res.structuredContent);
    expect(r.met).toBe(true);
    const l = toOklch(r.color as string)?.l as number;
    expect(l, `solved l=${l} should be > bgL=${bgL}`).toBeGreaterThan(bgL);
  });

  it('prefer darker → solved l < bgL', () => {
    const res = solveTool({ background: bg, target: 4.5, prefer: 'darker' });
    const r = asSingle(res.structuredContent);
    expect(r.met).toBe(true);
    const l = toOklch(r.color as string)?.l as number;
    expect(l, `solved l=${l} should be < bgL=${bgL}`).toBeLessThan(bgL);
  });

  it('prefer either → l finite in [0,1] and met===true', () => {
    const res = solveTool({ background: bg, target: 4.5, prefer: 'either' });
    const r = asSingle(res.structuredContent);
    expect(r.met).toBe(true);
    const l = toOklch(r.color as string)?.l as number;
    expect(Number.isFinite(l)).toBe(true);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (round-2 Critical) — prefer:"either" must NEVER ship a sub-target
// color as met:true when EITHER direction can genuinely reach the target.
//
// Root cause of the round-2 defect: the `either` tie-break compared the round2'd
// DISPLAY ratio against the target, so a near-miss RAW 2.998 → round2 3.00 was
// falsely flagged "strict compliant" and returned instead of a genuinely
// compliant color on the other side. These tests re-measure the RETURNED color
// with the INDEPENDENT colorjs.io oracle on the RAW pre-rounding float and assert
// raw >= target whenever any direction can reach it. They FAIL against round-2.
// ---------------------------------------------------------------------------

describe('REGRESSION — prefer:"either" returns the genuinely-compliant side (raw >= target)', () => {
  // The two exact repros from the round-2 skeptical pass (standard WCAG AA-Large 3.0).
  it('#595959 target 3 either → returned color colorjs.io RAW >= 3.0', () => {
    const res = solveTool({ background: '#595959', target: 3, prefer: 'either' });
    expect(res.isError).toBeUndefined();
    const r = asSingle(res.structuredContent);
    expect(r.met, 'met must be true (a compliant lighter #aaaaaa at raw ~3.015 exists)').toBe(true);
    const raw = oracleWcagContrast(r.color as string, '#595959');
    expect(raw, `returned ${r.color} raw=${raw} must be >= 3.0`).toBeGreaterThanOrEqual(3.0);
  });

  it('#959595 target 3 either → returned color colorjs.io RAW >= 3.0', () => {
    const res = solveTool({ background: '#959595', target: 3, prefer: 'either' });
    expect(res.isError).toBeUndefined();
    const r = asSingle(res.structuredContent);
    expect(r.met, 'met must be true (a compliant darker #494949 at raw ~3.006 exists)').toBe(true);
    const raw = oracleWcagContrast(r.color as string, '#959595');
    expect(raw, `returned ${r.color} raw=${raw} must be >= 3.0`).toBeGreaterThanOrEqual(3.0);
  });

  // Broad sweep: for every mid-grey background × target, whenever EITHER single
  // direction can strictly reach the target (independently confirmed by probing
  // both extremes black/white with the colorjs.io oracle), the `either` result's
  // RAW ratio MUST also be >= target. This is the invariant the Critical violated.
  it('mid-grey sweep × {3,4.5,7}: when either direction is reachable, either-result raw >= target', () => {
    const greys: string[] = [];
    for (let v = 0x40; v <= 0xc0; v += 0x08) {
      const h = v.toString(16).padStart(2, '0');
      greys.push(`#${h}${h}${h}`);
    }
    const targets = [3, 4.5, 7];
    let asserted = 0;

    for (const bg of greys) {
      for (const target of targets) {
        // Independent reachability check: the maximum contrast a darker color can
        // reach is black-vs-bg; the maximum a lighter color can reach is white-vs-bg.
        const darkCeil = oracleWcagContrast('#000000', bg);
        const lightCeil = oracleWcagContrast('#ffffff', bg);
        const reachable = darkCeil >= target || lightCeil >= target;
        if (!reachable) continue;

        const res = solveTool({ background: bg, target, prefer: 'either' });
        const r = asSingle(res.structuredContent);
        const raw = oracleWcagContrast(r.color as string, bg);
        expect(
          raw,
          `bg=${bg} target=${target}: either returned ${r.color} raw=${raw} but a compliant ` +
            `color was reachable (darkCeil=${darkCeil}, lightCeil=${lightCeil})`
        ).toBeGreaterThanOrEqual(target);
        expect(r.met, `bg=${bg} target=${target}: met must be true when reachable`).toBe(true);
        asserted++;
      }
    }
    // Guard the loop actually exercised reachable cases (not a vacuous pass).
    expect(asserted, 'sweep must assert at least a dozen reachable cases').toBeGreaterThan(12);
  });
});

// ---------------------------------------------------------------------------
// AC-8 — adversarial parse-accepted overflow (Infinity chroma)
// ---------------------------------------------------------------------------

describe('AC-8 — background oklch(0.5 1e400 30) (Infinity chroma)', () => {
  it(
    'no hang, ≤2s, structured met:false OR isError:true; guard at parseColor boundary',
    { timeout: 2000 },
    () => {
      let res: ReturnType<typeof solveTool> | undefined;
      expect(() => {
        res = solveTool({ background: 'oklch(0.5 1e400 30)', target: 4.5, prefer: 'either' });
      }).not.toThrow();
      expect(res).toBeDefined();
      if (!res) return;

      const isErr = res.isError === true;
      const metFalse =
        !isErr && asSingle(res.structuredContent)?.met === false;
      expect(
        isErr || metFalse,
        `expected isError:true OR met:false, got ${JSON.stringify(res)}`
      ).toBe(true);
    }
  );

  it('parseColor rejects 1e400 at the shared boundary (defence confirmed)', async () => {
    const { parseColor } = await import('../src/lib/color/parse.js');
    expect(parseColor('oklch(0.5 1e400 30)').ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-9 — outputSchema declared (structural, EC-STATIC)
// ---------------------------------------------------------------------------

describe('AC-9 — outputSchema declared in registerTool', () => {
  it('src/tools/solve_for_contrast.ts contains "outputSchema" in registerTool block', () => {
    const src = readFileSync(join(repoRoot, 'src/tools/solve_for_contrast.ts'), 'utf-8');
    expect(src).toContain('outputSchema');
    expect(src).toContain('registerTool');
    const registerIdx = src.indexOf('registerTool');
    const outputSchemaIdx = src.indexOf('outputSchema');
    expect(outputSchemaIdx).toBeGreaterThan(registerIdx);
  });

  it('output schema includes met(bool), color(string nullable), ratio(number nullable) + array variant', async () => {
    const { SolveForContrastOutputSchema, SolveResultSchema } = await import(
      '../src/schemas/solve_for_contrast.js'
    );
    // Single-result fields present.
    expect(SolveForContrastOutputSchema.met).toBeDefined();
    expect(SolveForContrastOutputSchema.color).toBeDefined();
    expect(SolveForContrastOutputSchema.ratio).toBeDefined();
    // Array variant present.
    expect(SolveForContrastOutputSchema.results).toBeDefined();

    // SolveResultSchema validates a single result object (not an empty z.object({})).
    const parsed = SolveResultSchema.safeParse({ met: true, color: '#123456', ratio: 4.5 });
    expect(parsed.success).toBe(true);
    // Nullable color/ratio accepted.
    expect(SolveResultSchema.safeParse({ met: false, color: null, ratio: null }).success).toBe(true);

    // A live single result validates against the superset output object schema.
    const single = solveForContrast({ background: '#FFFFFF', target: 4.5, prefer: 'darker' });
    const superset = (await import('zod/v4')).object(SolveForContrastOutputSchema);
    expect(superset.safeParse(single).success).toBe(true);
    // A live multi result validates too.
    const multi = solveForContrast({ background: '#FFFFFF', targets: [3, 4.5] });
    expect(superset.safeParse(multi).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-10 — no-throw MCP boundary for malformed inputs
// ---------------------------------------------------------------------------

describe('AC-10 — malformed inputs: isError:true OR structured met:false, no throw', () => {
  const cases: Array<{ name: string; args: unknown }> = [
    { name: '{} (missing background)', args: {} },
    { name: 'not-a-color', args: { background: 'not-a-color', target: 4.5 } },
    { name: 'negative target', args: { background: '#fff', target: -1 } },
  ];

  for (const { name, args } of cases) {
    it(`${name} → no throw, isError:true OR met:false`, () => {
      let res: ReturnType<typeof solveTool> | undefined;
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res = solveTool(args as any);
      }).not.toThrow();
      expect(res).toBeDefined();
      if (!res) return;

      const isErr = res.isError === true;
      const metFalse = !isErr && asSingle(res.structuredContent)?.met === false;
      expect(isErr || metFalse, `got ${JSON.stringify(res)}`).toBe(true);
      // isError responses must not carry structuredContent.
      if (isErr) expect(res.structuredContent).toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// Sibling-guard — no toRgb/toOklch in the tool file
// ---------------------------------------------------------------------------

describe('sibling-guard — src/tools/solve_for_contrast.ts has no culori converters', () => {
  it('no toRgb / toOklch tokens in the tool file', () => {
    const src = readFileSync(join(repoRoot, 'src/tools/solve_for_contrast.ts'), 'utf-8');
    expect(src).not.toMatch(/\btoRgb\b/);
    expect(src).not.toMatch(/\btoOklch\b/);
  });
});
