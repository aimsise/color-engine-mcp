/**
 * tests/ramp.test.ts — pure-function unit tests for `generateRamp` / `toRampTier`.
 *
 * These exercise the lib layer (no MCP wrapper): monotonicity on RAW floats, the
 * sin chroma-curve shape, base-presence, the achromatic gray ramp, the declared
 * step contract (MIN=2 / MAX=512), and the `toRampTier` boundary table.
 *
 * ANTI-CIRCULARITY: lightness/chroma assertions use the RAW pre-rounding floats
 * the function returns, never a display-rounded value.
 */
import { describe, it, expect } from 'vitest';
import { generateRamp, toRampTier } from '../src/lib/color/ramp.js';

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
// Monotonic lightness on RAW floats.
// ---------------------------------------------------------------------------

describe('generateRamp — strictly decreasing raw lightness (tint → shade)', () => {
  for (const steps of [2, 3, 5, 7, 12]) {
    it(`steps=${steps}: oklch.l[i] > oklch.l[i+1] on unrounded floats`, () => {
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
