import {
  useMode,
  modeOklch,
  modeHsl,
  modeRgb,
  modeLrgb,
  modeP3,
  modeLab,
  modeLch,
  modeOklab,
  modeHwb,
  modeRec2020,
  modeA98,
  modeXyz65,
} from 'culori/fn';

// Side-effect: register color modes before any converter is used.
// modeLrgb is required for WCAG luminance computation path.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toOklch = useMode(modeOklch) as (color: any) => import('culori').Oklch | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toHsl = useMode(modeHsl) as (color: any) => import('culori').Hsl | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toRgb = useMode(modeRgb) as (color: any) => import('culori').Rgb | undefined;
useMode(modeLrgb); // registered for internal conversion; no export needed

// CE-1: wide-gamut / CSS Color 4 input modes. Registering a mode also registers
// its string parsers (e.g. `color(display-p3 …)`, `lab(…)`, `hwb(…)`), so the
// shared parse boundary accepts every README-advertised format. Each of these
// definitions carries direct to/from `rgb` converters (verified in
// node_modules/culori/src/*/definition.js), so no extra intermediate modes are
// needed. Registration only — converters are obtained via the exports above.
useMode(modeP3); //      color(display-p3 r g b)
useMode(modeLab); //     lab(L a b)
useMode(modeLch); //     lch(L C h)
useMode(modeOklab); //   oklab(L a b)
useMode(modeHwb); //     hwb(h w b)
useMode(modeRec2020); // color(rec2020 r g b)
useMode(modeA98); //     color(a98-rgb r g b)
useMode(modeXyz65); //   color(xyz-d65 x y z) / color(xyz x y z)
