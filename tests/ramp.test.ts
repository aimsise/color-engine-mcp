/**
 * tests/ramp.test.ts — pure-function unit tests for `generateRamp` / `toRampTier`
 * / `formatRampTokens` (plus targeted tool/schema checks for the TOKENS feature).
 *
 * These exercise the lib layer: monotonicity, the sin chroma-curve shape,
 * base-presence, the achromatic gray ramp, the declared step contract
 * (MIN=2 / MAX=512), the `toRampTier` boundary table, OUT-1 display rounding,
 * and design-token formatting.
 *
 * DISPLAY-ROUNDING CONTRACT (OUT-1): swatch numbers are display-rounded (oklch
 * l/c 5dp, h 2dp, ratios 2dp). Tiers are still classified from the RAW
 * pre-rounding ratios INSIDE the lib (anti-circularity — see the toRampTier
 * table below). Monotonicity assertions run on the returned 5dp lightness
 * values, which is safe here because every tested per-step ΔL is ≥ ~0.03 —
 * orders of magnitude above the 1e-5 rounding quantum.
 */
import { describe, it, expect } from 'vitest';
import { generateRamp, toRampTier, formatRampTokens } from '../src/lib/color/ramp.js';
import { generateRampTool } from '../src/tools/generate_ramp.js';
import { generateRampInput } from '../src/schemas/generate_ramp.js';

/** Narrow a RampResult|RampError to the ok branch or fail the test. */
function expectOk(r: ReturnType<typeof generateRamp>) {
  if (!r.ok) {
    throw new Error(`expected ok ramp, got error: ${r.error}`);
  }
  return r;
}

// ---------------------------------------------------------------------------
// toRampTier — boundary table (independent of the contrast engine).
// ---------------------------------------------------------------------------

describe('toRampTier — RAW-ratio boundary table', () => {
  it('>=7.0 → AAA (exact boundary)', () => {
    expect(toRampTier(7.0)).toBe('AAA');
    expect(toRampTier(7.0000001)).toBe('AAA');
    expect(toRampTier(21)).toBe('AAA');
  });
  it('just below 7.0 → AA (anti-circularity: 6.9999 must NOT round up to AAA)', () => {
    expect(toRampTier(6.9999)).toBe('AA');
    expect(toRampTier(4.5)).toBe('AA');
  });
  it('just below 4.5 → FAIL (4.4999 must NOT round up to AA)', () => {
    expect(toRampTier(4.4999)).toBe('FAIL');
    expect(toRampTier(1)).toBe('FAIL');
    expect(toRampTier(0)).toBe('FAIL');
  });
});

// ---------------------------------------------------------------------------
// Step contract (MIN_STEPS=2, MAX_STEPS=512) — RampError, never throw.
// ---------------------------------------------------------------------------

