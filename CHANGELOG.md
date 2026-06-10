# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-10

Initial release of `color-engine-mcp`, a stdio MCP server exposing six pure,
in-memory CSS-color tools: `parse_color`, `convert_color`, `contrast`,
`gamut_map`, `generate_ramp`, and `solve_for_contrast`.

### Added

- Six color tools built on `culori`, validated against a `colorjs.io` oracle.
- Wide-gamut / CSS Color 4 input formats accepted by every tool:
  `color(display-p3 ...)`, `lab()`, `lch()`, `oklab()`, `hwb()`,
  `color(rec2020 ...)`, `color(a98-rgb ...)`, and `color(xyz-d65 ...)`.
- Optional `apca: true` input on `contrast`, returning the signed APCA-W3
  (SAPC-4g) lightness contrast as `apcaLc` for text `a` over background `b`
  (validated within 0.1 Lc of the independent `colorjs.io` implementation
  across 200 seeded pairs). APCA is not yet a normative WCAG standard.
- Optional `tokenFormat` (`"tailwind"` / `"css-variables"`) and `tokenName`
  inputs on `generate_ramp`, returning a `tokens` string alongside the
  swatches; 11-step ramps map onto the canonical Tailwind `50`–`950` scale,
  other step counts use zero-based step indices as keys.
- Typed `COMPONENT_OUT_OF_RANGE` error for absurd-magnitude but parseable
  color components (e.g. `oklch(0.5 1e30 30)`), which previously surfaced as
  an opaque `INTERNAL_ERROR`.
- Typed `ALPHA_UNSUPPORTED` error: `contrast` and `solve_for_contrast` reject
  translucent colors (explicit alpha < 1, including `rgba()`/`hsla()` and
  4-/8-digit hex) instead of silently computing a misleading ratio; all other
  tools ignore alpha.
- Server-level MCP metadata: a `title` ("Color Engine") and an `instructions`
  string describing the toolset, rounding conventions, and error format for
  connecting clients.
- MCP tool annotations (`title`, `readOnlyHint`, `idempotentHint`,
  `openWorldHint`, `destructiveHint`) on all six tools.
- Benchmark script (`npm run bench`, requires `npm run build` first) measuring
  median per-call latency of the built handlers.
- MIT `LICENSE` and packaging metadata for npm publication
  (`files`, `prepublishOnly`, `bin` shebang, repository/keywords/homepage/bugs).
- GitHub Actions CI workflow (lint + tests on Node 20 and 22, plus coverage).
- Coverage thresholds wired into `vitest.config.ts` as a passing ratchet.

### Changed

- Color strings are trimmed of leading/trailing whitespace before parsing.
- Out-of-range channels in hex / `rgb()` / `hsl()` inputs are clamped at the
  parse boundary per CSS Color 4 (`rgb(-50 0 0)` behaves as `rgb(0 0 0)`);
  inputs in other modes (`oklch()`, `lab()`, ...) are **not** clamped and flow
  through raw.
- `gamut_map` returns already-in-gamut inputs identically (`clamped: false`
  with `hex` exactly the canonical hex of the input) and is idempotent on its
  own output.
- `solve_for_contrast` now returns the `PARSE_FAILED: could not parse the
  background color` error when the background does not parse — on both the
  single-`target` and the `targets` paths — instead of the old silent
  `met: false / color: null / ratio: null` sentinel.
- `solve_for_contrast` `targets` now requires at least one entry
  (schema `.min(1)`); an empty array is rejected at the protocol layer
  (tool-level `EMPTY_TARGETS` retained for direct callers).
- `generate_ramp` swatch numbers are display-rounded (contrast ratios 2dp,
  OKLCH l/c 5dp, h 2dp); tier classifications still derive from the raw,
  unrounded ratios.
- `contrast` and `solve_for_contrast` parse errors now name the failing
  parameter in their static messages (`foreground` / `background`).
- `parse_color` / `convert_color` RGB output is now clamped to the sRGB
  `0-255` integer range and is consistent with the hex output; use the
  `inGamut` flag to detect out-of-sRGB-gamut inputs.
- Numeric input constraints are now declared in the tool schemas and enforced
  by the MCP SDK at the protocol layer (e.g. `steps` 2..512,
  `lightnessMin`/`lightnessMax` in `[0, 1]`, `deltaL > 0`, `targets` 1..50,
  256-char string cap); the matching tool-level error codes are retained as
  defense-in-depth for direct library callers.

### Fixed

- README `generate_ramp` example showed a first swatch with `step: 1` —
  swatch indices are zero-based (`step: 0` is the lightest swatch).
- README `deltaL` wording: `deltaL` is the **total** lightness span centered
  on the base L (endpoints at base L ± deltaL/2), not a per-side offset.
- README examples regenerated as genuine captured server output (raw unrounded
  OKLCH in `parse_color`/`gamut_map` outputs, real solver hexes/ratios).

### Security / Hardening

- Bounded all color string inputs to a maximum of 256 characters, with an
  `INPUT_TOO_LONG` guard at the top of `parseColor` (before any parsing work)
  to defend against unbounded-input denial-of-service.
- Unified error contract: every error result now uses a uniform
  `"<CODE>: <static safe message>"` shape drawn from a documented closed set of
  error codes. Error messages no longer echo raw user input, paths, stacks, or
  library internals.
- `generate_ramp` is now total: it validates `steps`, `deltaL`,
  `lightnessMin`/`lightnessMax`, and base chroma, returning structured errors
  instead of throwing.
- CI workflow hardened: top-level `permissions: contents: read` and
  third-party actions pinned to full commit SHAs.
- Pinned the transitive `shell-quote` dependency to 1.8.4 via an npm override
  (GHSA-w7jw-789q-3m8p affects <= 1.8.3); `npm audit` reports 0
  vulnerabilities.

[0.1.0]: https://github.com/aimsise/color-engine-mcp/releases/tag/v0.1.0
