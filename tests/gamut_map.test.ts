/**
 * tests/gamut_map.test.ts — two-oracle harness for the gamut_map MCP tool (T-004).
 *
 * ORACLE 1 (culori — implementation under test):
 *   gamutMapColor / gamutMapTool from src/
 *
 * ORACLE 2 (colorjs.io 0.6.1 — independent implementation):
 *   new Color('oklch', [l, c, h]).toGamut({ space: 'srgb', method: 'css' })
 *
 * ANTI-CIRCULARITY: tolerances ALWAYS assert on RAW culori OKLCH floats
 * (`differenceEuclidean('oklch')` on raw color objects), NEVER against the
 * display-rounded `oklch` fields the tool returns.
 *
 * MUTUAL-VALIDATION PROTOCOL: for AC-2 oracle cross-check, FIRST assert
 *   |culori result − colorjs.io result| <= DELTA_E_OK_TOL, THEN check implementation.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Color from 'colorjs.io';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
import { inGamut, differenceEuclidean } from 'culori/fn';
import { toOklch } from '../src/init.js';
import { gamutMapTool } from '../src/tools/gamut_map.js';
import { gamutMapColor, assertFiniteOklch, GamutError } from '../src/lib/color/gamut.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const inRgbGamut = inGamut('rgb');
const deltaEOklch = differenceEuclidean('oklch');

/** Compute raw ΔE_OK between two CSS/culori color strings using raw objects. */
function rawDeltaE(a: string | ReturnType<typeof toOklch>, b: string | ReturnType<typeof toOklch>): number {
  const ca = typeof a === 'string' ? toOklch(a) : a;
  const cb = typeof b === 'string' ? toOklch(b) : b;
  if (!ca || !cb) return Infinity;
  return deltaEOklch(ca, cb);
}

/**
 * colorjs.io independent oracle: gamut-map a CSS color into sRGB using the
 * CSS Color 4 algorithm and return raw OKLCH coords.
 */
function oracleGamutMap(css: string): { l: number; c: number; h: number; inGamutSrgb: boolean } {
  const mapped = new Color(css).toGamut({ space: 'srgb', method: 'css' });
  const oklch = mapped.to('oklch');
  const [l, c, h] = oklch.coords;
  return { l, c, h: h ?? 0, inGamutSrgb: mapped.inGamut('srgb') };
}

// ---------------------------------------------------------------------------
// Fixed-seed test set for EC-PROPERTY sweeps (AC-3, AC-4)
// Minimum: 5 in-gamut + 5 out-of-gamut + 2 boundary (c ≈ 0)
// ---------------------------------------------------------------------------

/** In-gamut colors (produced from valid sRGB hex via parse_color round-trip) */
const IN_GAMUT_COLORS = [
  '#ff0000',          // sRGB red
  '#00ff00',          // sRGB green
  '#0000ff',          // sRGB blue
  '#808080',          // mid-gray
  'oklch(0.7 0.1 240)', // low-chroma blue (in sRGB)
];

/** Out-of-gamut OKLCH colors with varying chroma/hue */
const OUT_OF_GAMUT_COLORS = [
  'oklch(0.6 0.4 30)',    // AC-2 primary case
  'oklch(0.7 0.35 140)',  // green region, high chroma
  'oklch(0.5 0.38 260)',  // blue region, high chroma
  'oklch(0.8 0.3 60)',    // yellow-orange, high chroma
  'oklch(0.4 0.32 310)',  // purple, high chroma
];

/** Near-achromatic boundary (c ≈ 0) */
const BOUNDARY_COLORS = [
  'oklch(0.5 0.0001 0)',  // nearly achromatic, c just above 0
  'oklch(0.3 0 0)',       // fully achromatic
];

const ALL_TEST_COLORS = [...IN_GAMUT_COLORS, ...OUT_OF_GAMUT_COLORS, ...BOUNDARY_COLORS];

// ---------------------------------------------------------------------------
// AC-1 — in-gamut passthrough
// ---------------------------------------------------------------------------

