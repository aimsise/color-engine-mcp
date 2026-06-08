import { describe, it, expect } from 'vitest';
// oracleOklch = the INDEPENDENT colorjs.io oracle, shared with convert_color.test.ts
// via tests/helpers/oracle.ts (single source of truth — see that file for the
// oracle-independence rationale).
import { oracleOklch } from './helpers/oracle.js';
import { parseColor } from '../src/lib/color/parse.js';
import { parseColorTool } from '../src/tools/parse_color.js';

const TOL = 1e-4;

describe('AC-1 parse_color("#1A2B3C") exact fields + colorjs.io oracle', () => {
  const r = parseColor('#1A2B3C');

  it('produces exact hex / integer rgb / inGamut', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hex).toBe('#1a2b3c');
    expect(r.rgb).toEqual({ r: 26, g: 43, b: 60 });
    expect(r.inGamut).toBe(true);
    // l within the unit interval (AC-1) — the oracle test below carries the
    // real verification load; this is the AC-mandated range bound.
    // Non-extremum lower bound tied to the oracle (l≈0.2826 for #1A2B3C).
    expect(r.oklch.l).toBeGreaterThan(0.2);
    expect(r.oklch.l).toBeLessThanOrEqual(1);
  });

  it('raw OKLCH matches colorjs.io within 1e-4 (RAW, pre-rounding)', () => {
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const o = oracleOklch('#1A2B3C');
    expect(o.h).not.toBeNull();
    expect(Math.abs(r.oklch.l - o.l)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(r.oklch.c - o.c)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(r.oklch.h - (o.h as number))).toBeLessThanOrEqual(TOL);
  });
});

describe('AC-2 accepts multiple formats; canonical-equality invariant', () => {
  it('accepts rgb(...), #abc, and oklch(...) strings', () => {
    expect(parseColor('rgb(26,43,60)').ok).toBe(true);
    expect(parseColor('#abc').ok).toBe(true);
    expect(parseColor('oklch(0.6 0.18 27)').ok).toBe(true);
  });

  it('genuinely-equivalent inputs yield identical hex (EC-PROPERTY)', () => {
    // Build the oklch() string from the SAME color #1a2b3c so all three inputs
    // truly denote it (non-vacuous canonical equality).
    const base = parseColor('#1a2b3c');
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const oklchStr = `oklch(${base.oklch.l} ${base.oklch.c} ${base.oklch.h})`;

    const fromRgb = parseColor('rgb(26,43,60)');
    const fromHex = parseColor('#1a2b3c');
    const fromOklch = parseColor(oklchStr);
    expect(fromRgb.ok && fromHex.ok && fromOklch.ok).toBe(true);
    if (!fromRgb.ok || !fromHex.ok || !fromOklch.ok) return;

    expect(fromRgb.hex).toBe('#1a2b3c');
    expect(fromHex.hex).toBe('#1a2b3c');
    expect(fromOklch.hex).toBe('#1a2b3c');
    // All three equal each other (transitively) — the canonical-equality property.
    expect(fromRgb.hex).toBe(fromOklch.hex);
    expect(fromHex.hex).toBe(fromOklch.hex);
  });

  it('does NOT collapse distinct colors (#abc = #aabbcc ≠ #1a2b3c)', () => {
    const abc = parseColor('#abc');
    const target = parseColor('#1a2b3c');
    expect(abc.ok && target.ok).toBe(true);
    if (!abc.ok || !target.ok) return;
    expect(abc.hex).toBe('#aabbcc');
    expect(abc.hex).not.toBe(target.hex);
  });
});

describe('AC-4 malformed inputs → isError (black-box handler)', () => {
  for (const bad of ['not-a-color', '', '#12']) {
    it(`"${bad}" → { isError: true }, no throw / no exit`, () => {
      const res = parseColorTool(bad);
      expect(res.isError).toBe(true);
      expect(res.structuredContent).toBeUndefined();
    });
  }
});

describe('AC-5 adversarial / overflow → isError OR finite, < 500 ms', () => {
  const vectors = [
    'oklch(0.5 1e400 30)', // parse-ACCEPTED-then-overflows chroma (Infinity)
    'oklch(NaN 0.2 30)',
    'oklch(Infinity 0.2 30)',
    'oklch(0.5 0.2 Infinity)',
  ];
  for (const v of vectors) {
    it(
      `"${v}" → isError OR all-finite OKLCH`,
      () => {
        const res = parseColorTool(v);
        if (res.isError) {
          expect(res.isError).toBe(true);
        } else {
          // If it succeeded, every OKLCH component MUST be finite.
          const sc = res.structuredContent as {
            oklch: { l: number; c: number; h: number };
          };
          expect(Number.isFinite(sc.oklch.l)).toBe(true);
          expect(Number.isFinite(sc.oklch.c)).toBe(true);
          expect(Number.isFinite(sc.oklch.h)).toBe(true);
        }
      },
      500
    );
  }

  it('finite-value guard lives in src/lib/color/parse.ts (overflow → ok:false)', () => {
    const r = parseColor('oklch(0.5 1e400 30)');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/non-finite/);
  });
});

describe('AC-9 oklch object shape + achromatic special case', () => {
  it('non-achromatic #1A2B3C: keys {l,c,h}, l∈[0,1], c≥0, h finite in [0,360)', () => {
    const r = parseColor('#1A2B3C');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.oklch).sort()).toEqual(['c', 'h', 'l']);
    expect(typeof r.oklch.l).toBe('number');
    expect(typeof r.oklch.c).toBe('number');
    expect(typeof r.oklch.h).toBe('number');
    // Non-extremum lower bound tied to the oracle (l≈0.2826 for #1A2B3C).
    expect(r.oklch.l).toBeGreaterThan(0.2);
    expect(r.oklch.l).toBeLessThanOrEqual(1);
    // c > 1e-4 → non-achromatic → h must be finite and in [0, 360).
    expect(r.oklch.c).toBeGreaterThan(1e-4);
    expect(Number.isFinite(r.oklch.h)).toBe(true);
    // Hue band around the oracle (h≈249.34 for #1A2B3C); keep the AC-9 [0,360)
    // upper bound so the range intent is preserved.
    expect(r.oklch.h).toBeCloseTo(249.34, 1);
    expect(r.oklch.h).toBeLessThan(360);
    // Oracle cross-check (same fixture, RAW values) — reuses AC-1 oracle.
    const o = oracleOklch('#1A2B3C');
    expect(Math.abs(r.oklch.l - o.l)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(r.oklch.c - o.c)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(r.oklch.h - (o.h as number))).toBeLessThanOrEqual(TOL);
  });

  it('achromatic #808080: chroma ≈ 0, no false error, l matches oracle', () => {
    const r = parseColor('#808080');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // colorjs.io reports h = null for grey (achromatic); culori reports c ≈ 0.
    const o = oracleOklch('#808080');
    expect(o.h).toBeNull();
    expect(r.oklch.c).toBeLessThanOrEqual(1e-4);
    expect(Number.isFinite(r.oklch.h)).toBe(true); // 0 fallback, satisfies schema
    expect(Math.abs(r.oklch.l - o.l)).toBeLessThanOrEqual(TOL);
  });
});
