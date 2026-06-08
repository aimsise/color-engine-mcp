import { useMode, modeOklch, modeHsl, modeRgb, modeLrgb } from 'culori/fn';

// Side-effect: register color modes before any converter is used.
// modeLrgb is required for WCAG luminance computation path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toOklch = useMode(modeOklch) as (color: any) => import('culori').Oklch | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toHsl = useMode(modeHsl) as (color: any) => import('culori').Hsl | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toRgb = useMode(modeRgb) as (color: any) => import('culori').Rgb | undefined;
useMode(modeLrgb); // registered for internal conversion; no export needed
