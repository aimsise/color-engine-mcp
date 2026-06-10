# color-engine MCP Server

A Model Context Protocol (MCP) server providing 6 CSS color utilities: parsing, conversion, gamut mapping, WCAG contrast (with optional APCA), tint/shade ramp generation (with optional design-token output), and contrast-target solving. All tools operate purely in-memory — no network I/O, no filesystem writes.

> All JSON outputs shown in this README are genuine responses captured from the built server via `npx @modelcontextprotocol/inspector --cli node dist/server.js --method tools/call`.

## Color input handling

Every tool routes color strings through one shared parse boundary, so the rules below apply uniformly.

**Accepted formats.** Any CSS color string culori can parse, including named colors, hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()`/`rgba()`, `hsl()`/`hsla()`, and `oklch()` — plus the wide-gamut / CSS Color 4 formats:

- `color(display-p3 r g b)`
- `lab(L a b)` / `lch(L C h)`
- `oklab(L a b)`
- `hwb(h w b)`
- `color(rec2020 r g b)`
- `color(a98-rgb r g b)`
- `color(xyz-d65 x y z)`

A wide-gamut input outside sRGB parses fine and reports `inGamut: false`:

```json
{ "input": "color(display-p3 1 0 0)" }
```

```json
{
  "hex": "#ff0000",
  "rgb": { "r": 255, "g": 0, "b": 0 },
  "oklch": { "l": 0.6485740751442981, "c": 0.2994852863383699, "h": 28.958132730803953 },
  "inGamut": false
}
```

**Whitespace.** Leading/trailing whitespace is trimmed before parsing — `"  #ff0000  "` parses as `#ff0000`.

**CSS Color 4 channel clamping (legacy spaces only).** Out-of-range channels in hex / `rgb()` / `hsl()` inputs are clamped at the parse boundary, per CSS Color 4: `rgb(-50 0 0)` behaves exactly as `rgb(0 0 0)` (verified live: it parses to `#000000`, `inGamut: true`), and `hsl()` saturation/lightness clamp likewise (hue wraps). Inputs in **other** modes (`oklch()`, `lab()`, `color(display-p3 …)`, …) are **not** clamped — their out-of-gamut values flow through raw, which is what makes `gamut_map` useful.

**`none` channels.** CSS Color 4 `none` channels are normalized to `0` at the shared parse boundary in all six tools: `oklch(0.5 none 30)` behaves exactly as `oklch(0.5 0 30)` (verified live: every tool resolves it to the gray `#636363`), and `rgb(255 none 0)` behaves exactly as `rgb(255 0 0)` (every tool resolves it to `#ff0000`). When the normalized color ends up **outside** the sRGB gamut (e.g. `oklch(none 0.2 30)`, which behaves as the out-of-gamut `oklch(0 0.2 30)`), each tool then applies its usual out-of-gamut handling — exactly as for any other out-of-gamut input: `parse_color`/`convert_color` report the channel-clamped projection (here `#080000`, `inGamut: false`) while `gamut_map` returns the perceptually mapped color (here `#000000`, `clamped: true`), so their hexes can legitimately differ for such inputs.

**Component magnitude.** A parseable component with an absurd magnitude (above 1e6, e.g. `oklch(0.5 1e30 30)`) is rejected with the typed error `COMPONENT_OUT_OF_RANGE: color component magnitude exceeds the supported range` by `parse_color`, `convert_color`, `contrast`, and `generate_ramp` (previously this surfaced as `INTERNAL_ERROR`). Two tools surface it differently (both verified live): `gamut_map`'s deliberate chroma-first guard fires before the generic magnitude check, so for `oklch(0.5 1e30 30)` it returns `CHROMA_OUT_OF_RANGE: OKLCH chroma exceeds the supported maximum (100)`; and `solve_for_contrast` coalesces every parse-boundary failure of its `background` into its parameter-named `PARSE_FAILED`. Real out-of-gamut values are many orders of magnitude below these guards and are never affected.

