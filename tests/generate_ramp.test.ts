/**
 * tests/generate_ramp.test.ts — two-oracle harness for the generate_ramp MCP tool (T-005).
 *
 * ORACLE 1 (culori — implementation under test):
 *   generateRampTool / generateRamp from src/, plus culori `differenceEuclidean('oklch')`
 *   and `inGamut('rgb')` for raw OKLCH property checks.
 *
 * ORACLE 2 (colorjs.io 0.6.1 — INDEPENDENT implementation):
 *   - WCAG-2.1 contrast: `Color.contrast(_, 'WCAG21')`           → AC-1 cross-check
 *   - ΔE2000: `new Color(hex).deltaE(new Color(base), '2000')`   → AC-4 cross-check
 *
 * ANTI-CIRCULARITY (Gate-7 / R4): every numeric tolerance asserts on the engine's
 * RAW pre-rounding value vs the INDEPENDENT oracle — never the engine's own field
 * re-measured. Monotonicity / gamut-membership use raw floats.
 *
 * The AC-9 schema parse runs against the LIVE tool output (R1), not a hand fixture.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inGamut, differenceEuclidean } from 'culori/fn';
import { toOklch } from '../src/init.js';
import { generateRampTool } from '../src/tools/generate_ramp.js';
import { generateRamp } from '../src/lib/color/ramp.js';
import { swatchArraySchema } from '../src/schemas/generate_ramp.js';
import { oracleWcagContrast, oracleDeltaE2000 } from './helpers/oracle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const inRgbGamut = inGamut('rgb');
const deltaEOklch = differenceEuclidean('oklch');

/** Pull the structured `swatches` array out of a successful tool result. */
function swatchesOf(result: ReturnType<typeof generateRampTool>): unknown[] {
  const sc = result.structuredContent as { swatches?: unknown[] } | undefined;
  return sc?.swatches ?? [];
}

/** Typed swatch shape for assertions on raw fields. */
type Swatch = {
  step: number;
  hex: string;
  oklch: { l: number; c: number; h: number };
  vsWhite: { ratio: number; tier: string };
  vsBlack: { ratio: number; tier: string };
  inGamut: boolean;
};

/** Reference tier rule (independent of the implementation's `toRampTier`). */
function refTier(ratio: number): 'AAA' | 'AA' | 'FAIL' {
  return ratio >= 7.0 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'FAIL';
}

// ---------------------------------------------------------------------------
// AC-1 — count, monotonic lightness, in-gamut, contrast fields, oracle cross-check
// ---------------------------------------------------------------------------

