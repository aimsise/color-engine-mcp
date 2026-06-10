import { describe, it, expect } from 'vitest';
// oracleOklch = the INDEPENDENT colorjs.io oracle, shared with convert_color.test.ts
// via tests/helpers/oracle.ts (single source of truth — see that file for the
// oracle-independence rationale).
import { oracleOklch } from './helpers/oracle.js';
import { parseColor } from '../src/lib/color/parse.js';
import { parseColorTool } from '../src/tools/parse_color.js';
// CSS-NONE cross-tool regression imports — the none→0 normalization lives at
// the SHARED parse boundary, so its regression block exercises every tool
// routed through parseColor (gamut_map normalizes none → 0 itself).
import { convertColorTool } from '../src/tools/convert_color.js';
import { contrastTool } from '../src/tools/contrast.js';
import { generateRampTool } from '../src/tools/generate_ramp.js';
import { solveTool } from '../src/tools/solve_for_contrast.js';
import { gamutMapColor } from '../src/lib/color/gamut.js';

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

  // SEC-3: the error text is the static PARSE_FAILED code and NEVER echoes the
  // raw user input (the old template embedded the verbatim string).
  it('parse-fail error is the static PARSE_FAILED code, no raw-input echo (SEC-3)', () => {
    const sentinel = 'totally-not-a-color-zzz';
    const r = parseColor(sentinel);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('PARSE_FAILED: could not parse the provided color string');
    // The raw input must not appear anywhere in the returned message.
    expect(r.error).not.toContain(sentinel);
    expect(r.error).toMatch(/^[A-Z][A-Z0-9_]*: /);

    // The tool forwards that exact code string verbatim as content[0].text.
    const res = parseColorTool(sentinel);
    expect(res.isError).toBe(true);
    const text =
      res.content?.[0]?.type === 'text'
        ? (res.content[0] as { type: string; text: string }).text
        : '';
    expect(text).toBe('PARSE_FAILED: could not parse the provided color string');
    expect(text).not.toContain(sentinel);
  });
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
    // SEC-3 / uniform error contract: the error is now a full "<CODE>: msg" string
    // with the closed-set NON_FINITE_COMPONENTS code (no raw-input echo).
    expect(r.error).toBe('NON_FINITE_COMPONENTS: color resolved to non-finite components');
    expect(r.error).toMatch(/^[A-Z][A-Z0-9_]*: /);
  });
});

