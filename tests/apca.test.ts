/**
 * tests/apca.test.ts — oracle harness for the APCA-W3 (SAPC-4g, 0.0.98G-4g)
 * implementation in src/utils/apca.ts and its wiring into the contrast tool.
 *
 * ORACLE: colorjs.io 0.6.1 ships an independent APCA 0.0.98G implementation
 * (node_modules/colorjs.io/src/contrast/APCA.js). Its signature is
 * `contrastAPCA(background, foreground)`, so the INSTANCE call is
 * `new Color(background).contrast(text, "APCA")` — verified empirically:
 * new Color('#ffffff').contrast('#000000', 'APCA') = +106.04 (black text on
 * white, positive ≈ +106 Lc), while the swapped order gives -107.88.
 *
 * NOTE: APCA Lc is supplementary output only. The WCAG 2.1 tier flags are
 * still computed from the RAW pre-rounding WCAG ratio (never from rounded
 * display values, and never from Lc).
 */

import { describe, it, expect } from 'vitest';
import Color from 'colorjs.io';
import { apcaLc } from '../src/utils/apca.js';
import { contrastTool } from '../src/tools/contrast.js';

// ---------------------------------------------------------------------------
// Oracle — colorjs.io APCA, normalized to (textHex, backgroundHex) order
// ---------------------------------------------------------------------------

function oracleApca(textHex: string, backgroundHex: string): number {
  // colorjs argument order: background instance, text argument (see header).
  return new Color(backgroundHex).contrast(new Color(textHex), 'APCA') as number;
}

/** Max allowed |implementation - oracle| in Lc units. */
const APCA_TOL = 0.1;

// ---------------------------------------------------------------------------
// Deterministic seeded LCG (numerical-recipes constants) → 24-bit hex colors
// ---------------------------------------------------------------------------

function makeLcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