describe('AC-1 — steps:7 ramp shape, gamut, contrast fields + WCAG oracle', () => {
  const result = generateRampTool({ base: '#3b82f6', steps: 7 });
  const swatches = swatchesOf(result) as Swatch[];

  it('returns exactly 7 swatches with no error', () => {
    expect(result.isError).toBeUndefined();
    expect(swatches).toHaveLength(7);
  });

  it('raw oklch.l is STRICTLY monotonically decreasing on unrounded floats', () => {
    for (let i = 0; i < swatches.length - 1; i++) {
      expect(
        swatches[i].oklch.l,
        `l[${i}]=${swatches[i].oklch.l} must exceed l[${i + 1}]=${swatches[i + 1].oklch.l}`
      ).toBeGreaterThan(swatches[i + 1].oklch.l);
    }
  });

  it('every swatch is inGamut===true (raw inGamut("rgb") on the hex agrees)', () => {
    for (const sw of swatches) {
      expect(sw.inGamut, `${sw.hex} reported inGamut`).toBe(true);
      expect(inRgbGamut(sw.hex), `${sw.hex} actually in sRGB`).toBe(true);
    }
  });

  it('vsWhite/vsBlack ratios are finite numbers; tiers ∈ {AAA,AA,FAIL} and match the raw-ratio rule', () => {
    for (const sw of swatches) {
      expect(typeof sw.vsWhite.ratio).toBe('number');
      expect(Number.isFinite(sw.vsWhite.ratio)).toBe(true);
      expect(typeof sw.vsBlack.ratio).toBe('number');
      expect(Number.isFinite(sw.vsBlack.ratio)).toBe(true);
      expect(['AAA', 'AA', 'FAIL']).toContain(sw.vsWhite.tier);
      expect(['AAA', 'AA', 'FAIL']).toContain(sw.vsBlack.tier);
      // Reported tier must equal the tier derived from the RAW reported ratio.
      expect(sw.vsWhite.tier).toBe(refTier(sw.vsWhite.ratio));
      expect(sw.vsBlack.tier).toBe(refTier(sw.vsBlack.ratio));
    }
  });

  it('EC-ORACLE: ≥1 swatch ratios within |Δ|<=0.02 of colorjs.io Color.contrast(_, "WCAG21")', () => {
    // Cross-check the engine's RAW reported ratio against the INDEPENDENT oracle
    // for EVERY swatch (each is a passing case; the AC requires at least one).
    let crossChecked = 0;
    for (const sw of swatches) {
      const oracleWhite = oracleWcagContrast(sw.hex, '#ffffff');
      const oracleBlack = oracleWcagContrast(sw.hex, '#000000');
      expect(
        Math.abs(sw.vsWhite.ratio - oracleWhite),
        `vsWhite ${sw.hex}: engine ${sw.vsWhite.ratio} vs colorjs ${oracleWhite}`
      ).toBeLessThanOrEqual(0.02);
      expect(
        Math.abs(sw.vsBlack.ratio - oracleBlack),
        `vsBlack ${sw.hex}: engine ${sw.vsBlack.ratio} vs colorjs ${oracleBlack}`
      ).toBeLessThanOrEqual(0.02);
      crossChecked++;
    }
    expect(crossChecked).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// AC-2 — default and minimum step counts
// ---------------------------------------------------------------------------

describe('AC-2 — default (5) and minimum (2) step counts', () => {
  it('no steps → exactly 5 swatches', () => {
    const result = generateRampTool({ base: '#3b82f6' });
    expect(result.isError).toBeUndefined();
    expect(swatchesOf(result)).toHaveLength(5);
  });

  it('steps:2 → exactly 2 swatches, both inGamut===true', () => {
    const result = generateRampTool({ base: '#3b82f6', steps: 2 });
    const swatches = swatchesOf(result) as Swatch[];
    expect(swatches).toHaveLength(2);
    for (const sw of swatches) {
      expect(sw.inGamut).toBe(true);
      expect(inRgbGamut(sw.hex)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-3 — structured error on steps < 2 (no throw, no unhandled rejection)
// ---------------------------------------------------------------------------

describe('AC-3 — structured error on steps < 2', () => {
  for (const steps of [1, 0]) {
    it(`steps:${steps} → isError:true, non-empty content[0].text, no throw`, { timeout: 2000 }, () => {
      let result: ReturnType<typeof generateRampTool> | undefined;
      expect(() => {
        result = generateRampTool({ base: '#3b82f6', steps });
      }).not.toThrow();
      expect(result).toBeDefined();
      if (!result) return;
      expect(result.isError).toBe(true);
      const text =
        result.content?.[0]?.type === 'text'
          ? (result.content[0] as { type: string; text: string }).text
          : '';
      expect(text.length).toBeGreaterThan(0);
      expect(result.structuredContent, 'error must not include structuredContent').toBeUndefined();
    });
  }
});

// ---------------------------------------------------------------------------
// AC-4 — base color present in ramp (Euclidean-OKLCH + colorjs.io ΔE2000 oracle)
// ---------------------------------------------------------------------------

describe('AC-4 — base present in ramp (two-metric cross-check)', () => {
  it('≥1 swatch has ΔE_OK(swatch, base) <= 1.0 AND colorjs.io ΔE2000 <= 1.0', () => {
    const result = generateRampTool({ base: '#3b82f6', steps: 7 });
    const swatches = swatchesOf(result) as Swatch[];

    // Derive baseOklch INDEPENDENTLY from the input string (not from ramp output).
    const baseOklch = toOklch('#3b82f6');
    expect(baseOklch).toBeDefined();

    let euclidHit = false;
    let euclidWinnerHex = '';
    let minEuclid = Infinity;
    for (const sw of swatches) {
      // Build a culori OKLCH object from the swatch's RAW oklch fields.
      const swOklch = { mode: 'oklch' as const, l: sw.oklch.l, c: sw.oklch.c, h: sw.oklch.h };
      const de = deltaEOklch(swOklch, baseOklch!);
      if (de < minEuclid) {
        minEuclid = de;
        euclidWinnerHex = sw.hex;
      }
      if (de <= 1.0) euclidHit = true;
    }
    expect(euclidHit, `min Euclidean ΔE_OK to base = ${minEuclid}`).toBe(true);

    // Cross-check the closest swatch via colorjs.io ΔE2000 (different metric, <=1.0).
    const oracleDe = oracleDeltaE2000(euclidWinnerHex, '#3b82f6');
    expect(
      oracleDe,
      `colorjs.io ΔE2000(${euclidWinnerHex}, #3b82f6) = ${oracleDe} should be <= 1.0`
    ).toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — achromatic base (NaN hue) → 5 in-gamut swatches, valid hex, no crash
// ---------------------------------------------------------------------------

describe('AC-5 — achromatic base #808080 (NaN hue)', () => {
  it('steps:5 → 5 swatches, all inGamut, every hex /^#[0-9a-f]{6}$/, no throw', () => {
    let result: ReturnType<typeof generateRampTool> | undefined;
    expect(() => {
      result = generateRampTool({ base: '#808080', steps: 5 });
    }).not.toThrow();
    expect(result).toBeDefined();
    if (!result) return;
    const swatches = swatchesOf(result) as Swatch[];
    expect(swatches).toHaveLength(5);
    for (const sw of swatches) {
      expect(sw.inGamut).toBe(true);
      expect(inRgbGamut(sw.hex)).toBe(true);
      expect(sw.hex).toMatch(/^#[0-9a-f]{6}$/);
      // No NaN propagation into the OKLCH fields.
      expect(Number.isFinite(sw.oklch.l)).toBe(true);
      expect(Number.isFinite(sw.oklch.c)).toBe(true);
      expect(Number.isFinite(sw.oklch.h)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-6 — large step count (declared cap MAX_STEPS=512 ⇒ 100 returns exactly 100)
// ---------------------------------------------------------------------------

describe('AC-6 — large step count robustness (declared contract: 100 → 100 swatches)', () => {
  it('steps:100 → exactly 100 swatches, no throw/hang, <2s', { timeout: 2000 }, () => {
    const start = Date.now();
    let result: ReturnType<typeof generateRampTool> | undefined;
    expect(() => {
      result = generateRampTool({ base: '#3b82f6', steps: 100 });
    }).not.toThrow();
    const elapsed = Date.now() - start;
    expect(elapsed, `elapsed ${elapsed}ms must be < 2000`).toBeLessThan(2000);
    expect(result).toBeDefined();
    if (!result) return;
    expect(result.isError).toBeUndefined();
    expect(swatchesOf(result)).toHaveLength(100);
  });
});

// ---------------------------------------------------------------------------
// AC-7 — near-gamut-edge base, all swatches in gamut via culori inGamut('rgb')
// ---------------------------------------------------------------------------

describe('AC-7 — high-chroma base oklch(0.6 0.35 30), all swatches in gamut', () => {
  it('steps:5 → 5 swatches, inGamut("rgb")({mode:"oklch",...swatch.oklch}) === true', () => {
    const result = generateRampTool({ base: 'oklch(0.6 0.35 30)', steps: 5 });
    const swatches = swatchesOf(result) as Swatch[];
    expect(swatches).toHaveLength(5);
    for (const sw of swatches) {
      expect(sw.inGamut).toBe(true);
      // Include the mode field so culori treats the object as OKLCH.
      const obj = { mode: 'oklch' as const, l: sw.oklch.l, c: sw.oklch.c, h: sw.oklch.h };
      expect(inRgbGamut(obj), `swatch ${sw.hex} oklch object in sRGB`).toBe(true);
      // The hex form is also in gamut (stable check).
      expect(inRgbGamut(sw.hex)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// AC-8 — parse-accepted-then-overflows adversarial input (Infinity chroma)
// ---------------------------------------------------------------------------

describe('AC-8 — Infinity-chroma base oklch(0.5 1e400 30)', () => {
  it('steps:5 → isError:true, no hang, <2s (guard in the shared parseColor boundary)', { timeout: 2000 }, () => {
    const start = Date.now();
    let result: ReturnType<typeof generateRampTool> | undefined;
    expect(() => {
      result = generateRampTool({ base: 'oklch(0.5 1e400 30)', steps: 5 });
    }).not.toThrow();
    const elapsed = Date.now() - start;
    expect(elapsed, `elapsed ${elapsed}ms must be < 2000`).toBeLessThan(2000);
    expect(result).toBeDefined();
    if (!result) return;
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('the guard lives in the SHARED parseColor boundary (sibling tools inherit it)', () => {
    // The lib returns RampError because parseColor rejects the non-finite input —
    // not because of a generate_ramp-local check. Assert parseColor itself rejects.
    const parseSrc = readFileSync(join(repoRoot, 'src/lib/color/parse.ts'), 'utf-8');
    expect(parseSrc).toMatch(/Number\.isFinite/);
    const r = generateRamp('oklch(0.5 1e400 30)', 5);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-9 — zod outputSchema on the registered tool (live output parse + grep)
// ---------------------------------------------------------------------------

describe('AC-9 — outputSchema + swatchArraySchema parse on LIVE output', () => {
  it('(a) swatchArraySchema.parse(result.structuredContent.swatches) does not throw', () => {
    const result = generateRampTool({ base: '#3b82f6', steps: 7 });
    const sc = result.structuredContent as { swatches: unknown[] };
    expect(() => swatchArraySchema.parse(sc.swatches)).not.toThrow();
    const parsed = swatchArraySchema.parse(sc.swatches);
    expect(parsed).toHaveLength(7);
  });

  it('(b) grep: "outputSchema" present in src/tools/generate_ramp.ts (exits 0)', () => {
    const src = readFileSync(join(repoRoot, 'src/tools/generate_ramp.ts'), 'utf-8');
    expect(src).toContain('outputSchema');
    expect(src).toContain('registerTool');
    expect(src.indexOf('outputSchema')).toBeGreaterThan(src.indexOf('registerTool'));
  });
});

// ---------------------------------------------------------------------------
// AC-10 — no network I/O / fs writes (static grep + runtime fetch-patch)
// ---------------------------------------------------------------------------

describe('AC-10 — no network I/O and no filesystem writes', () => {
  it('static: no fetch(/http./fs.write in tool or ramp lib', () => {
    const forbidden = /fetch\(|http\.|fs\.write/;
    const toolSrc = readFileSync(join(repoRoot, 'src/tools/generate_ramp.ts'), 'utf-8');
    const rampSrc = readFileSync(join(repoRoot, 'src/lib/color/ramp.ts'), 'utf-8');
    expect(toolSrc).not.toMatch(forbidden);
    expect(rampSrc).not.toMatch(forbidden);
  });

  it('runtime: patching globalThis.fetch to throw does not break a valid call', () => {
    const original = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = () => {
      throw new Error('network access is forbidden in this handler');
    };
    try {
      const result = generateRampTool({ base: '#3b82f6', steps: 5 });
      expect(result.isError).toBeUndefined();
      expect(swatchesOf(result)).toHaveLength(5);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('sibling-guard: toRgb/toOklch absent from src/tools/generate_ramp.ts', () => {
    const toolSrc = readFileSync(join(repoRoot, 'src/tools/generate_ramp.ts'), 'utf-8');
    expect(toolSrc).not.toMatch(/\btoRgb\b/);
    expect(toolSrc).not.toMatch(/\btoOklch\b/);
  });
});

// ---------------------------------------------------------------------------
// Fixed-seed property-fuzz loop (reproducible PRNG, tier-scaled case count).
// Invariants over the input distribution: every swatch in-gamut, strictly
// decreasing raw lightness, finite contrast ratios, tier matches raw rule, and
// the engine WCAG ratio agrees with the colorjs.io oracle within 0.02.
// ---------------------------------------------------------------------------

/** Deterministic mulberry32 PRNG — committed fixed seed → reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('property-fuzz — fixed-seed sweep over random bases/steps', () => {
  const rng = mulberry32(0xc0102a); // committed seed
  const CASES = 40;

  it(`${CASES} random ramps: all invariants hold + WCAG matches colorjs.io within 0.02`, () => {
    for (let n = 0; n < CASES; n++) {
      // Random base in OKLCH (kept modest so most channels resolve in gamut after mapping).
      const l = 0.2 + rng() * 0.6;
      const c = rng() * 0.3;
      const h = rng() * 360;
      const base = `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)})`;
      const steps = 2 + Math.floor(rng() * 11); // 2..12

      const result = generateRampTool({ base, steps });
      expect(result.isError, `${base} steps=${steps} unexpectedly errored`).toBeUndefined();
      const swatches = swatchesOf(result) as Swatch[];
      expect(swatches).toHaveLength(steps);

      for (let i = 0; i < swatches.length; i++) {
        const sw = swatches[i];
        // Invariant: in gamut.
        expect(sw.inGamut, `${base} sw ${sw.hex} inGamut`).toBe(true);
        expect(inRgbGamut(sw.hex)).toBe(true);
        // Invariant: finite ratios, tier matches the raw rule.
        expect(Number.isFinite(sw.vsWhite.ratio)).toBe(true);
        expect(Number.isFinite(sw.vsBlack.ratio)).toBe(true);
        expect(sw.vsWhite.tier).toBe(refTier(sw.vsWhite.ratio));
        expect(sw.vsBlack.tier).toBe(refTier(sw.vsBlack.ratio));
        // Invariant: strictly decreasing raw lightness.
        if (i > 0) {
          expect(
            swatches[i - 1].oklch.l,
            `${base}: l not strictly decreasing at ${i}`
          ).toBeGreaterThan(sw.oklch.l);
        }
        // Differential: engine WCAG ratio agrees with colorjs.io oracle.
        const oracleWhite = oracleWcagContrast(sw.hex, '#ffffff');
        expect(Math.abs(sw.vsWhite.ratio - oracleWhite)).toBeLessThanOrEqual(0.02);
      }
    }
  });
});
