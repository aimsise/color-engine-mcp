import '../../init.js'; // side-effect: register culori modes (MUST be first import — AC-11)
import { inGamut, toGamut, differenceEuclidean } from 'culori/fn';
import type { Color } from 'culori';

/**
 * Perceptual sRGB gamut mapper, built once at module load (AC-10 singleton).
 *
 * The mapper reduces OKLCH chroma via bisection until the result is "roughly in
 * gamut" (within a 0.02 just-noticeable-difference). It is reserved for the
 * perceptual gamut-mapping tools (parts 5-6); `parse_color` / `convert_color`
 * use `inGamutRgb` for accurate reporting and `formatHex` for the clamped string.
 *
 * The mapper constructor below appears EXACTLY ONCE at top level (AC-10) — never
 * rebuilt per call.
 *
 * NOTE: `@types/culori`@4.0.1 mistypes the `delta` parameter as `number | null`,
 * but the runtime (and culori docs) accept a `DiffFn` from `differenceEuclidean`.
 * The cast keeps the runtime-correct `DiffFn` argument while satisfying tsc.
 */
export const mapToSRGB = toGamut(
  'rgb',
  'oklch',
  differenceEuclidean('oklch') as unknown as number,
  0.02
);

// Module-level predicate so the closure is created only once.
const inRgbGamut = inGamut('rgb');

/**
 * Accurate sRGB gamut report for a parsed color. Unlike `formatHex` (which
 * silently clamps out-of-gamut channels), this returns `false` when any RGB
 * channel falls outside [0, 1].
 */
export function inGamutRgb(color: Color | string): boolean {
  return inRgbGamut(color);
}