describe('CE-1 wide-gamut CSS inputs parse (modes registered in src/init.ts)', () => {
  const WIDE_GAMUT_INPUTS = [
    'color(display-p3 1 0 0)',
    'lab(50% 40 59.5)',
    'lch(52.2% 72.2 50)',
    'oklab(0.59 0.1 0.12)',
    'hwb(194 0% 0%)',
    'color(rec2020 0.6 0.3 0.2)',
    'color(a98-rgb 1 0 0)',
    'color(xyz-d65 0.4 0.2 0.1)',
  ];

  for (const input of WIDE_GAMUT_INPUTS) {
    it(`parseColor("${input}") → ok with finite OKLCH, valid hex, valid rgb ints`, () => {
      const r = parseColor(input);
      expect(r.ok, `expected ok for ${input}, got ${JSON.stringify(r)}`).toBe(true);
      if (!r.ok) return;
      expect(r.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(Number.isFinite(r.oklch.l)).toBe(true);
      expect(Number.isFinite(r.oklch.c)).toBe(true);
      expect(Number.isFinite(r.oklch.h)).toBe(true);
      for (const ch of [r.rgb.r, r.rgb.g, r.rgb.b]) {
        expect(Number.isInteger(ch)).toBe(true);
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
      }
      expect(typeof r.inGamut).toBe('boolean');
    });

    it(`parseColorTool("${input}") → structured success (no isError)`, () => {
      const res = parseColorTool(input);
      expect(res.isError, `tool must accept ${input}`).toBeFalsy();
      expect(res.structuredContent).toBeDefined();
    });
  }

  it('color(display-p3 1 0 0) is wider than sRGB → inGamut:false, accurate OKLCH', () => {
    const r = parseColor('color(display-p3 1 0 0)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inGamut).toBe(false);
    // Raw OKLCH of P3 red (oracle-grounded: l≈0.6486, c≈0.2995, h≈28.96).
    expect(r.oklch.l).toBeCloseTo(0.6486, 3);
    expect(r.oklch.c).toBeCloseTo(0.2995, 3);
    expect(r.oklch.h).toBeCloseTo(28.96, 1);
  });

  it('hwb(194 0% 0%) is inside sRGB → inGamut:true with exact rgb projection', () => {
    const r = parseColor('hwb(194 0% 0%)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.inGamut).toBe(true);
    expect(r.hex).toBe('#00c3ff');
    expect(r.rgb).toEqual({ r: 0, g: 195, b: 255 });
  });
});

describe('CE-7 leading/trailing whitespace is trimmed before parsing', () => {
  it('" #fff " parses (trim precedes the length check)', () => {
    const r = parseColor(' #fff ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hex).toBe('#ffffff');
  });

  it('tab/newline-padded rgb() parses to the same canonical hex as the bare string', () => {
    const padded = parseColor('\n\t rgb(26,43,60) \t\n');
    const bare = parseColor('rgb(26,43,60)');
    expect(padded.ok && bare.ok).toBe(true);
    if (!padded.ok || !bare.ok) return;
    expect(padded.hex).toBe(bare.hex);
  });

  it('tool path: parseColorTool(" #fff ") → structured success', () => {
    const res = parseColorTool(' #fff ');
    expect(res.isError).toBeFalsy();
    expect((res.structuredContent as { hex: string }).hex).toBe('#ffffff');
  });

  it('whitespace-only input still fails with PARSE_FAILED', () => {
    const r = parseColor('   ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('PARSE_FAILED: could not parse the provided color string');
  });
});

describe('CE-4 CSS Color 4 clamping at the parse boundary (rgb/hsl ONLY)', () => {
  it('rgb(-50 0 0) behaves as rgb(0 0 0): rgb {0,0,0}, OKLCH L >= 0', () => {
    const r = parseColor('rgb(-50 0 0)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rgb).toEqual({ r: 0, g: 0, b: 0 });
    expect(r.hex).toBe('#000000');
    expect(r.oklch.l).toBeGreaterThanOrEqual(0);
    expect(r.inGamut).toBe(true);
  });

  it('rgb(300 0 0) behaves as rgb(255 0 0)', () => {
    const r = parseColor('rgb(300 0 0)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hex).toBe('#ff0000');
    expect(r.rgb).toEqual({ r: 255, g: 0, b: 0 });
    expect(r.inGamut).toBe(true);
  });

  it('hsl(200 150% 50%) clamps saturation to 100%', () => {
    const over = parseColor('hsl(200 150% 50%)');
    const ref = parseColor('hsl(200 100% 50%)');
    expect(over.ok && ref.ok).toBe(true);
    if (!over.ok || !ref.ok) return;
    expect(over.hex).toBe(ref.hex);
    expect(over.inGamut).toBe(true);
  });

  it('hsl(200 -10% 50%) clamps saturation to 0%', () => {
    const under = parseColor('hsl(200 -10% 50%)');
    const ref = parseColor('hsl(200 0% 50%)');
    expect(under.ok && ref.ok).toBe(true);
    if (!under.ok || !ref.ok) return;
    expect(under.hex).toBe(ref.hex);
  });

  it('CRITICAL: out-of-gamut oklch() input is NOT clamped (keeps raw chroma, inGamut:false)', () => {
    const r = parseColor('oklch(0.7 0.25 30)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Raw parsed components flow through untouched — gamut_map depends on this.
    expect(r.oklch.l).toBeCloseTo(0.7, 9);
    expect(r.oklch.c).toBeCloseTo(0.25, 9);
    expect(r.oklch.h).toBeCloseTo(30, 6);
    expect(r.inGamut).toBe(false);
  });
});

describe('CE-6 absurd-magnitude finite components → typed COMPONENT_OUT_OF_RANGE', () => {
  const ABSURD = [
    'oklch(0.5 1e30 30)', //   huge chroma
    'lab(50% 1e30 0)', //      huge lab a
    'lab(50% 0 1e30)', //      huge lab b
    'oklch(0.5 0.1 1e30)', //  huge hue
    'color(xyz-d65 1e30 0 0)', // huge xyz x
  ];

  for (const input of ABSURD) {
    it(`parseColor("${input}") → ok:false with COMPONENT_OUT_OF_RANGE (not INTERNAL_ERROR)`, () => {
      const r = parseColor(input);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toBe(
        'COMPONENT_OUT_OF_RANGE: color component magnitude exceeds the supported range'
      );
      expect(r.error).toMatch(/^[A-Z][A-Z0-9_]*: /);
      // SEC-3: no raw-input echo.
      expect(r.error).not.toContain('1e30');
    });

    it(`parseColorTool("${input}") forwards COMPONENT_OUT_OF_RANGE verbatim`, () => {
      const res = parseColorTool(input);
      expect(res.isError).toBe(true);
      const text =
        res.content?.[0]?.type === 'text'
          ? (res.content[0] as { type: string; text: string }).text
          : '';
      expect(text).toBe(
        'COMPONENT_OUT_OF_RANGE: color component magnitude exceeds the supported range'
      );
      expect(text).not.toContain('INTERNAL_ERROR');
    });
  }

  it('numeric overflow to Infinity keeps the NON_FINITE_COMPONENTS code (CE-6 does not absorb it)', () => {
    // 1e400 overflows the float64 token to Infinity — NOT finite, so the CE-6
    // magnitude guard skips it and the non-finite guard still owns it.
    for (const input of ['oklch(0.5 1e400 30)', 'lab(50% 1e400 0)']) {
      const r = parseColor(input);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error).toBe('NON_FINITE_COMPONENTS: color resolved to non-finite components');
    }
  });

  it('legitimate wide-gamut / out-of-gamut inputs are NOT rejected by the magnitude guard', () => {
    for (const input of ['oklch(0.7 0.25 30)', 'lab(50% 40 59.5)', 'color(display-p3 1 0 0)']) {
      expect(parseColor(input).ok, `${input} must still parse`).toBe(true);
    }
  });

  it('CSS-clamped legacy modes are clamped BEFORE the magnitude guard (rgb(1e30 0 0) = red)', () => {
    const r = parseColor('rgb(1e30 0 0)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hex).toBe('#ff0000');
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

// ---------------------------------------------------------------------------
// CSS-NONE — `none` channels normalize to 0 at the SHARED parse boundary.
// Regression (live-verifier blocker): culori parses a `none` token as a MISSING
// field, and a SAME-mode "conversion" (toRgb on an already-rgb object) is an
// identity that never fills the gap, so `rgb(255 none 0)` previously tripped
// the finite-RGB guard (NON_FINITE_COMPONENTS) in every tool routed through
// parseColor, while gamut_map (which normalizes none → 0 itself in
// gamutMapColor) accepted it — an inconsistency across the six tools.
// ---------------------------------------------------------------------------

describe('CSS-NONE — rgb-mode none channels normalize to 0 at the shared parse boundary', () => {
  it('parseColor("rgb(255 none 0)") → ok, #ff0000, in gamut — behaves as rgb(255 0 0)', () => {
    const r = parseColor('rgb(255 none 0)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hex).toBe('#ff0000');
    expect(r.rgb).toEqual({ r: 255, g: 0, b: 0 });
    expect(r.inGamut).toBe(true);
  });

  it('hex is consistent with gamut_map for the same none-input (the blocker repro)', () => {
    const p = parseColor('rgb(255 none 0)');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const g = gamutMapColor('rgb(255 none 0)');
    expect(g.hex).toBe(p.hex);
    expect(g.hex).toBe('#ff0000');
    expect(g.clamped).toBe(false);
  });

  it('other same-mode none variants parse as 0: hsl(none 50% 50%) → #bf4040, lab/oklch ok', () => {
    const hsl = parseColor('hsl(none 50% 50%)');
    expect(hsl.ok).toBe(true);
    if (!hsl.ok) return;
    expect(hsl.hex).toBe('#bf4040'); // identical to hsl(0 50% 50%)
    expect(parseColor('lab(50 none 40)').ok).toBe(true);
    expect(parseColor('oklch(0.5 0.2 none)').ok).toBe(true);
  });

  it('out-of-gamut none input oklch(none 0.2 30): channel-clamped projection, inGamut:false', () => {
    // none lightness behaves as l:0 → oklch(0 0.2 30) is OUT of sRGB gamut.
    // parse_color reports the raw channel-clamped projection (its documented
    // out-of-gamut handling); gamut_map perceptually maps the same input to
    // #000000 — the hexes legitimately differ, as for any out-of-gamut color.
    const r = parseColor('oklch(none 0.2 30)');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hex).toBe('#080000');
    expect(r.inGamut).toBe(false);
  });

  it('missing alpha is NOT normalized to 0 — absent alpha means opaque, not transparent', () => {
    // If the none-fill wrongly zeroed alpha, the CE-3 translucency guard would
    // reject every alpha-less color in contrast/solve_for_contrast.
    const res = contrastTool('rgb(255 none 0)', '#ffffff');
    expect(res.isError, 'opaque none-input must not trip ALPHA_UNSUPPORTED').toBeFalsy();
    // ...and an EXPLICIT translucent alpha still trips it.
    const translucent = contrastTool('rgb(255 0 0 / 0.5)', '#ffffff');
    expect(translucent.isError).toBe(true);
  });

  it('all five parseColor-routed tools accept rgb(255 none 0) (cross-tool consistency)', () => {
    expect(parseColorTool('rgb(255 none 0)').isError, 'parse_color').toBeFalsy();
    const conv = convertColorTool('rgb(255 none 0)', 'hex');
    expect(conv.isError, 'convert_color').toBeFalsy();
    expect((conv.structuredContent as { result: string }).result).toBe('#ff0000');
    expect(contrastTool('rgb(255 none 0)', '#ffffff').isError, 'contrast').toBeFalsy();
    expect(generateRampTool({ base: 'rgb(255 none 0)', steps: 3 }).isError, 'generate_ramp').toBeFalsy();
    expect(
      solveTool({ background: 'rgb(255 none 0)', target: 4.5 }).isError,
      'solve_for_contrast'
    ).toBeFalsy();
  });
});