/** Take the HIGH 24 bits of the LCG state (better-distributed than low bits). */
function nextHex(rand: () => number): string {
  return '#' + (rand() >>> 8).toString(16).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Canonical polarity anchors
// ---------------------------------------------------------------------------

describe('APCA canonical values (polarity anchors)', () => {
  it('black text on white background ≈ +106.04 Lc (positive, > +100)', () => {
    const lc = apcaLc('#000000', '#ffffff');
    expect(lc).toBeGreaterThan(100);
    expect(lc).toBeCloseTo(106.04, 1);
    expect(Math.abs(lc - oracleApca('#000000', '#ffffff'))).toBeLessThanOrEqual(APCA_TOL);
  });

  it('white text on black background ≈ -107.88 Lc (negative, < -100)', () => {
    const lc = apcaLc('#ffffff', '#000000');
    expect(lc).toBeLessThan(-100);
    expect(lc).toBeCloseTo(-107.88, 1);
    expect(Math.abs(lc - oracleApca('#ffffff', '#000000'))).toBeLessThanOrEqual(APCA_TOL);
  });

  it('identical colors yield exactly 0 Lc (noise gate)', () => {
    expect(apcaLc('#777777', '#777777')).toBe(0);
    expect(apcaLc('#000000', '#000000')).toBe(0);
  });

  it('accepts hex with or without the leading # (canonical-hex defensive parse)', () => {
    expect(apcaLc('000000', 'ffffff')).toBeCloseTo(apcaLc('#000000', '#ffffff'), 10);
  });
});

// ---------------------------------------------------------------------------
// Oracle sweep — 200 deterministic seeded pairs, |diff| <= 0.1 Lc
// ---------------------------------------------------------------------------

describe('APCA oracle sweep vs colorjs.io (200 seeded pairs)', () => {
  const PAIR_COUNT = 200;
  const rand = makeLcg(0xc0ffee);
  const pairs: [string, string][] = [];
  for (let i = 0; i < PAIR_COUNT; i++) {
    pairs.push([nextHex(rand), nextHex(rand)]);
  }

  it(`generates ${PAIR_COUNT} deterministic pairs (seeded LCG)`, () => {
    expect(pairs.length).toBe(PAIR_COUNT);
    // Determinism canary: same seed must regenerate the same first pair.
    const rand2 = makeLcg(0xc0ffee);
    expect([nextHex(rand2), nextHex(rand2)]).toEqual(pairs[0]);
  });

  it(`|apcaLc(text, bg) - colorjs oracle| <= ${APCA_TOL} Lc for all ${PAIR_COUNT} pairs`, () => {
    for (const [text, bg] of pairs) {
      const mine = apcaLc(text, bg);
      const oracle = oracleApca(text, bg);
      expect(
        Math.abs(mine - oracle),
        `APCA mismatch for text=${text} bg=${bg}: impl=${mine} oracle=${oracle}`
      ).toBeLessThanOrEqual(APCA_TOL);
    }
  });

  it('reversed-pair sweep also matches (polarity correctness both ways)', () => {
    for (const [text, bg] of pairs.slice(0, 50)) {
      const mine = apcaLc(bg, text);
      const oracle = oracleApca(bg, text);
      expect(
        Math.abs(mine - oracle),
        `APCA mismatch for text=${bg} bg=${text}: impl=${mine} oracle=${oracle}`
      ).toBeLessThanOrEqual(APCA_TOL);
    }
  });
});

// ---------------------------------------------------------------------------
// Tool wiring — optional `apca` input adds optional `apcaLc` output (2 dp)
// ---------------------------------------------------------------------------

describe('contrast tool wiring — apca:true adds apcaLc', () => {
  it('apca:true adds a signed apcaLc rounded to 2 decimals', () => {
    const result = contrastTool('#000000', '#ffffff', true);
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { ratio: number; apcaLc?: number };
    expect(typeof sc.apcaLc).toBe('number');
    const lc = sc.apcaLc as number;
    // 2-dp display rounding of the raw Lc.
    expect(lc).toBe(Math.round(apcaLc('#000000', '#ffffff') * 100) / 100);
    expect(Math.round(lc * 100)).toBeCloseTo(lc * 100, 6); // no >2dp residue
    expect(lc).toBeCloseTo(106.04, 2);
  });

  it('apcaLc is negative for light text on a dark background', () => {
    const result = contrastTool('#ffffff', '#000000', true);
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { apcaLc?: number };
    expect(sc.apcaLc).toBeCloseTo(-107.88, 2);
  });

  it('apcaLc is ABSENT when apca is omitted or false', () => {
    for (const apca of [undefined, false] as const) {
      const result = contrastTool('#000000', '#ffffff', apca);
      expect(result.isError).toBeUndefined();
      const sc = result.structuredContent as { apcaLc?: number };
      expect(sc.apcaLc).toBeUndefined();
    }
  });

  it('WCAG fields are unchanged by apca:true (tiers still from the RAW ratio)', () => {
    const plain = contrastTool('#000000', '#ffffff');
    const withApca = contrastTool('#000000', '#ffffff', true);
    const p = plain.structuredContent as Record<string, unknown>;
    const w = withApca.structuredContent as Record<string, unknown>;
    expect(w.ratio).toBe(p.ratio);
    expect(w.aaNormal).toBe(p.aaNormal);
    expect(w.aaLarge).toBe(p.aaLarge);
    expect(w.aaaNormal).toBe(p.aaaNormal);
    expect(w.aaaLarge).toBe(p.aaaLarge);
  });

  it('apca:true does not bypass the ALPHA_UNSUPPORTED guard', () => {
    const result = contrastTool('rgba(255 0 0 / 0.1)', '#ffffff', true);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toBe(
      'ALPHA_UNSUPPORTED: contrast requires fully opaque colors (alpha = 1); composite the color over its backdrop first'
    );
  });

  it('apca:true does not change the parameter-named parse errors', () => {
    const result = contrastTool('not-a-color', '#ffffff', true);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toBe(
      'PARSE_FAILED: could not parse the foreground color'
    );
  });

  it('non-hex CSS inputs work via the canonical parsed hex (named colors)', () => {
    const result = contrastTool('black', 'white', true);
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { apcaLc?: number };
    expect(sc.apcaLc).toBeCloseTo(106.04, 2);
  });
});
