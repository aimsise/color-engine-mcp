import { describe, it, expect } from 'vitest';
// oracleOklch = the INDEPENDENT colorjs.io oracle, shared with parse_color.test.ts
// via tests/helpers/oracle.ts (single source of truth).
import { oracleOklch } from './helpers/oracle.js';
import { convertColor } from '../src/lib/color/convert.js';
import { convertColorTool } from '../src/tools/convert_color.js';
import { parseColor } from '../src/lib/color/parse.js';
import { parseColorTool } from '../src/tools/parse_color.js';

const TOL = 1e-4;

describe('AC-3 convert_color #ff0000 → oklch string, round-trips to exact hex', () => {
  it('intermediate raw OKLCH of #ff0000 matches colorjs.io ≤ 1e-4 (non-circular)', () => {
    // Cross-check the intermediate value BEFORE trusting the round-trip, so the
    // round-trip is not a self-confirming culori-vs-culori path.
    const p = parseColor('#ff0000');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const o = oracleOklch('#ff0000');
    expect(o.h).not.toBeNull();
    expect(Math.abs(p.oklch.l - o.l)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(p.oklch.c - o.c)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(p.oklch.h - (o.h as number))).toBeLessThanOrEqual(TOL);
  });

  it('returns an oklch(...) string that parses back to #ff0000 exactly', () => {
    const conv = convertColor('#ff0000', 'oklch');
    expect(conv.ok).toBe(true);
    if (!conv.ok) return;
    expect(conv.result).toMatch(/^oklch\(/);

    const back = parseColor(conv.result);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.hex).toBe('#ff0000');
  });
});

describe('convert_color canonical formats', () => {
  it('hex / rgb / oklch / hsl have the documented canonical shapes', () => {
    expect(convertColor('#ff0000', 'hex')).toEqual({ ok: true, result: '#ff0000' });
    expect(convertColor('#ff0000', 'rgb')).toEqual({ ok: true, result: 'rgb(255, 0, 0)' });

    const oklch = convertColor('#ff0000', 'oklch');
    expect(oklch.ok).toBe(true);
    // L & C are 5dp (raised from 4dp for cube-wide round-trip exactness, AC-3);
    // H stays 2dp.
    if (oklch.ok) expect(oklch.result).toMatch(/^oklch\(\d\.\d{5} \d\.\d{5} \d+\.\d{2}\)$/);

    const hsl = convertColor('#ff0000', 'hsl');
    expect(hsl.ok).toBe(true);
    if (hsl.ok) expect(hsl.result).toBe('hsl(0.00, 100.00%, 50.00%)');
  });
});

describe('AC-3 round-trip property fuzz (oklch ↔ hex), regression-guarded', () => {
  // The AC-3 round-trip invariant: for EVERY sRGB color, convert_color(hex,'oklch')
  // → parse_color must return the BYTE-IDENTICAL hex. The old format used 4dp for
  // L/C, which lost enough precision that ~0.08% of sRGB colors (13616/16.7M, e.g.
  // "#00ccdd") landed off-by-one on an RGB channel after the inverse — a real
  // correctness defect. The original single-fixed-seed fuzz (seed 0x9e3779b9 / 200
  // samples) passed only by luck. This suite hardens that two ways, both fully
  // deterministic (no Math.random / no time-based seed):
  //   (a) a dense deterministic GRID sweep that DETERMINISTICALLY hits the failure
  //       band, and
  //   (b) a ≥50-seed PRNG sweep, so a lucky seed cannot mask a regression.
  // Both assert EXACT round-trip and BOTH fail at the old 4dp precision (genuine
  // regression guards).

  const hexOf = (r: number, g: number, b: number): string =>
    '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

  function assertRoundTrip(hex: string): void {
    const conv = convertColor(hex, 'oklch');
    expect(conv.ok).toBe(true);
    if (!conv.ok) return;
    const back = parseColor(conv.result);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.hex).toBe(hex);
  }

  it('(a) dense deterministic grid sweep across the sRGB cube → exact round-trip', () => {
    // Every 13th value per channel (20 steps/channel → 8000 fixed points). step=13
    // is coprime with 256 so the lattice is not axis-aligned with any periodicity,
    // AND it deterministically includes the cyan/teal failure band (e.g. r=0,
    // g∈{...,143,156,...}, b∈{...,208,221,...}) where 4dp breaks. The set of points
    // is fixed (independent of any RNG), so the test is fully reproducible.
    let count = 0;
    for (let r = 0; r < 256; r += 13) {
      for (let g = 0; g < 256; g += 13) {
        for (let b = 0; b < 256; b += 13) {
          assertRoundTrip(hexOf(r, g, b));
          count++;
        }
      }
    }
    // Sanity: the grid is non-trivially large (20^3 = 8000 points).
    expect(count).toBe(20 * 20 * 20);
  });

  it('(b) the documented 4dp-failing color #00ccdd round-trips exactly (point regression guard)', () => {
    // This exact color was the audit-cited 4dp failure: at 4dp it parsed back to
    // "#01ccdd". It MUST round-trip exactly at the new precision.
    assertRoundTrip('#00ccdd');
  });

  it('(c) ≥50 deterministic seeds × random colors → exact round-trip (no lucky-seed masking)', () => {
    // Deterministic mulberry32 PRNG — reproducible, no external dep, no Math.random.
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

    const SEEDS = 60; // ≥50 fixed seeds; ~16% of seeds would have caught the 4dp bug.
    const PER_SEED = 80;
    for (let s = 0; s < SEEDS; s++) {
      // Fixed, deterministic seed schedule derived from a constant offset.
      const rnd = mulberry32((0x9e3779b9 + s * 0x85ebca6b) >>> 0);
      for (let i = 0; i < PER_SEED; i++) {
        const r = Math.floor(rnd() * 256);
        const g = Math.floor(rnd() * 256);
        const b = Math.floor(rnd() * 256);
        assertRoundTrip(hexOf(r, g, b));
      }
    }
  });
});

describe('AC-7 convert_color malformed input → isError (black-box)', () => {
  for (const to of ['hex', 'rgb', 'hsl', 'oklch'] as const) {
    it(`"not-a-color" → ${to} → { isError: true }`, () => {
      const res = convertColorTool('not-a-color', to);
      expect(res.isError).toBe(true);
      expect(res.structuredContent).toBeUndefined();
    });
  }
});

describe('AC-8 convert_color adversarial → isError OR finite, < 500 ms', () => {
  const cases: Array<{ input: string; to: 'hex' | 'oklch' }> = [
    { input: 'oklch(0.5 1e400 30)', to: 'hex' },
    { input: 'oklch(Infinity 0.2 30)', to: 'oklch' },
  ];
  for (const { input, to } of cases) {
    it(
      `{ "${input}", "${to}" } → isError OR finite-component result`,
      () => {
        const res = convertColorTool(input, to);
        if (res.isError) {
          expect(res.isError).toBe(true);
        } else {
          const sc = res.structuredContent as { result: string };
          // A successful result must contain no non-finite tokens.
          expect(sc.result).not.toMatch(/NaN|Infinity/);
        }
      },
      500
    );
  }
});

describe('AC-4 process resilience: handlers never throw / exit', () => {
  it('parse_color + convert_color tolerate garbage without unhandled rejection', () => {
    const garbage = ['', 'not-a-color', '#12', 'oklch(0.5 1e400 30)'];
    for (const g of garbage) {
      expect(() => parseColorTool(g)).not.toThrow();
      expect(() => convertColorTool(g, 'hex')).not.toThrow();
    }
  });
});
