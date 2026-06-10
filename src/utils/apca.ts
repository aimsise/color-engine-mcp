/**
 * APCA-W3 contrast (SAPC-4g) — implemented from the published algorithm
 * (Myndex apca-w3, constant set 0.0.98G-4g) with NO new runtime dependency.
 * Reference: https://github.com/Myndex/apca-w3 — the math below mirrors the
 * reference `sRGBtoY` (simple-gamma screen-luminance estimate) and
 * `APCAcontrast` (soft black clamp → polarity-aware power curves → low-end
 * clip/offset) functions exactly.
 *
 * NOTE: APCA Lc is a supplementary, polarity-aware readability metric. It does
 * NOT feed the WCAG 2.1 tier flags — those are still computed from the RAW
 * pre-rounding WCAG 2.1 ratio via `wcagTiers` (see src/utils/contrast.ts).
 */

/** SA98G constant set (0.0.98G-4g) — verbatim from the published APCA-W3 reference. */
const SA98G = {
  /** Simple gamma exponent for the screen-luminance EOTF estimate. */
  mainTRC: 2.4,

  // sRGB luminance coefficients (Myndex-published set).
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.072175,

  // G-4g power-curve exponents (normal = dark-on-light, rev = light-on-dark).
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,

  // G-4g clamps, scalers and offsets.
  blkThrs: 0.022,
  blkClmp: 1.414,
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  loClip: 0.1,
  deltaYmin: 0.0005,
} as const;

/** Strict 6-digit #rrggbb matcher — callers pass parseColor's canonical hex. */
const HEX6 = /^#?([0-9a-f]{6})$/i;

/**
 * Estimated screen luminance Y for a 6-digit hex color using the APCA
 * simple-gamma EOTF: Y = Σ coeff · (channel/255)^2.4.
 *
 * @throws {Error} static code-keyed message for a malformed hex (defensive
 *   only — production callers always pass canonical `#rrggbb` strings).
 */
function sRGBtoY(hex: string): number {
  const m = HEX6.exec(hex);
  if (!m) {
    // SEC-3: static message, never echoes the raw input.
    throw new Error('APCA_INVALID_HEX: expected a 6-digit #rrggbb hex string');
  }
  const n = parseInt(m[1], 16);
  const lin = (chan: number): number => Math.pow(chan / 255, SA98G.mainTRC);
  return (
    SA98G.sRco * lin((n >> 16) & 0xff) +
    SA98G.sGco * lin((n >> 8) & 0xff) +
    SA98G.sBco * lin(n & 0xff)
  );
}

/** Soft black-level clamp (flare compensation) for luminances below blkThrs. */
function fclamp(y: number): number {
  return y > SA98G.blkThrs ? y : y + Math.pow(SA98G.blkThrs - y, SA98G.blkClmp);
}

/**
 * Signed APCA-W3 Lc for `textHex` (foreground text) over `backgroundHex`.
 *
 * Polarity convention (per the APCA-W3 spec):
 *   - dark text on a light background → POSITIVE Lc (black on white ≈ +106.04)
 *   - light text on a dark background → NEGATIVE Lc (white on black ≈ -107.88)
 *
 * Returns the raw (unrounded) Lc value; display rounding is the caller's job.
 * |Lc| values below the low-end clip (10) collapse to exactly 0.
 */
export function apcaLc(textHex: string, backgroundHex: string): number {
  // Soft black clamp BEFORE the noise gate — matches the reference ordering.
  const txtY = fclamp(sRGBtoY(textHex));
  const bgY = fclamp(sRGBtoY(backgroundHex));

  // Noise gate: nearly identical luminances mean "no usable contrast".
  if (Math.abs(bgY - txtY) < SA98G.deltaYmin) return 0;

  if (bgY > txtY) {
    // Normal polarity — dark text on light background (positive Lc).
    const sapc = (Math.pow(bgY, SA98G.normBG) - Math.pow(txtY, SA98G.normTXT)) * SA98G.scaleBoW;
    return (sapc < SA98G.loClip ? 0 : sapc - SA98G.loBoWoffset) * 100;
  }

  // Reverse polarity — light text on dark background (negative Lc).
  const sapc = (Math.pow(bgY, SA98G.revBG) - Math.pow(txtY, SA98G.revTXT)) * SA98G.scaleWoB;
  return (sapc > -SA98G.loClip ? 0 : sapc + SA98G.loWoBoffset) * 100;
}