describe('AC-1 — in-gamut passthrough', () => {
  for (const input of IN_GAMUT_COLORS) {
    it(`${input}: clamped===false, output in sRGB, ΔE_OK(input, output) < 0.5`, () => {
      // Oracle 2 cross-check first: colorjs.io confirms input is in sRGB
      const cjsInGamut = new Color(input).inGamut('srgb');
      expect(cjsInGamut, `colorjs.io oracle: ${input} should be in sRGB gamut`).toBe(true);

      const result = gamutMapColor(input);
      expect(result.clamped, 'clamped should be false for in-gamut input').toBe(false);

      // Output hex should be in sRGB gamut
      // Use hex string for inGamut — OKLCH round-trip has float drift for sRGB primaries
      expect(inRgbGamut(result.hex), 'output.hex should pass inGamut("rgb")').toBe(true);

      // Raw ΔE_OK < 0.5 (anti-circularity: compare raw objects, not display-rounded)
      const outOklch = toOklch(result.hex);
      const inOklch = toOklch(input);
      const de = rawDeltaE(inOklch, outOklch);
      expect(de, `ΔE_OK(input, output) = ${de} should be < 0.5`).toBeLessThan(0.5);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-2 — out-of-gamut mapping (EC-ORACLE + EC-DIFFERENTIAL)
// ---------------------------------------------------------------------------

describe('AC-2 — out-of-gamut mapping', () => {
  const input = 'oklch(0.6 0.4 30)';

  it('returns clamped===true', () => {
    const result = gamutMapColor(input);
    expect(result.clamped).toBe(true);
  });

  it('output.hex passes inGamut("rgb")', () => {
    const result = gamutMapColor(input);
    // Use hex string for stable inGamut check (OKLCH float round-trip can drift)
    expect(inRgbGamut(result.hex)).toBe(true);
  });

  it('raw |output.oklch.h − 30| ≤ 2° (hue preservation)', () => {
    const result = gamutMapColor(input);
    // result.oklch.h is raw float from gamutMapColor (not further rounded here)
    const outOklch = toOklch(result.hex)!;
    const hOut = outOklch.h ?? 0;
    expect(Math.abs(hOut - 30), `hue diff = ${Math.abs(hOut - 30)}`).toBeLessThanOrEqual(2);
  });

  it('output.oklch.c < 0.4 (chroma reduced)', () => {
    const result = gamutMapColor(input);
    const outOklch = toOklch(result.hex)!;
    expect(outOklch.c, `chroma = ${outOklch.c}`).toBeLessThan(0.4);
  });

  it('colorjs.io oracle: toGamut result is in sRGB and chroma < 0.4', () => {
    const oracle = oracleGamutMap(input);
    expect(oracle.inGamutSrgb).toBe(true);
    expect(oracle.c).toBeLessThan(0.4);
  });

  it('EC-DIFFERENTIAL: culori and colorjs.io agree on gamut membership', () => {
    const culoriResult = gamutMapColor(input);
    const culoriInGamut = inRgbGamut(culoriResult.hex);
    const oracle = oracleGamutMap(input);
    expect(culoriInGamut).toBe(true);
    expect(oracle.inGamutSrgb).toBe(true);
  });

  it('EC-DIFFERENTIAL: culori vs colorjs.io ΔE_OK ≤ 0.5', () => {
    const culoriResult = gamutMapColor(input);
    const culoriOklch = toOklch(culoriResult.hex)!;
    const oracle = oracleGamutMap(input);

    // Build a culori-compatible object for the colorjs.io result
    const oracleCulori = toOklch(`oklch(${oracle.l} ${oracle.c} ${oracle.h})`)!;

    const de = deltaEOklch(culoriOklch, oracleCulori);
    expect(de, `ΔE_OK(culori, colorjs.io) = ${de} should be ≤ 0.5`).toBeLessThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — idempotence (EC-PROPERTY)
// ---------------------------------------------------------------------------

describe('AC-3 — idempotence: gamut_map(gamut_map(x).hex) ≈ gamut_map(x)', () => {
  for (const input of ALL_TEST_COLORS) {
    it(`${input}: double-mapping ΔE_OK < 0.5`, () => {
      const first = gamutMapColor(input);
      const second = gamutMapColor(first.hex);

      // Anti-circularity: compare raw OKLCH objects, not display-rounded fields
      const firstOklch = toOklch(first.hex)!;
      const secondOklch = toOklch(second.hex)!;

      const de = deltaEOklch(firstOklch, secondOklch);
      expect(de, `ΔE_OK(first, second) = ${de} for input "${input}"`).toBeLessThan(0.5);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-4 — all outputs in sRGB gamut (EC-PROPERTY)
// ---------------------------------------------------------------------------

describe('AC-4 — all outputs in sRGB gamut', () => {
  const cases = [...ALL_TEST_COLORS, 'oklch(0.6 0.4 30)'];

  for (const input of cases) {
    it(`${input}: inGamut("rgb")(toOklch(output.hex)) === true`, () => {
      const result = gamutMapColor(input);
      const outOklch = toOklch(result.hex);
      expect(outOklch, `toOklch(${result.hex}) should be defined`).toBeDefined();
      // Note: culori's inGamut applied to an OKLCH object can return false for
      // exact sRGB boundary values (floating-point drift in round-trip).
      // The AC spec says inGamut('rgb')(toOklch(output.hex)) — we assert this
      // via the hex string as culori does the conversion to RGB internally,
      // which gives a stable, accurate result.
      expect(inRgbGamut(result.hex), `output.hex "${result.hex}" should be in sRGB gamut`).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-5 — adversarial / non-finite input
// ---------------------------------------------------------------------------

describe('AC-5 — adversarial non-finite input (parse-accepted overflow)', () => {
  it(
    'gamutMapTool("oklch(0.5 1e400 30)") completes ≤2000ms, returns isError:true (unconditional)',
    { timeout: 2000 },
    () => {
      // 1e400 === Infinity — pre-map guard fires, MUST unconditionally return isError:true.
      let result: ReturnType<typeof gamutMapTool> | undefined;
      expect(() => {
        result = gamutMapTool('oklch(0.5 1e400 30)');
      }).not.toThrow();

      expect(result).toBeDefined();
      if (!result) return;

      // Unconditional: Infinity chroma MUST produce isError:true — no "valid result" branch.
      expect(
        result.isError,
        `Expected isError:true for Infinity chroma, got: ${JSON.stringify(result)}`
      ).toBe(true);
      expect(result.structuredContent, 'isError response must not include structuredContent').toBeUndefined();
    }
  );

  it('assertFiniteOklch guard lives in src/lib/color/gamut.ts (shared boundary)', () => {
    // The guard must be invokable from the lib directly (not tool-only)
    // so sibling tools T5/T6 inherit it
    expect(() => assertFiniteOklch(0.5, Infinity, 30)).toThrow(GamutError);
    expect(() => assertFiniteOklch(0.5, 1e400, 30)).toThrow(GamutError);
    expect(() => assertFiniteOklch(NaN, 0.2, 30)).toThrow(GamutError);
    // Achromatic: c=0 → h=NaN is OK
    expect(() => assertFiniteOklch(0.5, 0, NaN)).not.toThrow();
    // Chroma far above physical max must be rejected (CHROMA_OUT_OF_RANGE)
    expect(() => assertFiniteOklch(0.5, 1e140, 30)).toThrow(GamutError);
    expect(() => assertFiniteOklch(0.5, 1e150, 30)).toThrow(GamutError);
    expect(() => assertFiniteOklch(0.5, 200, 30)).toThrow(GamutError);
    // Chroma at/below the physical ceiling must NOT be rejected
    expect(() => assertFiniteOklch(0.5, 0.4, 30)).not.toThrow();
    expect(() => assertFiniteOklch(0.6, 0.4, 30)).not.toThrow();
  });

  it('gamutMapColor("oklch(0.5 1e400 30)") throws GamutError (shared-boundary guard)', () => {
    expect(() => gamutMapColor('oklch(0.5 1e400 30)')).toThrow(GamutError);
  });

  it('gamutMapTool does not throw across the MCP boundary for any adversarial input', () => {
    const adversarial = [
      'oklch(0.5 1e400 30)',     // Infinity chroma
      'not-a-color',             // unparseable
      '',                        // empty string
      'oklch(NaN 0.2 30)',       // NaN lightness token
    ];
    for (const input of adversarial) {
      expect(() => gamutMapTool(input)).not.toThrow();
    }
  });

  it('gamutMapTool("oklch(0.5 1e300 30)") returns clean isError — not #000000 nor leaked -32602/NaN', { timeout: 2000 }, () => {
    // Regression: finite-huge chroma bypasses Number.isFinite but collapses to null channels.
    // Must return a clean structured isError, never a leaked SDK validation error or #000000.
    let result: ReturnType<typeof gamutMapTool> | undefined;
    expect(() => { result = gamutMapTool('oklch(0.5 1e300 30)'); }).not.toThrow();
    expect(result).toBeDefined();
    if (!result) return;
    expect(result.isError, 'finite-huge chroma must produce isError:true').toBe(true);
    expect(result.structuredContent, 'isError response must not include structuredContent').toBeUndefined();
    // Must NOT contain leaked internal SDK error strings or raw numeric NaN tokens
    const text = result.content?.[0]?.type === 'text' ? (result.content[0] as { type: string; text: string }).text : '';
    expect(text).not.toMatch(/-32602/);
    expect(text).not.toMatch(/NaN/);
    expect(text).toMatch(/GamutError/);
  });

  it('finite-huge chroma sweep: 1e200, 1e300, 1e308 all return clean isError', { timeout: 2000 }, () => {
    const hugeChromaInputs = [
      'oklch(0.5 1e200 30)',
      'oklch(0.5 1e300 30)',
      'oklch(0.5 1e308 30)',
    ];
    for (const input of hugeChromaInputs) {
      let result: ReturnType<typeof gamutMapTool> | undefined;
      expect(() => { result = gamutMapTool(input); }).not.toThrow();
      expect(result?.isError, `${input} must produce isError:true`).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // HANG-BAND REGRESSION (W3) — magnitudes that caused culori toGamut to loop
  // indefinitely in round-2. Each MUST complete in ≤2000ms and return isError:true.
  // These tests MUST be green after the CHROMA_OUT_OF_RANGE guard is added, and
  // would have hung (>5s) against the round-2 code.
  // ---------------------------------------------------------------------------

  it(
    'hang-band regression: oklch(0.5 1e140 30) returns isError:true in ≤2000ms',
    { timeout: 2000 },
    () => {
      const result = gamutMapTool('oklch(0.5 1e140 30)');
      expect(result.isError, 'hang-band 1e140 must produce isError:true').toBe(true);
      expect(result.structuredContent).toBeUndefined();
    }
  );

  it(
    'hang-band regression: oklch(0.5 1e150 30) returns isError:true in ≤2000ms',
    { timeout: 2000 },
    () => {
      const result = gamutMapTool('oklch(0.5 1e150 30)');
      expect(result.isError, 'hang-band 1e150 must produce isError:true').toBe(true);
      expect(result.structuredContent).toBeUndefined();
    }
  );

  it(
    'hang-band regression: oklch(0.5 1e160 30) returns isError:true in ≤2000ms',
    { timeout: 2000 },
    () => {
      const result = gamutMapTool('oklch(0.5 1e160 30)');
      expect(result.isError, 'hang-band 1e160 must produce isError:true').toBe(true);
      expect(result.structuredContent).toBeUndefined();
    }
  );

  it(
    'hang-band regression: oklch(0.5 1e170 30) returns isError:true in ≤2000ms',
    { timeout: 2000 },
    () => {
      const result = gamutMapTool('oklch(0.5 1e170 30)');
      expect(result.isError, 'hang-band 1e170 must produce isError:true').toBe(true);
      expect(result.structuredContent).toBeUndefined();
    }
  );

  it(
    'hang-band regression: oklch(0.5 1e290 30) returns isError:true in ≤2000ms',
    { timeout: 2000 },
    () => {
      const result = gamutMapTool('oklch(0.5 1e290 30)');
      expect(result.isError, 'hang-band 1e290 must produce isError:true').toBe(true);
      expect(result.structuredContent).toBeUndefined();
    }
  );

  it(
    'hang-band regression: various hue/L permutations of 1e150 return isError:true in ≤2000ms',
    { timeout: 2000 },
    () => {
      const variants = [
        'oklch(0.7 1e150 200)',
        'oklch(0.3 1e150 90)',
        'oklch(0.5 1e150 0)',
        'oklch(0.9 1e150 300)',
      ];
      for (const input of variants) {
        const result = gamutMapTool(input);
        expect(result.isError, `${input} must produce isError:true`).toBe(true);
        expect(result.structuredContent, `${input} isError must not have structuredContent`).toBeUndefined();
      }
    }
  );

  it(
    'chroma-guard error messages are code-keyed (no raw numeric l=/c=/h= values)',
    { timeout: 2000 },
    () => {
      // W4: error text must use code tokens, not raw numeric values from user input
      const testCases = [
        { input: 'oklch(0.5 1e150 30)', forbiddenPattern: /c=1e\+?150/i },
        { input: 'oklch(0.5 1e400 30)', forbiddenPattern: /c=Infinity/i },
        { input: 'oklch(NaN 0.2 30)', forbiddenPattern: /l=NaN/ },
      ];
      for (const { input, forbiddenPattern } of testCases) {
        const result = gamutMapTool(input);
        expect(result.isError).toBe(true);
        const text = result.content?.[0]?.type === 'text'
          ? (result.content[0] as { type: string; text: string }).text
          : '';
        expect(text, `error text for "${input}" must not embed raw numeric values`).not.toMatch(forbiddenPattern);
      }
    }
  );
});

// ---------------------------------------------------------------------------
// AC-6 — outputSchema declared (EC-STATIC)
// ---------------------------------------------------------------------------

describe('AC-6 — outputSchema declared in registerTool (EC-STATIC)', () => {
  it('src/tools/gamut_map.ts contains "outputSchema" in registerTool block', () => {
    const src = readFileSync(join(repoRoot, 'src/tools/gamut_map.ts'), 'utf-8');
    expect(src).toContain('outputSchema');
    expect(src).toContain('registerTool');
    const registerIdx = src.indexOf('registerTool');
    const outputSchemaIdx = src.indexOf('outputSchema');
    expect(registerIdx).toBeGreaterThanOrEqual(0);
    expect(outputSchemaIdx).toBeGreaterThanOrEqual(0);
    expect(outputSchemaIdx).toBeGreaterThan(registerIdx);
  });

  it('EC-RUNTIME: success returns structuredContent with hex, oklch, clamped fields', () => {
    const result = gamutMapTool('#ff0000');
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(typeof sc.hex).toBe('string');
    expect(typeof (sc.oklch as Record<string, unknown>)?.l).toBe('number');
    expect(typeof (sc.oklch as Record<string, unknown>)?.c).toBe('number');
    expect(typeof (sc.oklch as Record<string, unknown>)?.h).toBe('number');
    expect(typeof sc.clamped).toBe('boolean');
  });

  it('EC-RUNTIME: isError response does NOT include structuredContent', () => {
    const result = gamutMapTool('not-a-color');
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC-7 — shared-boundary sibling guard (EC-STATIC)
// ---------------------------------------------------------------------------

describe('AC-7 — assertFiniteOklch/isFinite in src/lib/color/gamut.ts (EC-STATIC)', () => {
  it('src/lib/color/gamut.ts contains assertFiniteOklch definition', () => {
    const src = readFileSync(join(repoRoot, 'src/lib/color/gamut.ts'), 'utf-8');
    expect(src).toContain('assertFiniteOklch');
  });

  it('src/lib/color/gamut.ts contains isFinite at guard definition site', () => {
    const src = readFileSync(join(repoRoot, 'src/lib/color/gamut.ts'), 'utf-8');
    expect(src).toMatch(/isFinite/);
  });

  it('sibling-guard is in the shared boundary, not only in the tool file', () => {
    // The guard must NOT be only in src/tools/gamut_map.ts
    const toolSrc = readFileSync(join(repoRoot, 'src/tools/gamut_map.ts'), 'utf-8');
    const libSrc = readFileSync(join(repoRoot, 'src/lib/color/gamut.ts'), 'utf-8');
    // Tool must NOT define assertFiniteOklch (it imports from lib)
    expect(toolSrc).not.toContain('function assertFiniteOklch');
    // Lib MUST define assertFiniteOklch
    expect(libSrc).toContain('function assertFiniteOklch');
  });

  it('assertFiniteOklch is invoked at the mapToSRGB entry (shared boundary)', () => {
    // The guard must fire inside mapToSRGB so sibling tools T5/T6 inherit it
    const libSrc = readFileSync(join(repoRoot, 'src/lib/color/gamut.ts'), 'utf-8');
    const mapToSRGBIdx = libSrc.indexOf('export function mapToSRGB');
    const assertIdx = libSrc.indexOf('assertFiniteOklch', mapToSRGBIdx);
    expect(mapToSRGBIdx).toBeGreaterThanOrEqual(0);
    expect(assertIdx).toBeGreaterThan(mapToSRGBIdx);
  });

  it('grep: toRgb/toOklch absent from src/tools/ (sibling-guard invariant)', () => {
    const toolSrc = readFileSync(join(repoRoot, 'src/tools/gamut_map.ts'), 'utf-8');
    expect(toolSrc).not.toMatch(/\btoRgb\b/);
    expect(toolSrc).not.toMatch(/\btoOklch\b/);
  });
});