**Alpha policy.** `contrast` and `solve_for_contrast` **reject** translucent colors — any explicit alpha `< 1`, including `rgba()`/`hsla()` functional alpha and 4-/8-digit hex (`#00000080`) — with `ALPHA_UNSUPPORTED`, because the effective color of a translucent layer depends on an unknown backdrop; composite over the backdrop first. Alpha exactly `1` (e.g. `rgb(255 0 0 / 1)`) is allowed. All **other** tools accept translucent input and simply **ignore** the alpha channel: computations and outputs use the opaque color (e.g. `convert_color` of `rgb(255 0 0 / 0.5)` to hex returns `"#ff0000"`), and no output ever carries an alpha component.

**Length cap.** Color strings longer than 256 characters (after trimming) are rejected with `INPUT_TOO_LONG`.

## Tools

### parse_color

Parse any CSS color string and return hex, RGB, OKLCH, and gamut info.

**Input schema**

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| input | string | yes      | Any CSS color string, e.g. `"#ff0000"`, `"red"`, `"oklch(0.6 0.2 30)"` |

**Output** (genuine output for `{ "input": "#ff0000" }`)

```json
{
  "hex": "#ff0000",
  "rgb": { "r": 255, "g": 0, "b": 0 },
  "oklch": { "l": 0.6279553639214311, "c": 0.2576833038053608, "h": 29.233880279627854 },
  "inGamut": true
}
```

The `rgb` channels are the **sRGB-clamped** 0–255 integer projection (consistent with `hex`). For an out-of-gamut input (e.g. a wide-gamut `oklch(...)`), the channels are clamped into `[0, 255]` rather than reporting raw out-of-range values — use the `inGamut` flag to detect that the input fell outside sRGB. The `oklch` block, by contrast, is the **raw (lossless, unrounded)** OKLCH of the input, and `oklch.h` is `0` for achromatic colors.

---

### convert_color

Convert a CSS color string into a canonical hex, rgb, hsl, or oklch format string.

**Input schema**

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| input | string | yes      | Any CSS color string |
| to    | string | yes      | Target format: `"hex"`, `"rgb"`, `"hsl"`, or `"oklch"` |

**Output** (genuine output for `{ "input": "#ff0000", "to": "oklch" }`)

```json
{ "result": "oklch(0.62796 0.25768 29.23)" }
```

**Raw vs. clamped for out-of-gamut inputs**

For a color that lies outside the sRGB gamut, the target formats diverge:

- `to: "oklch"` returns the **raw, lossless** OKLCH triple, so an out-of-gamut color round-trips faithfully. E.g. `{ "input": "oklch(0.7 0.4 30)", "to": "oklch" }` → `"oklch(0.70000 0.40000 30.00)"`.
- `to: "hex"`, `"rgb"`, and `"hsl"` are all derived from the **sRGB-clamped** projection and report the in-gamut approximation. E.g. `{ "input": "oklch(0.7 0.4 30)", "to": "rgb" }` → `"rgb(255, 0, 0)"` (clamped, verified live). `rgb` channels are integers in `[0, 255]`.

(`L`/`C` are formatted to 5 decimal places and `H` to 2, which guarantees an exact hex round-trip across the full sRGB cube.)

---

### contrast

