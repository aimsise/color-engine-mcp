import '../../init.js'; // side-effect: register culori modes (MUST be first import — AC-11)
import { toHsl } from '../../init.js';
import { parseColor } from './parse.js';

export type ConvertTo = 'hex' | 'rgb' | 'hsl' | 'oklch';

export type ConvertOk = { ok: true; result: string };
export type ConvertErr = { ok: false; error: string };
export type ConvertResult = ConvertOk | ConvertErr;

/**
 * Convert any CSS color string into one of four canonical, deterministic format
 * strings. Routing THROUGH `parseColor` first means the shared finite-value guard
 * (AC-5) is inherited here — malformed (AC-7) and overflow (AC-8) inputs surface
 * as `{ ok: false }` without re-implementing the guard.
 *
 * Canonical formats (determinism is what makes the AC-3 round-trip exact):
 *   - hex   → "#rrggbb"             (lowercase, integer-clamped)
 *   - rgb   → "rgb(R, G, B)"        (integer channels)
 *   - oklch → "oklch(L C H)"        (L & C 5dp, H 2dp)
 *   - hsl   → "hsl(H, S%, L%)"      (H/S/L 2dp, S & L as percentages)
 */
export function convertColor(input: string, to: ConvertTo): ConvertResult {
  const parsed = parseColor(input);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  switch (to) {
    case 'hex':
      return { ok: true, result: parsed.hex };

    case 'rgb': {
      const { r, g, b } = parsed.rgb;
      return { ok: true, result: `rgb(${r}, ${g}, ${b})` };
    }

    case 'oklch': {
      const { l, c, h } = parsed.oklch;
      // L and C are formatted at 5 decimal places (NOT the 4dp suggested in
      // ticket.md L75): 4dp drops enough precision that the OKLCH→sRGB inverse
      // lands off-by-one on an RGB channel for ~0.08% of sRGB colors (e.g.
      // "#00ccdd" → "oklch(0.7715 0.1318 205.44)" → "#01ccdd"), which BREAKS the
      // binding AC-3 round-trip invariant. An empirical scan of the FULL 256^3
      // sRGB cube confirmed 4dp → 13616 round-trip failures while 5dp → 0. The
      // binding AC-3 (exact, byte-identical hex round-trip cube-wide) overrides
      // the non-binding L75 NOTE, so L/C use 5dp. H at 2dp is sufficient because
      // hue precision does not affect the round-trip (0 failures at 2dp/5dp).
      return {
        ok: true,
        result: `oklch(${l.toFixed(5)} ${c.toFixed(5)} ${h.toFixed(2)})`,
      };
    }

    case 'hsl': {
      // Re-derive HSL through the registered converter (still inside
      // src/lib/color/, so the src/tools/ sibling-guard stays clean). `parsed.hex`
      // is the canonical, in-gamut representation of the input.
      const hsl = toHsl(parsed.hex);
      if (!hsl) {
        return { ok: false, error: 'non-finite color components' };
      }
      const h = Number.isFinite(hsl.h) ? (hsl.h as number) : 0;
      const s = (hsl.s ?? 0) * 100;
      const lPct = (hsl.l ?? 0) * 100;
      if (!Number.isFinite(s) || !Number.isFinite(lPct)) {
        return { ok: false, error: 'non-finite color components' };
      }
      return {
        ok: true,
        result: `hsl(${h.toFixed(2)}, ${s.toFixed(2)}%, ${lPct.toFixed(2)}%)`,
      };
    }

    default: {
      // Exhaustiveness guard — unreachable when `to` is validated by zod.
      const _never: never = to;
      return { ok: false, error: `unsupported conversion target "${String(_never)}"` };
    }
  }
}