describe('generateRamp — step contract', () => {
  it('steps < 2 → RampError (1, 0, -3, non-integer) without throwing', () => {
    for (const s of [1, 0, -3, 2.5, NaN]) {
      const r = generateRamp('#3b82f6', s);
      expect(r.ok, `steps=${s} must be RampError`).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });
  it('steps > 512 → RampError (declared cap)', () => {
    const r = generateRamp('#3b82f6', 513);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/512/);
  });
  it('steps = 512 (the cap itself) → ok with exactly 512 swatches', () => {
    const r = expectOk(generateRamp('#3b82f6', 512));
    expect(r.swatches).toHaveLength(512);
  });
  it('steps = 2 → ok with exactly 2 swatches (no division-by-zero)', () => {
    const r = expectOk(generateRamp('#3b82f6', 2));
    expect(r.swatches).toHaveLength(2);
    for (const sw of r.swatches) expect(Number.isFinite(sw.oklch.l)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Monotonic lightness. The returned L values are display-rounded to 5dp; with
// per-step ΔL ≥ 0.92/11 ≈ 0.08 here, strict monotonicity is unaffected.
// ---------------------------------------------------------------------------

describe('generateRamp — strictly decreasing lightness (tint → shade)', () => {
  for (const steps of [2, 3, 5, 7, 12]) {
    it(`steps=${steps}: oklch.l[i] > oklch.l[i+1]`, () => {
      const r = expectOk(generateRamp('#3b82f6', steps));
      for (let i = 0; i < r.swatches.length - 1; i++) {
        expect(
          r.swatches[i].oklch.l,
          `l[${i}]=${r.swatches[i].oklch.l} must exceed l[${i + 1}]=${r.swatches[i + 1].oklch.l}`
        ).toBeGreaterThan(r.swatches[i + 1].oklch.l);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Sin chroma-curve shape: endpoints ~0, an interior peak near baseC.
// ---------------------------------------------------------------------------

describe('generateRamp — sin chroma curve shape', () => {
  it('steps=7: endpoint chroma ~0, interior chroma strictly larger than endpoints', () => {
    const r = expectOk(generateRamp('#3b82f6', 7));
    const cs = r.swatches.map((s) => s.oklch.c);
    // After gamut mapping the endpoints (l≈0.97 white / l≈0.05 black) have ~0 chroma.
    expect(cs[0]).toBeLessThan(0.02);
    expect(cs[cs.length - 1]).toBeLessThan(0.02);
    // Some interior swatch must carry real chroma (the curve peaks in the middle).
    const interiorMax = Math.max(...cs.slice(1, -1));
    expect(interiorMax).toBeGreaterThan(cs[0]);
    expect(interiorMax).toBeGreaterThan(cs[cs.length - 1]);
    expect(interiorMax).toBeGreaterThan(0.02);
  });
});

// ---------------------------------------------------------------------------
// Achromatic base — finite neutral gray ramp, no NaN propagation.
// ---------------------------------------------------------------------------

describe('generateRamp — achromatic base produces a finite gray ramp', () => {
  it('#808080: 5 finite swatches, every chroma ~0, every hex /^#[0-9a-f]{6}$/', () => {
    const r = expectOk(generateRamp('#808080', 5));
    expect(r.swatches).toHaveLength(5);
    for (const sw of r.swatches) {
      expect(Number.isFinite(sw.oklch.l)).toBe(true);
      expect(Number.isFinite(sw.oklch.c)).toBe(true);
      expect(Number.isFinite(sw.oklch.h)).toBe(true);
      expect(sw.oklch.c).toBeLessThan(0.02);
      expect(sw.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST-1 — deltaL / lightness-range / base-chroma validation (ALG-1 / ALG-2),
// all returning a RampError code string and NEVER throwing.
// ---------------------------------------------------------------------------

describe('generateRamp — deltaL narrows the L span and stays strictly decreasing', () => {
  it('deltaL=0.2 produces a ~0.2 L span (narrower than the default ~0.92) and strictly decreasing L', () => {
    const wide = expectOk(generateRamp('#3b82f6', 7)); // default fixed range 0.97..0.05
    const wideSpan = wide.swatches[0].oklch.l - wide.swatches[wide.swatches.length - 1].oklch.l;

    const narrow = expectOk(generateRamp('#3b82f6', 7, { deltaL: 0.2 }));
    const ls = narrow.swatches.map((s) => s.oklch.l);
    const narrowSpan = ls[0] - ls[ls.length - 1];

    // deltaL is the TOTAL span centered on the base L (endpoints at base L ±
    // deltaL/2) → the realized L span equals deltaL (endpoints clamp into [0,1],
    // which does not bite for base L≈0.62).
    expect(narrowSpan, `narrow span ${narrowSpan}`).toBeCloseTo(0.2, 3);
    // It is genuinely narrower than the default fixed range.
    expect(narrowSpan).toBeLessThan(wideSpan);

    // Strictly monotonically DECREASING (AC-1 preserved; 5dp display rounding
    // cannot collapse the ≥0.033 per-step ΔL here).
    for (let i = 0; i < ls.length - 1; i++) {
      expect(ls[i], `l[${i}]=${ls[i]} must exceed l[${i + 1}]=${ls[i + 1]}`).toBeGreaterThan(ls[i + 1]);
    }
  });

  it('deltaL <= 0 or non-finite → RampError INVALID_DELTA_L (no throw)', () => {
    for (const deltaL of [0, -0.1, -5, NaN, Infinity]) {
      let r: ReturnType<typeof generateRamp> | undefined;
      expect(() => {
        r = generateRamp('#3b82f6', 7, { deltaL });
      }).not.toThrow();
      expect(r?.ok, `deltaL=${deltaL} must be RampError`).toBe(false);
      if (r && !r.ok) {
        expect(r.error).toBe('INVALID_DELTA_L: deltaL must be a finite number > 0');
      }
    }
  });
});

describe('generateRamp — lightnessMin/lightnessMax band validation', () => {
  it('lightnessMin >= lightnessMax → RampError INVALID_LIGHTNESS_RANGE (no throw)', () => {
    for (const [lightnessMin, lightnessMax] of [
      [0.8, 0.3], // strictly greater
      [0.5, 0.5], // equal
    ] as const) {
      let r: ReturnType<typeof generateRamp> | undefined;
      expect(() => {
        r = generateRamp('#3b82f6', 7, { lightnessMin, lightnessMax });
      }).not.toThrow();
      expect(r?.ok, `(${lightnessMin},${lightnessMax}) must be RampError`).toBe(false);
      if (r && !r.ok) {
        expect(r.error).toBe(
          'INVALID_LIGHTNESS_RANGE: lightnessMin must be strictly less than lightnessMax'
        );
      }
    }
  });

  it('a valid lightnessMin/lightnessMax band yields strictly-decreasing L within the band', () => {
    const r = expectOk(generateRamp('#3b82f6', 7, { lightnessMin: 0.3, lightnessMax: 0.7 }));
    const ls = r.swatches.map((s) => s.oklch.l);
    // Endpoints sit at the requested band edges (the L endpoints are exact; chroma
    // clamping does not move the reported L for these in-band swatches).
    expect(ls[0], `top L ${ls[0]}`).toBeCloseTo(0.7, 3);
    expect(ls[ls.length - 1], `bottom L ${ls[ls.length - 1]}`).toBeCloseTo(0.3, 3);
    // Every reported L stays inside the band and the sequence strictly decreases.
    for (let i = 0; i < ls.length; i++) {
      expect(ls[i]).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(ls[i]).toBeLessThanOrEqual(0.7 + 1e-9);
      if (i > 0) expect(ls[i - 1], `L not strictly decreasing at ${i}`).toBeGreaterThan(ls[i]);
    }
  });
});

describe('generateRamp — base OKLCH chroma above MAX_FINITE_CHROMA (100)', () => {
  it('base chroma > 100 → RampError BASE_CHROMA_OUT_OF_RANGE (finite, no throw)', () => {
    // 150 is FINITE (passes parseColor's finite guard and the shared 1e6 cap) but
    // exceeds the gamut mapper's accepted ceiling (100), so the ramp rejects it at
    // the base-chroma check BEFORE the per-swatch loop ever calls mapToSRGB.
    for (const base of ['oklch(0.5 150 30)', 'oklch(0.5 500 30)']) {
      let r: ReturnType<typeof generateRamp> | undefined;
      expect(() => {
        r = generateRamp(base, 5);
      }).not.toThrow();
      expect(r?.ok, `${base} must be RampError`).toBe(false);
      if (r && !r.ok) {
        expect(r.error).toBe(
          'BASE_CHROMA_OUT_OF_RANGE: base OKLCH chroma exceeds the supported maximum (100)'
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Adversarial / overflow base — RampError, never throw.
// ---------------------------------------------------------------------------

describe('generateRamp — adversarial base inputs are RampError, never throw', () => {
  it.each([
    ['oklch(0.5 1e400 30)'], // parse-accepted-then-overflows → Infinity chroma
    ['not-a-color'],
    [''],
    ['oklch(NaN 0.2 30)'],
  ])('%s → RampError, no throw', (input) => {
    let r: ReturnType<typeof generateRamp> | undefined;
    expect(() => {
      r = generateRamp(input, 5);
    }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// OUT-1 — display rounding: oklch l/c 5dp, h 2dp, ratios 2dp (matching the
// sibling convert_color / contrast tools). Tiers still come from the RAW
// pre-rounding ratios inside the lib (boundary behavior covered by the
// toRampTier table above).
// ---------------------------------------------------------------------------

describe('generateRamp — display rounding (OUT-1)', () => {
  it('every swatch reports l/c at 5dp, h at 2dp, and ratios at 2dp', () => {
    const r = expectOk(generateRamp('#3b82f6', 7));
    for (const sw of r.swatches) {
      expect(sw.oklch.l, `l=${sw.oklch.l}`).toBe(Math.round(sw.oklch.l * 1e5) / 1e5);
      expect(sw.oklch.c, `c=${sw.oklch.c}`).toBe(Math.round(sw.oklch.c * 1e5) / 1e5);
      expect(sw.oklch.h, `h=${sw.oklch.h}`).toBe(Math.round(sw.oklch.h * 100) / 100);
      expect(sw.vsWhite.ratio).toBe(Math.round(sw.vsWhite.ratio * 100) / 100);
      expect(sw.vsBlack.ratio).toBe(Math.round(sw.vsBlack.ratio * 100) / 100);
    }
  });
});

// ---------------------------------------------------------------------------
// TOKENS — design-token formatting (lib formatter + tool plumbing + schema).
// ---------------------------------------------------------------------------

describe('formatRampTokens — design tokens', () => {
  it('steps=11 tailwind uses the canonical 50..950 scale (lightest swatch = 50)', () => {
    const r = expectOk(generateRamp('#3b82f6', 11));
    expect(formatRampTokens(r.swatches, 'tailwind', 'blue')).toMatchInlineSnapshot(`
      "{
        "blue": {
          "50": "#f5f5f5",
          "100": "#c1d8fe",
          "200": "#8fbaff",
          "300": "#629bfa",
          "400": "#3b82f6",
          "500": "#155ecf",
          "600": "#0043ab",
          "700": "#002b80",
          "800": "#001750",
          "900": "#000721",
          "950": "#000000"
        }
      }"
    `);
  });

  it('css-variables emits a :root block with one --<name>-<key>: <hex>; line per swatch', () => {
    const r = expectOk(generateRamp('#3b82f6', 3));
    const css = formatRampTokens(r.swatches, 'css-variables', 'brand');
    expect(css.startsWith(':root {\n')).toBe(true);
    expect(css.endsWith('\n}')).toBe(true);
    const lines = css.split('\n').slice(1, -1);
    expect(lines).toHaveLength(3);
    lines.forEach((line, i) => {
      // Non-11-step ramps key by the 0-based step index.
      expect(line).toMatch(new RegExp(`^  --brand-${i}: #[0-9a-f]{6};$`));
    });
  });

  it('tokenName defaults to "color" (lib formatter and tool)', () => {
    const r = expectOk(generateRamp('#3b82f6', 3));
    expect(formatRampTokens(r.swatches, 'css-variables')).toContain('--color-0:');

    const res = generateRampTool({ base: '#3b82f6', steps: 3, tokenFormat: 'tailwind' });
    expect(res.isError).not.toBe(true);
    const tokens = (res.structuredContent as { tokens?: string }).tokens;
    expect(tokens).toBeDefined();
    const parsed = JSON.parse(tokens as string) as Record<string, Record<string, string>>;
    expect(Object.keys(parsed)).toEqual(['color']);
    expect(Object.keys(parsed['color'])).toEqual(['0', '1', '2']);
  });

  it('tokens is ABSENT from the tool output when tokenFormat is not supplied', () => {
    const res = generateRampTool({ base: '#3b82f6', steps: 3 });
    expect(res.isError).not.toBe(true);
    expect((res.structuredContent as Record<string, unknown>).tokens).toBeUndefined();
  });

  it('tokenName schema regex rejects spaces/braces and enforces 1..64 length', () => {
    for (const bad of ['has space', '{braces}', 'brand{500}', '1starts-with-digit', '-leading-hyphen', '']) {
      expect(
        generateRampInput.tokenName.safeParse(bad).success,
        `"${bad}" must be rejected`
      ).toBe(false);
    }
    expect(generateRampInput.tokenName.safeParse('a'.repeat(65)).success).toBe(false);
    for (const good of ['color', 'brand', 'my-Brand-2', 'a'.repeat(64)]) {
      expect(
        generateRampInput.tokenName.safeParse(good).success,
        `"${good}" must be accepted`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// BASE-PRESENCE regression — deltaL mode CENTERS the ramp on the base L
// (endpoints at base L ± deltaL/2), so with ODD steps the middle swatch is the
// base-presence anchor; because the guarded mapper returns already-in-gamut
// colors unchanged (the gamut_map pass-through invariant), an in-gamut base
// must reappear VERBATIM among the swatch hexes.
// ---------------------------------------------------------------------------

describe('generateRamp — in-gamut base appears verbatim (deltaL anchor)', () => {
  it('"#00ffff" with steps=5 and deltaL=0.1 contains #00ffff as the middle swatch hex', () => {
    const r = expectOk(generateRamp('#00ffff', 5, { deltaL: 0.1 }));
    const hexes = r.swatches.map((s) => s.hex);
    expect(hexes).toContain('#00ffff');
    // Odd steps + deltaL-centered range → the anchor is exactly the middle step.
    expect(r.swatches[2].hex).toBe('#00ffff');
  });
});