Compute the WCAG 2.1 contrast ratio between two fully opaque CSS color strings and return tier flags. Optionally also computes the APCA Lc value (see [APCA](#apca-optional-perceptual-contrast)).

**Input schema**

| Field | Type    | Required | Description |
|-------|---------|----------|-------------|
| a     | string  | yes      | First CSS color string (treated as the **text/foreground** for APCA), e.g. `"#000000"` |
| b     | string  | yes      | Second CSS color string (treated as the **background** for APCA), e.g. `"#ffffff"` |
| apca  | boolean | no       | When `true`, additionally return the signed APCA-W3 `apcaLc` for text `a` over background `b` |

**Output** (genuine output for `{ "a": "#000000", "b": "#ffffff" }`)

```json
{
  "ratio": 21,
  "aaNormal": true,
  "aaLarge": true,
  "aaaNormal": true,
  "aaaLarge": true
}
```

`ratio` is the 2-decimal **display** value. The four tier booleans are derived from the **unrounded raw** ratio (so a near-boundary raw `4.4999`, which displays as `4.50`, still yields `aaNormal: false`).

WCAG 2.1 tier thresholds:
- `aaNormal` / `aaLarge` require ratio ≥ 4.5 / ≥ 3.0
- `aaaNormal` / `aaaLarge` require ratio ≥ 7.0 / ≥ 4.5

**Errors.** A string that fails to parse yields a parameter-named error — `PARSE_FAILED: could not parse the foreground color` for `a`, `PARSE_FAILED: could not parse the background color` for `b` (the foreground is checked first). A translucent input (alpha < 1, including 8-digit hex) yields `ALPHA_UNSUPPORTED: contrast requires fully opaque colors (alpha = 1); composite the color over its backdrop first`.

#### APCA (optional perceptual contrast)

Pass `apca: true` to additionally get `apcaLc` — the signed APCA-W3 (SAPC-4g) lightness contrast Lc, rounded to 2 decimals, for **text `a` over background `b`** (the argument order matters for APCA, unlike the symmetric WCAG ratio). The sign encodes polarity: **positive** for dark text on a light background, **negative** for light text on a dark background; compare magnitudes with `|Lc|`.

Genuine outputs:

```json
{ "a": "#1a1a1a", "b": "#ffffff", "apca": true }
```

```json
{ "ratio": 17.4, "aaNormal": true, "aaLarge": true, "aaaNormal": true, "aaaLarge": true, "apcaLc": 104.27 }
```

Reversing the pair flips the sign: `{ "a": "#ffffff", "b": "#1a1a1a", "apca": true }` → `"apcaLc": -106.55` (same WCAG `ratio` of `17.4`, since the WCAG ratio is symmetric).

Commonly cited APCA guideline thresholds (by `|Lc|`):

| \|Lc\| | Common guideline use |
|-------|----------------------|
| 45    | Minimum for large/bold text |
| 60    | Minimum for other content text |
| 75    | Body text |
| 90    | Preferred body text |

> **Disclaimer:** APCA is a candidate method for WCAG 3 and is **not yet a normative WCAG standard** — use the WCAG 2.1 tier flags for conformance claims.

---

### gamut_map

Map any CSS color string into the sRGB gamut via perceptual OKLCH chroma reduction. Useful for converting wide-gamut colors (P3, Rec2020, arbitrary OKLCH) to displayable sRGB.

**Input schema**

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| input | string | yes      | Any CSS color string, e.g. `"oklch(0.6 0.4 30)"` |

**Output** (genuine output for `{ "input": "oklch(0.6 0.4 30)" }`)

```json
{
  "hex": "#f70000",
  "oklch": { "l": 0.6137129506655941, "c": 0.25183888824211537, "h": 29.233880279628004 },
  "clamped": true
}
```

`clamped` is `true` when the input was outside the sRGB gamut and had to be mapped. The returned `oklch` is the raw OKLCH of the **mapped** in-gamut result (chroma reduced perceptually), not of the original input.

**Identity and idempotency.** An input that is **already inside** the sRGB gamut is returned **identically**: `clamped` is `false` and `hex` is exactly the canonical hex of the input (genuine output for `{ "input": "#3b82f6" }` → `{ "hex": "#3b82f6", …, "clamped": false }` — no off-by-one drift, even for boundary colors like `#01ffff`). The tool is also **idempotent**: its own output hex is always in-gamut, so feeding a result back in takes the identity path and returns the identical hex.

---

### generate_ramp

Generate a tint-to-shade color ramp from a base CSS color. Returns an ordered list of swatches (light to dark) each with hex, OKLCH, WCAG contrast ratios vs white and black, and a gamut flag. Optionally emits the ramp as design tokens (see [Design tokens](#design-tokens)).

**Input schema**

| Field        | Type    | Required | Description |
|--------------|---------|----------|-------------|
| base         | string  | yes      | Any CSS color string, e.g. `"#3b82f6"` |
| steps        | integer | no       | Number of swatches (2–512). Default: 5 |
| lightnessMin | number  | no       | Lower lightness endpoint (OKLCH L, 0–1). Default: 0.05 |
| lightnessMax | number  | no       | Upper lightness endpoint (OKLCH L, 0–1). Default: 0.97 |
| deltaL       | number  | no       | **Total** lightness span centered on the base L — endpoints at base L ± deltaL/2 (overrides the fixed range) |
| tokenFormat  | string  | no       | `"tailwind"` or `"css-variables"` — when present the output includes a `tokens` string |
| tokenName    | string  | no       | Base name for emitted tokens (letters/digits/hyphens, must start with a letter, 1–64 chars). Default: `"color"` |

**Output** (genuine output for `{ "base": "#3b82f6", "steps": 5 }`, first of 5 swatches shown)

```json
{
  "swatches": [
    {
      "step": 0,
      "hex": "#f5f5f5",
      "oklch": { "l": 0.97, "c": 0, "h": 259.81 },
      "vsWhite": { "ratio": 1.09, "tier": "FAIL" },
      "vsBlack": { "ratio": 19.26, "tier": "AAA" },
      "inGamut": true
    }
  ]
}
```

Swatch indices are **zero-based**: swatches are ordered lightest (`step: 0`) to darkest (`step: steps - 1`), with strictly **decreasing** OKLCH lightness. (In the full 5-swatch response above, the in-gamut base `#3b82f6` reappears verbatim at `step: 2` — the ramp anchors the nearest step to the base lightness.)

Each swatch carries `vsWhite` / `vsBlack`, each `{ ratio, tier }` where `ratio` is the WCAG contrast against white/black and `tier` is one of `"AAA"` (raw ratio ≥ 7.0), `"AA"` (≥ 4.5), or `"FAIL"`.

**Display rounding.** Swatch numbers are display-rounded: contrast `ratio`s to 2 decimals, `oklch.l`/`oklch.c` to 5 decimals, `oklch.h` to 2. The `tier` classifications still derive from the **raw, unrounded** ratios (a raw 6.9999 displays as `7.00` but is classified `"AA"`).

**Tier quantization near thresholds.** Each swatch's contrast is computed from its 8-bit `hex` (the authoritative displayed color), not from the float-precision internal color. For a non-hex base whose swatch lands within about `0.01` of a tier threshold (3.0 / 4.5 / 7.0), the 8-bit quantization can flip the tier relative to a float-precision computation. If you need a guaranteed margin, target a ratio comfortably above the threshold (e.g. solve for 4.6 rather than 4.5).

**Validation rules**

The numeric constraints are declared in the tool schema, so the MCP SDK rejects out-of-range calls **before the handler runs**. In SDK 1.29 that rejection arrives as an in-band error result (`isError: true`) whose SDK-generated text begins `MCP error -32602: Input validation error: …`, not as one of the tool-level codes below (see [Schema-layer vs tool-layer enforcement](#schema-layer-vs-tool-layer-enforcement)); the matching tool-level error codes are retained as defense-in-depth for direct library callers:

- `steps` must be an integer in `[2, 512]` → otherwise `STEPS_OUT_OF_RANGE`.
- `deltaL`, when provided, must be a finite number `> 0` → otherwise `INVALID_DELTA_L`. It defines the **total** lightness span centered on the base L (endpoints at base L ± deltaL/2) and **overrides** `lightnessMin`/`lightnessMax`.
- The resolved lightness range must satisfy `lightnessMin < lightnessMax` (endpoints are clamped into `[0, 1]` first) → otherwise `INVALID_LIGHTNESS_RANGE`.
- The base color's OKLCH chroma must be ≤ 100 → otherwise `BASE_CHROMA_OUT_OF_RANGE`.
- A `base` that fails to parse forwards the parse error code (`PARSE_FAILED`, `INPUT_TOO_LONG`, `COMPONENT_OUT_OF_RANGE`, or `NON_FINITE_COMPONENTS`).

**Payload size.** A `steps: 512` call returns roughly **200 KB** of JSON in the tool result (measured: ~85 KB text content + ~97 KB `structuredContent`; ~280 KB when pretty-printed). Prefer small step counts (5–11) in LLM contexts — they cover virtually every design-system use case at a tiny fraction of the tokens.

**Note on `swatch.oklch` vs `swatch.hex`**

Each swatch's reported `oklch` is the **requested-L / chroma-clamped** projection (the target lightness with chroma reduced into the sRGB gamut at that lightness), which is what preserves strict L-monotonicity across the ramp. It can therefore differ slightly (up to a ΔL of ≈0.013) from the exact OKLCH you would compute from `swatch.hex`. This is a deliberate trade-off favoring monotonic lightness over an exact hex round-trip; `hex` remains the authoritative displayed color.

#### Design tokens

Pass `tokenFormat` (and optionally `tokenName`) to additionally receive a `tokens` string alongside `swatches`.

- With **exactly 11 steps**, token keys use the canonical Tailwind scale `50, 100, 200, …, 900, 950` (swatch `0` — the lightest — maps to `50`).
- Any **other** step count uses the zero-based `step` index as the key.

**`tokenFormat: "tailwind"`** — a pretty-printed JSON object string. Genuine `tokens` output for `{ "base": "#3b82f6", "steps": 11, "tokenFormat": "tailwind", "tokenName": "blue" }`:

```json
{
  "blue": {
    "50": "#f5f5f5",
    "100": "#c1d8fe",
    "200": "#8fbaff",
    "300": "#629bfa",
    "400": "#3b82f6",
    "500": "#155ecf",
    "600": "#0043ab",
    "700": "#002b80",
    "800": "#001750",
    "900": "#000721",
    "950": "#000000"
  }
}
```

**`tokenFormat: "css-variables"`** — a `:root` block. Genuine `tokens` output for `{ "base": "#3b82f6", "steps": 5, "tokenFormat": "css-variables", "tokenName": "brand" }`:

```css
:root {
  --brand-0: #f5f5f5;
  --brand-1: #78abfe;
  --brand-2: #3b82f6;
  --brand-3: #002068;
  --brand-4: #000000;
}
```

`tokenName` is validated at the schema boundary (`/^[a-z][a-z0-9-]*$/i`, 1–64 chars) so it always embeds safely in a CSS custom-property name or JSON key.

---

### solve_for_contrast

Find a foreground color that meets one or more WCAG 2.1 contrast targets against a background. Binary-searches OKLCH lightness (holding hue/chroma fixed).

**Input schema**

| Field      | Type                         | Required | Description |
|------------|------------------------------|----------|-------------|
| background | string                       | yes      | Background CSS color string |
| target     | number                       | one of   | Single WCAG 2.1 contrast target (e.g. 4.5, 7) |
| targets    | number[]                     | one of   | Multiple contrast targets (1–50 entries; an empty array is rejected) |
| prefer     | `"lighter"`,`"darker"`,`"either"` | no  | Search direction. Default: `"either"` |
| hue        | number                       | no       | Fixed OKLCH hue (degrees) held constant during the search |
| chroma     | number                       | no       | Fixed OKLCH chroma (≥ 0) held constant during the search |

**`hue`/`chroma` defaults — pass `chroma` to keep saturation**

When omitted, `chroma` defaults to the **background's own chroma** and `hue` defaults to the background's hue (or `0` for an achromatic background). Two consequences worth knowing:

- **`hue` without `chroma` does not add saturation.** Against an achromatic background (white/grey/black), the defaulted chroma is `0`, so the result is an achromatic gray regardless of the hue you pass. Genuine outputs against `#ffffff` with `target: 4.5`: `{ "hue": 260 }` → `{ "met": true, "color": "#767676", "ratio": 4.54 }` (the same gray as passing no hue at all), while `{ "hue": 260, "chroma": 0.15 }` → `{ "met": true, "color": "#4075cf", "ratio": 4.5 }` (a real blue).
- `chroma` without `hue` fixes the hue to the background's hue (or `0` when achromatic). The fixed chroma may still be reduced per-lightness when the sRGB gamut requires it.

**`target` vs `targets` precedence and response shape**

Provide `target` (single) **or** `targets` (array). If **both** are given, `targets` takes precedence and the single `target` is ignored. The two modes return **different response shapes**:

- **Single `target`** → `{ met, color, ratio }` (plus an optional `nearMiss` flag).
- **`targets` array** → `{ results: [ { met, color, ratio, nearMiss? }, ... ] }`, one entry per requested target, in order.

The registered output schema is an all-optional **superset** of both shapes (a single-object MCP output-schema limitation in SDK 1.29); any given response populates exactly one of the two shapes.

**Output** (genuine output for `{ "background": "#ffffff", "target": 4.5, "prefer": "darker" }`)

```json
{ "met": true, "color": "#767676", "ratio": 4.54 }
```

**Output** (genuine output for `{ "background": "#1e293b", "targets": [4.5, 7] }`)

```json
{
  "results": [
    { "met": true, "color": "#8290a6", "ratio": 4.52 },
    { "met": true, "color": "#a6b5cc", "ratio": 7.04 }
  ]
}
```

`nearMiss: true` may appear (on a single result, or on an entry inside `results`) when `met` was granted via the near-ceiling tolerance: the best achievable **raw** ratio **in the searched direction(s)** is within `0.03` *below* the target. This is a per-direction statement, **not** a claim that the target is unreachable everywhere — under a directional `prefer` (`"lighter"`/`"darker"`) only that one band is searched, so the opposite direction may still strictly meet the target. (In the `"either"` mode, a strictly-compliant side is always preferred over a near-miss, so `nearMiss` only surfaces when *neither* direction strictly meets the target.)

**Errors.** A background that does not parse returns `isError` with `PARSE_FAILED: could not parse the background color` — on **both** the single-`target` and the `targets` paths (the background is resolved once, before either path branches; older builds returned a misleading `met: false, color: null, ratio: null` sentinel instead). A translucent background (alpha < 1, including 8-digit hex) returns `ALPHA_UNSUPPORTED`.

---

## Error handling

Every tool is **total**: malformed or out-of-range input never crashes the server or leaks a stack trace. On failure a tool returns an MCP result with `isError: true` and a single text content block whose text follows a **uniform `<CODE>: message` format**, where `<CODE>` is an `UPPER_SNAKE_CASE` value from a closed set. The message is a static, safe string — it never embeds your raw input, file paths, stacks, or library internals. On error the tool never sets `structuredContent`.

Example error text:

```
PARSE_FAILED: could not parse the provided color string
```

The catch-all for any unexpected internal fault is always:

```
INTERNAL_ERROR: unexpected internal error
```

### Schema-layer vs tool-layer enforcement

Constraints declared in the tools' zod input schemas are enforced by the MCP SDK **before the tool handler runs**: the handler never executes and the result carries no `structuredContent`. The wire shape of that rejection is an SDK detail worth knowing. In MCP SDK 1.29 it is **not** a true JSON-RPC protocol error — the SDK catches its own invalid-params exception inside its CallTool handler and re-wraps it, so the rejection arrives **in-band** as an error-flagged tool result (`isError: true`) whose text begins `MCP error -32602: Input validation error: …` followed by the zod issue details. Genuine example, captured live for a 300-character `parse_color` input (rejected by the `.max(256)` schema cap):

```
MCP error -32602: Input validation error: Invalid arguments for tool parse_color: [
  {
    "origin": "string",
    "code": "too_big",
    "maximum": 256,
    "inclusive": true,
    "path": [
      "input"
    ],
    "message": "Too big: expected string to have <=256 characters"
  }
]
```

That text is generated by the MCP SDK, **not** by this server's tools — the uniform `CODE: message` format and the no-internals guarantee described above apply to **tool-layer** errors only. Future SDK versions may surface a true `-32602` protocol error instead, so don't pattern-match on the exact SDK wording. The tool-level codes are **retained as defense-in-depth** for direct library callers (code that imports the handlers or `src/lib` functions and bypasses SDK validation). Schema-enforced constraints:

- `INPUT_TOO_LONG` — every color-string field declares `.max(256)`.
- `STEPS_OUT_OF_RANGE` — `steps` declares integer `2..512`.
- `INVALID_DELTA_L` — `deltaL` declares finite `> 0`.
- `TOO_MANY_TARGETS` — `targets` declares `.max(50)`.
- `EMPTY_TARGETS` — `targets` declares `.min(1)` (an empty array is rejected pre-handler).
- The finiteness/sign constraints behind `INVALID_TARGET`, `INVALID_CHROMA`, and `INVALID_HUE` are likewise schema-declared (and non-finite numbers are not representable in JSON anyway).

### Error codes

| Code | Meaning |
|------|---------|
| `INPUT_TOO_LONG` | A color string exceeded the 256-character cap (DoS guard, enforced before parsing; schema-enforced — over MCP rejected pre-handler by the SDK). |
| `PARSE_FAILED` | The provided color string could not be parsed as any CSS color. In `contrast` and `solve_for_contrast` the static message names the failing **parameter**: `could not parse the foreground color` / `could not parse the background color`. |
| `COMPONENT_OUT_OF_RANGE` | A parseable color component had an absurd magnitude (> 1e6), e.g. `oklch(0.5 1e30 30)` — returned by `parse_color`, `convert_color`, `contrast`, and `generate_ramp`. **Exception:** `gamut_map` rejects that same input with `CHROMA_OUT_OF_RANGE` (its chroma guard fires first), and `solve_for_contrast` reports it as parameter-named `PARSE_FAILED`. Previously surfaced as `INTERNAL_ERROR`. |
| `ALPHA_UNSUPPORTED` | `contrast` / `solve_for_contrast` received a translucent color (explicit alpha < 1, including 4-/8-digit hex). Composite over the backdrop first. |
| `NON_FINITE_COMPONENTS` | The color resolved to non-finite RGB/OKLCH components (e.g. an overflowing chroma). |
| `NON_FINITE_LUMINANCE` | Contrast computation produced a non-finite luminance. |
| `NON_FINITE_OKLCH_COMPONENTS` | OKLCH lightness/chroma were non-finite during gamut mapping. |
| `NULL_OKLCH_CHANNELS` | OKLCH channels resolved to null during gamut mapping. |
| `NON_FINITE_OKLCH_HUE` | OKLCH hue was non-finite for a chromatic color during gamut mapping. |
| `CHROMA_OUT_OF_RANGE` | OKLCH chroma exceeded the gamut mapper's supported maximum (100). This is what `gamut_map` returns for `oklch(0.5 1e30 30)` (verified live) — not `COMPONENT_OUT_OF_RANGE`. |
| `GAMUT_MAP_COLLAPSE` | Gamut mapping collapsed to null/non-finite channels. |
| `STEPS_OUT_OF_RANGE` | `generate_ramp` `steps` was not an integer in `[2, 512]` (schema-enforced — over MCP rejected pre-handler by the SDK). |
| `INVALID_LIGHTNESS_RANGE` | `generate_ramp` resolved `lightnessMin >= lightnessMax`. |
| `INVALID_DELTA_L` | `generate_ramp` `deltaL` was not a finite number `> 0` (schema-enforced — over MCP rejected pre-handler by the SDK). |
| `BASE_CHROMA_OUT_OF_RANGE` | `generate_ramp` base OKLCH chroma exceeded 100. |
| `MISSING_BACKGROUND` | `solve_for_contrast` was called without a `background`. |
| `MISSING_TARGET` | `solve_for_contrast` was called with neither `target` nor `targets`. |
| `EMPTY_TARGETS` | `solve_for_contrast` `targets` was an empty array (schema-enforced via `.min(1)` — over MCP rejected pre-handler by the SDK). |
| `TOO_MANY_TARGETS` | `solve_for_contrast` `targets` exceeded 50 entries (schema-enforced — over MCP rejected pre-handler by the SDK). |
| `INVALID_TARGET` | A `solve_for_contrast` target was not a finite number `>= 0`. |
| `INVALID_CHROMA` | `solve_for_contrast` `chroma` was not a finite number `>= 0`. |
| `INVALID_HUE` | `solve_for_contrast` `hue` was not a finite number. |
| `INTERNAL_ERROR` | Catch-all for any unexpected internal error. |

## Tool annotations and server metadata

All six tools are registered with MCP [tool annotations](https://modelcontextprotocol.io/) declaring them read-only and side-effect-free: `readOnlyHint: true`, `idempotentHint: true`, `destructiveHint: false`, and `openWorldHint: false` (purely local, in-memory computation — no network or filesystem access). Each tool also carries a human-readable `title` (e.g. "Parse CSS Color", "WCAG Contrast Ratio", "Solve for Contrast Target").

The server itself registers a `title` ("Color Engine") and an `instructions` string — server-level MCP metadata that summarizes the six tools, the OKLCH-first design, the output rounding conventions, and the error format for connecting clients (notably steering agents toward `solve_for_contrast` when they need to *meet* a ratio rather than merely *measure* one).

All of this metadata is purely additive. Clients that don't surface annotations or `instructions` simply ignore them, and every tool result carries both `structuredContent` and an equivalent plain-text content block — so clients that don't consume structured output lose nothing. The server sticks to the most universally supported slice of the MCP spec (stdio transport, `tools` only; no sampling or elicitation), which keeps behavior identical across host applications.

## Accuracy and performance

**Accuracy** (all verified in the test suite — reproduce with `npx vitest run`):

- **WCAG ratios** are validated against a **dual oracle**: a first-principles WCAG 2.1 luminance implementation and the independent `colorjs.io` 0.6.1 implementation, which must agree (within 0.005) before any assertion runs. Tier classification is checked with straddling color pairs just above/below each threshold (3.0 / 4.5 / 7.0), and a fixed-seed ramp fuzz cross-checks per-swatch ratios against `colorjs.io` within 0.02 across 40 random ramps.
- **hex ↔ OKLCH round-trips are byte-exact**: an 8,000-point deterministic grid across the sRGB cube plus 4,800 seeded random samples (60 seeds × 80 colors) all round-trip `convert_color(hex, "oklch")` → `parse_color` back to the identical hex.
- **APCA** matches the independent `colorjs.io` APCA implementation within **0.1 Lc** across 200 seeded color pairs, in both polarities.
- **gamut_map** returns 300 seeded in-gamut colors **bit-identically** and is idempotent on its own output.

**Performance** (median ms per call, measured on Node v25.9.0 via `npm run build && npm run bench` — indicative, not contractual):

| Call | Median ms |
|------|-----------|
| `parse_color` | 0.005 |
| `convert_color` | 0.002 |
| `contrast` | 0.004 |
| `gamut_map` (out-of-gamut input) | 0.015 |
| `generate_ramp` (steps=5) | 0.037 |
| `solve_for_contrast` (single target) | 0.067 |
| `generate_ramp` (steps=512, worst case) | 3.3 |
| `solve_for_contrast` (50 targets, worst case) | 2.7 |

Typical per-call compute is **0.002–0.07 ms**; the worst measured single call is ≈ **3.3 ms** (`generate_ramp` at the maximum `steps: 512`). Cold start (process spawn to the `initialize` response) measured ≈ **135 ms** median.

---

## MCP Configuration

This is a standard stdio MCP server using only the `tools` primitive, so any MCP-compatible client can register it the same way: point the client at a command that launches the server, and the client spawns and manages the process itself — nothing to start or keep running manually.

> **Once published to npm**, you can run the server without a local clone or build via `npx color-engine-mcp` (this package exposes a `color-engine-mcp` bin). For example:
>
> ```json
> {
>   "mcpServers": {
>     "color-engine": {
>       "command": "npx",
>       "args": ["-y", "color-engine-mcp"]
>     }
>   }
> }
> ```
>
> The configuration below runs a locally built `dist/server.js` instead.

Most JSON-configured clients accept this shape verbatim:

```json
{
  "mcpServers": {
    "color-engine": {
      "command": "node",
      "args": ["/absolute/path/to/color-engine-mcp/dist/server.js"]
    }
  }
}
```

Where the entry lives in a few common clients:

| Client | Config file |
|--------|-------------|
| Claude Code | `.mcp.json` in the project root |
| Claude Desktop | `claude_desktop_config.json` (e.g. `~/Library/Application Support/Claude/` on macOS) |
| Cursor | `.cursor/mcp.json` (per-project) or `~/.cursor/mcp.json` (global) |
| VS Code | `.vscode/mcp.json` — VS Code names the top-level key `servers` instead of `mcpServers` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

Other clients (Zed, JetBrains, custom agents built on an MCP SDK, …) differ only in the file location and occasionally the top-level key name — see their MCP server registration docs. Replace `/absolute/path/to/color-engine-mcp/dist/server.js` with the actual path to `dist/server.js` in your clone of this repository.

## Building

```sh
npm install
npm run build
```

The compiled server is at `dist/server.js`.

## Testing

```sh
npm test
```

Runs the full test suite (including MCP Inspector CLI integration tests via `npx @modelcontextprotocol/inspector --cli`). The `pretest` script runs `tsc` automatically to ensure `dist/server.js` is current before the Inspector tests run.

## Benchmarking

```sh
npm run build
npm run bench
```

Runs `scripts/bench.mjs` against the built `dist/` handlers (20 warmup + 200 timed iterations per case, reporting medians) — the source of the numbers in [Accuracy and performance](#accuracy-and-performance).
