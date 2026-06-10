/**
 * tests/contrast.test.ts — dual-oracle harness for the WCAG 2.1 contrast tool.
 *
 * ORACLE 1 (first-principles, no library):
 *   wcagLinearize — exact WCAG 2.1 spec threshold 0.03928/12.92
 *   wcagRelLuminance — 0.2126·R + 0.7152·G + 0.0722·B on 0-255 channels
 *   wcagRatio — (max+0.05)/(min+0.05)
 *
 * ORACLE 2 (colorjs.io 0.6.1):
 *   new Color(css).contrastWCAG21(other) — independent implementation
 *
 * MUTUAL-VALIDATION PROTOCOL: for each AC-1/2/3/4 fixture, FIRST assert
 *   |oracle1 - oracle2| <= ORACLE_TOL, THEN assert the implementation output.
 *   If oracles disagree, the test fails with a diagnostic naming both values.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import Color from 'colorjs.io';
import { wcagContrastRaw, wcagTiers } from '../src/utils/contrast.js';
import { contrastTool } from '../src/tools/contrast.js';

// ---------------------------------------------------------------------------
// Oracle 1 — first-principles WCAG 2.1 (no library, test-only)
// ---------------------------------------------------------------------------

/** EXACT WCAG 2.1 spec threshold: 0.03928 / 12.92 */
function wcagLinearize(channel: number): number {
  const v = channel / 255;
  return v <= 0.03928 / 12.92 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function wcagRelLuminance(r: number, g: number, b: number): number {
  return 0.2126 * wcagLinearize(r) + 0.7152 * wcagLinearize(g) + 0.0722 * wcagLinearize(b);
}

function wcagRatio(L1: number, L2: number): number {
  const max = Math.max(L1, L2);
  const min = Math.min(L1, L2);
  return (max + 0.05) / (min + 0.05);
}

/** Parse a 6-char hex like '#rrggbb' into [r, g, b] 0-255 channels. */
function hexToChannels(hex: string): [number, number, number] {
  const s = hex.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function oracle1(a: string, b: string): number {
  const [ar, ag, ab] = hexToChannels(a);
  const [br, bg, bb] = hexToChannels(b);
  const La = wcagRelLuminance(ar, ag, ab);
  const Lb = wcagRelLuminance(br, bg, bb);
  return wcagRatio(La, Lb);
}

// ---------------------------------------------------------------------------
// Oracle 2 — colorjs.io 0.6.1 (independent implementation)
// ---------------------------------------------------------------------------

function oracle2(a: string, b: string): number {
  return new Color(a).contrastWCAG21(new Color(b)) as number;
}

// ---------------------------------------------------------------------------
// Helper: mutual-validation assertion (MUST pass before implementation trust)
// ---------------------------------------------------------------------------

const ORACLE_TOL = 0.005; // oracles must agree within 0.5%

function assertOraclesAgree(
  a: string,
  b: string,
  tol: number = ORACLE_TOL
): void {
  const o1 = oracle1(a, b);
  const o2 = oracle2(a, b);
  expect(
    Math.abs(o1 - o2),
    `Oracle disagreement for (${a}, ${b}): oracle1=${o1} oracle2=${o2}`
  ).toBeLessThanOrEqual(tol);
}

// ---------------------------------------------------------------------------
// BOUNDARY HEX CONSTANTS (resolved via first-principles binary search)
// These are the closest 8-bit #rrggbb grays to each WCAG threshold vs white.
// Straddling pairs (above / below) prove the correct flag TRANSITION.
//
// 3.0 threshold: #949494 → 3.033 (above), #959595 → 2.995 (below)
// 4.5 threshold: #767676 → 4.542 (above), #777777 → 4.478 (below)
// 7.0 threshold: #595959 → 7.005 (above), #5a5a5a → 6.897 (below)
// ---------------------------------------------------------------------------

const ABOVE_3 = '#949494'; // oracle1 ratio ≈ 3.033
const BELOW_3 = '#959595'; // oracle1 ratio ≈ 2.995
const ABOVE_4_5 = '#767676'; // oracle1 ratio ≈ 4.542
const BELOW_4_5 = '#777777'; // oracle1 ratio ≈ 4.478 (also the AC-3 color)
const ABOVE_7 = '#595959'; // oracle1 ratio ≈ 7.005
const BELOW_7 = '#5a5a5a'; // oracle1 ratio ≈ 6.897
const WHITE = '#ffffff';

// ---------------------------------------------------------------------------
// AC-1 — Black/White (21:1)
// ---------------------------------------------------------------------------

describe('AC-1 — black/white contrast ratio 21:1', () => {
  const a = '#000000';
  const b = '#ffffff';

  it('oracle1 and oracle2 agree within 0.005', () => {
    assertOraclesAgree(a, b);
  });

  it('raw ratio is in [20.995, 21.005]', () => {
    const raw = wcagContrastRaw(a, b);
    expect(raw).toBeGreaterThanOrEqual(20.995);
    expect(raw).toBeLessThanOrEqual(21.005);
  });

  it('raw ratio matches oracle1 within 0.005', () => {
    const raw = wcagContrastRaw(a, b);
    expect(Math.abs(raw - oracle1(a, b))).toBeLessThanOrEqual(0.005);
  });

  it('display ratio is 21.00', () => {
    const result = contrastTool(a, b);
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { ratio: number };
    expect(sc.ratio).toBe(21);
  });

  it('all four tier flags are true', () => {
    const raw = wcagContrastRaw(a, b);
    const tiers = wcagTiers(raw);
    expect(tiers.aaNormal).toBe(true);
    expect(tiers.aaLarge).toBe(true);
    expect(tiers.aaaNormal).toBe(true);
    expect(tiers.aaaLarge).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-2 — White/White (1:1)
// ---------------------------------------------------------------------------

describe('AC-2 — white/white contrast ratio 1:1', () => {
  const a = '#ffffff';
  const b = '#ffffff';

  it('oracle1 and oracle2 agree within 0.001', () => {
    assertOraclesAgree(a, b, 0.001);
  });

  it('raw ratio is in [0.9999, 1.0001]', () => {
    const raw = wcagContrastRaw(a, b);
    expect(raw).toBeGreaterThanOrEqual(0.9999);
    expect(raw).toBeLessThanOrEqual(1.0001);
  });

  it('display ratio is 1.00', () => {
    const result = contrastTool(a, b);
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { ratio: number };
    expect(sc.ratio).toBe(1);
  });

  it('all four tier flags are false', () => {
    const raw = wcagContrastRaw(a, b);
    const tiers = wcagTiers(raw);
    expect(tiers.aaNormal).toBe(false);
    expect(tiers.aaLarge).toBe(false);
    expect(tiers.aaaNormal).toBe(false);
    expect(tiers.aaaLarge).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Mid-gray (#777777) tier classification
// ---------------------------------------------------------------------------

describe('AC-3 — mid-gray #777777 vs white', () => {
  const a = '#777777';
  const b = '#ffffff';

  it('oracle1 and oracle2 agree within 0.01', () => {
    assertOraclesAgree(a, b, 0.01);
  });

  it('raw ratio is in [4.43, 4.53] (primary assertion on raw)', () => {
    const raw = wcagContrastRaw(a, b);
    expect(raw).toBeGreaterThanOrEqual(4.43);
    expect(raw).toBeLessThanOrEqual(4.53);
  });

  it('raw ratio matches oracle1 within 0.01', () => {
    const raw = wcagContrastRaw(a, b);
    expect(Math.abs(raw - oracle1(a, b))).toBeLessThanOrEqual(0.01);
  });

  it('tier flags: aaNormal=false, aaLarge=true, aaaNormal=false, aaaLarge=false', () => {
    const raw = wcagContrastRaw(a, b);
    const tiers = wcagTiers(raw);
    expect(tiers.aaNormal).toBe(false);
    expect(tiers.aaLarge).toBe(true);
    expect(tiers.aaaNormal).toBe(false);
    expect(tiers.aaaLarge).toBe(false);
  });

  it('display ratio is in [4.43, 4.53] (secondary display check)', () => {
    const result = contrastTool(a, b);
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { ratio: number };
    expect(sc.ratio).toBeGreaterThanOrEqual(4.43);
    expect(sc.ratio).toBeLessThanOrEqual(4.53);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — Tier boundary transitions (EC-PROPERTY + EC-ORACLE)
// Using straddling pairs: just-above / just-below each threshold.
// ---------------------------------------------------------------------------

describe('AC-4 — tier boundary: 3.0 (aaLarge transition)', () => {
  it('oracles agree for colors near 3.0 threshold', () => {
    assertOraclesAgree(ABOVE_3, WHITE, 0.01);
    assertOraclesAgree(BELOW_3, WHITE, 0.01);
  });

  it('ABOVE_3 (#949494, ratio≈3.033): aaLarge=T, aaNormal=F, aaaNormal=F, aaaLarge=F', () => {
    const raw = wcagContrastRaw(ABOVE_3, WHITE);
    expect(raw).toBeGreaterThan(3.0);
    const tiers = wcagTiers(raw);
    expect(tiers.aaLarge).toBe(true);
    expect(tiers.aaNormal).toBe(false);
    expect(tiers.aaaNormal).toBe(false);
    expect(tiers.aaaLarge).toBe(false);
  });

  it('BELOW_3 (#959595, ratio≈2.995): all flags false', () => {
    const raw = wcagContrastRaw(BELOW_3, WHITE);
    expect(raw).toBeLessThan(3.0);
    const tiers = wcagTiers(raw);
    expect(tiers.aaLarge).toBe(false);
    expect(tiers.aaNormal).toBe(false);
    expect(tiers.aaaNormal).toBe(false);
    expect(tiers.aaaLarge).toBe(false);
  });
});

describe('AC-4 — tier boundary: 4.5 (aaNormal + aaaLarge transition)', () => {
  it('oracles agree for colors near 4.5 threshold', () => {
    assertOraclesAgree(ABOVE_4_5, WHITE, 0.01);
    assertOraclesAgree(BELOW_4_5, WHITE, 0.01);
  });

  it('ABOVE_4_5 (#767676, ratio≈4.542): aaNormal=T, aaLarge=T, aaaNormal=F, aaaLarge=T', () => {
    const raw = wcagContrastRaw(ABOVE_4_5, WHITE);
    expect(raw).toBeGreaterThan(4.5);
    const tiers = wcagTiers(raw);
    expect(tiers.aaNormal).toBe(true);
    expect(tiers.aaLarge).toBe(true);
    expect(tiers.aaaNormal).toBe(false);
    expect(tiers.aaaLarge).toBe(true);
  });

  it('BELOW_4_5 (#777777, ratio≈4.478): only aaLarge=T', () => {
    const raw = wcagContrastRaw(BELOW_4_5, WHITE);
    expect(raw).toBeLessThan(4.5);
    const tiers = wcagTiers(raw);
    expect(tiers.aaNormal).toBe(false);
    expect(tiers.aaLarge).toBe(true);
    expect(tiers.aaaNormal).toBe(false);
    expect(tiers.aaaLarge).toBe(false);
  });
});

describe('AC-4 — tier boundary: 7.0 (aaaNormal transition)', () => {
  it('oracles agree for colors near 7.0 threshold', () => {
    assertOraclesAgree(ABOVE_7, WHITE, 0.01);
    assertOraclesAgree(BELOW_7, WHITE, 0.01);
  });

  it('ABOVE_7 (#595959, ratio≈7.005): all flags true', () => {
    const raw = wcagContrastRaw(ABOVE_7, WHITE);
    expect(raw).toBeGreaterThan(7.0);
    const tiers = wcagTiers(raw);
    expect(tiers.aaNormal).toBe(true);
    expect(tiers.aaLarge).toBe(true);
    expect(tiers.aaaNormal).toBe(true);
    expect(tiers.aaaLarge).toBe(true);
  });

  it('BELOW_7 (#5a5a5a, ratio≈6.897): aaNormal=T, aaLarge=T, aaaNormal=F, aaaLarge=T', () => {
    const raw = wcagContrastRaw(BELOW_7, WHITE);
    expect(raw).toBeLessThan(7.0);
    const tiers = wcagTiers(raw);
    expect(tiers.aaNormal).toBe(true);
    expect(tiers.aaLarge).toBe(true);
    expect(tiers.aaaNormal).toBe(false);
    expect(tiers.aaaLarge).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-5 — Symmetry invariant (EC-PROPERTY, ≥20 fixed-seed pairs)
// ---------------------------------------------------------------------------

describe('AC-5 — symmetry invariant (|raw(a,b) - raw(b,a)| <= 0.001)', () => {
  // 20+ fixed-seed pairs: black, white, mid-grays, saturated, near-boundary, combinations
  const pairs: [string, string][] = [
    ['#000000', '#ffffff'],
    ['#ffffff', '#000000'],
    ['#777777', '#ffffff'],
    ['#ffffff', '#777777'],
    ['#000000', '#777777'],
    ['#777777', '#000000'],
    ['#949494', '#ffffff'],
    ['#595959', '#ffffff'],
    ['#767676', '#ffffff'],
    ['#5a5a5a', '#ffffff'],
    ['#959595', '#ffffff'],
    ['#000000', '#949494'],
    ['#595959', '#949494'],
    ['#767676', '#595959'],
    ['#000000', '#595959'],
    ['#949494', '#595959'],
    ['#ffffff', '#595959'],
    ['#777777', '#595959'],
    ['#767676', '#777777'],
    ['#949494', '#767676'],
    ['#000000', '#767676'],
    ['#ffffff', '#949494'],
  ];

  it('has at least 20 pairs (EC-PROPERTY lower bound)', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(20);
  });

  for (const [a, b] of pairs) {
    it(`|raw(${a},${b}) - raw(${b},${a})| <= 0.001`, () => {
      const fwd = wcagContrastRaw(a, b);
      const rev = wcagContrastRaw(b, a);
      expect(Math.abs(fwd - rev)).toBeLessThanOrEqual(0.001);
    });
  }
});

// ---------------------------------------------------------------------------
// AC-6 — Adversarial / parse-overflow inputs
// ---------------------------------------------------------------------------

describe('AC-6 — adversarial inputs do not throw, return isError or finite ratio', () => {
  const adversarial: [string, string][] = [
    ['oklch(0.5 1e400 30)', '#ffffff'],   // Infinity chroma — parse-accepted overflow
    ['oklch(0.5 0 NaN)', '#ffffff'],      // NaN hue token
    ['#000000', 'oklch(2.0 0 0)'],       // lightness > 1, out-of-gamut
    ['', '#ffffff'],                      // empty string
    ['not-a-color', '#ffffff'],           // unparseable
  ];

  for (const [a, b] of adversarial) {
    it(`("${a}", "${b}") does not throw and returns isError or finite ratio`, () => {
      let result: ReturnType<typeof contrastTool> | undefined;
      expect(() => {
        result = contrastTool(a, b);
      }).not.toThrow();

      expect(result).toBeDefined();
      if (!result) return;

      const isErrorResult = result.isError === true;
      const hasFiniteRatio =
        result.structuredContent != null &&
        typeof (result.structuredContent as { ratio?: unknown }).ratio === 'number' &&
        Number.isFinite((result.structuredContent as { ratio: number }).ratio);

      expect(
        isErrorResult || hasFiniteRatio,
        `Expected isError:true or finite ratio but got: ${JSON.stringify(result)}`
      ).toBe(true);
    });
  }

  it('non-finite guard lives in src/utils/contrast.ts (sibling-guard, not tool-only)', () => {
    // Verify wcagContrastRaw itself throws ContrastError for a bad input, confirming
    // the guard is in the shared utility — future tools (generate_ramp, solve_for_contrast)
    // that call wcagContrastRaw will inherit this protection.
    expect(() => wcagContrastRaw('not-a-color', '#ffffff')).toThrow();
    expect(() => wcagContrastRaw('', '#ffffff')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-7 — MCP outputSchema structured content (EC-RUNTIME + EC-STATIC)
// ---------------------------------------------------------------------------

describe('AC-7 — outputSchema and structuredContent contract', () => {
  it('EC-RUNTIME: success returns structuredContent with all 5 typed fields', () => {
    const result = contrastTool('#000000', '#ffffff');
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).not.toBeNull();
    const sc = result.structuredContent as Record<string, unknown>;
    expect(typeof sc.ratio).toBe('number');
    expect(typeof sc.aaNormal).toBe('boolean');
    expect(typeof sc.aaLarge).toBe('boolean');
    expect(typeof sc.aaaNormal).toBe('boolean');
    expect(typeof sc.aaaLarge).toBe('boolean');
  });

  it('EC-RUNTIME: isError response does NOT include structuredContent', () => {
    const result = contrastTool('not-a-color', '#ffffff');
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it('EC-STATIC: outputSchema is present in src/tools/contrast.ts registerTool call', () => {
    const src = readFileSync('src/tools/contrast.ts', 'utf-8');
    expect(src).toContain('outputSchema');
    expect(src).toContain('registerTool');
    // Verify outputSchema appears within the same registerTool block
    const registerIdx = src.indexOf('registerTool');
    const outputSchemaIdx = src.indexOf('outputSchema');
    expect(registerIdx).toBeGreaterThanOrEqual(0);
    expect(outputSchemaIdx).toBeGreaterThanOrEqual(0);
    expect(outputSchemaIdx).toBeGreaterThan(registerIdx);
  });
});

// ---------------------------------------------------------------------------
// AC-8 — No network / no fs-write invariant (EC-STATIC)
// ---------------------------------------------------------------------------

describe('AC-8 — no network / no fs-write in production source', () => {
  it('EC-STATIC: src/utils/contrast.ts contains no fetch/http/fs.write', () => {
    const src = readFileSync('src/utils/contrast.ts', 'utf-8');
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/http\./);
    expect(src).not.toMatch(/fs\.write/);
    expect(src).not.toMatch(/require\(.*http/);
  });

  it('EC-STATIC: src/tools/contrast.ts contains no fetch/http/fs.write', () => {
    const src = readFileSync('src/tools/contrast.ts', 'utf-8');
    expect(src).not.toMatch(/fetch\(/);
    expect(src).not.toMatch(/http\./);
    expect(src).not.toMatch(/fs\.write/);
    expect(src).not.toMatch(/require\(.*http/);
  });
});

// ---------------------------------------------------------------------------
// Helper — extract the single text content of a CallToolResult
// ---------------------------------------------------------------------------

function resultText(result: ReturnType<typeof contrastTool>): string {
  return (result.content[0] as { type: 'text'; text: string }).text;
}

// ---------------------------------------------------------------------------
// CE-3 — translucent inputs rejected (ALPHA_UNSUPPORTED)
// A 10%-opacity color treated as opaque is dangerously wrong for accessibility:
// the effective color depends on the unknown backdrop. alpha exactly 1 is allowed.
// ---------------------------------------------------------------------------

const ALPHA_MSG =
  'ALPHA_UNSUPPORTED: contrast requires fully opaque colors (alpha = 1); composite the color over its backdrop first';

describe('CE-3 — translucent inputs are rejected with ALPHA_UNSUPPORTED', () => {
  const translucentCases: [string, string, string][] = [
    ['rgba(255 0 0 / 0.1)', '#ffffff', 'rgba functional alpha (foreground)'],
    ['#ff000080', '#ffffff', '8-digit hex alpha (foreground)'],
    ['#f00a', '#ffffff', '4-digit hex alpha (foreground)'],
    ['hsla(0, 100%, 50%, 0.3)', '#ffffff', 'hsla legacy alpha (foreground)'],
    ['#ffffff', 'rgba(0 0 0 / 0.5)', 'rgba functional alpha (background)'],
    ['#ffffff', '#00000080', '8-digit hex alpha (background)'],
  ];

  for (const [a, b, label] of translucentCases) {
    it(`${label}: isError with the exact static ALPHA_UNSUPPORTED message`, () => {
      const result = contrastTool(a, b);
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(resultText(result)).toBe(ALPHA_MSG);
    });
  }

  it('alpha exactly 1 (rgba(255 0 0 / 1)) is still allowed and computes a ratio', () => {
    const result = contrastTool('rgba(255 0 0 / 1)', '#ffffff');
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { ratio: number };
    expect(Number.isFinite(sc.ratio)).toBe(true);
    // Same ratio as the fully opaque spelling of the same color.
    const opaque = contrastTool('#ff0000', '#ffffff');
    expect(sc.ratio).toBe((opaque.structuredContent as { ratio: number }).ratio);
  });

  it('colors without an alpha component are unaffected', () => {
    const result = contrastTool('#ff0000', '#ffffff');
    expect(result.isError).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ERR-2 — parse failures name the offending parameter (foreground checked first)
// The message stays fully static: raw user input is NEVER echoed back.
// ---------------------------------------------------------------------------

describe('ERR-2 — parse errors name the failing parameter', () => {
  const FG_MSG = 'PARSE_FAILED: could not parse the foreground color';
  const BG_MSG = 'PARSE_FAILED: could not parse the background color';

  it('unparseable foreground yields the foreground-named static message', () => {
    const result = contrastTool('not-a-color', '#ffffff');
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(FG_MSG);
  });

  it('unparseable background yields the background-named static message', () => {
    const result = contrastTool('#ffffff', 'not-a-color');
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(BG_MSG);
  });

  it('both unparseable: foreground is checked first', () => {
    const result = contrastTool('not-a-color', 'also-not-a-color');
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(FG_MSG);
  });

  it('empty-string foreground also yields the foreground-named message', () => {
    const result = contrastTool('', '#ffffff');
    expect(result.isError).toBe(true);
    expect(resultText(result)).toBe(FG_MSG);
  });

  it('error text never echoes the raw input (SEC-3)', () => {
    const probe = 'zz-bogus-color-probe';
    for (const [a, b] of [
      [probe, '#ffffff'],
      ['#ffffff', probe],
    ] as [string, string][]) {
      const result = contrastTool(a, b);
      expect(result.isError).toBe(true);
      expect(resultText(result)).not.toContain(probe);
    }
  });

  it('wcagContrastRaw (shared utility) throws the same named messages', () => {
    expect(() => wcagContrastRaw('not-a-color', '#ffffff')).toThrow(FG_MSG);
    expect(() => wcagContrastRaw('#ffffff', 'not-a-color')).toThrow(BG_MSG);
  });
});

// ---------------------------------------------------------------------------
// modeLrgb isolation canary — proves import '../init.js' side-effect works
// ---------------------------------------------------------------------------

describe('modeLrgb isolation canary', () => {
  it('wcagContrastRaw("#000000","#ffffff") ∈ [20.98, 21.02] when imported standalone', () => {
    // src/utils/contrast.ts starts with `import '../init.js'` which registers modeLrgb.
    // If that side-effect is missing, wcagContrast returns undefined/NaN.
    const raw = wcagContrastRaw('#000000', '#ffffff');
    expect(raw).toBeGreaterThanOrEqual(20.98);
    expect(raw).toBeLessThanOrEqual(21.02);
  });
});
