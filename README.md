# color-engine MCP Server

A Model Context Protocol (MCP) server providing 6 CSS color utilities: parsing, conversion, gamut mapping, WCAG contrast, tint/shade ramp generation, and contrast-target solving. All tools operate purely in-memory — no network I/O, no filesystem writes.

## Tools

### parse_color

Parse any CSS color string and return hex, RGB, OKLCH, and gamut info.

**Input schema**

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| input | string | yes      | Any CSS color string, e.g. `"#ff0000"`, `"red"`, `"oklch(0.6 0.2 30)"` |

**Output schema**

```json
{
  "hex": "#ff0000",
  "rgb": { "r": 255, "g": 0, "b": 0 },
  "oklch": { "l": 0.62796, "c": 0.25768, "h": 29.23 },
  "inGamut": true
}
```

**Example**

```json
{ "input": "#ff0000" }
```

---

### convert_color

Convert a CSS color string into a canonical hex, rgb, hsl, or oklch format string.

**Input schema**

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| input | string | yes      | Any CSS color string |
| to    | string | yes      | Target format: `"hex"`, `"rgb"`, `"hsl"`, or `"oklch"` |

**Output schema**

```json
{ "result": "oklch(0.62796 0.25768 29.23)" }
```

**Example**

```json
{ "input": "#ff0000", "to": "oklch" }
```

---

### contrast

Compute the WCAG 2.1 contrast ratio between two CSS color strings and return tier flags.

**Input schema**

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| a     | string | yes      | First CSS color string, e.g. `"#000000"` |
| b     | string | yes      | Second CSS color string, e.g. `"#ffffff"` |

**Output schema**

```json
{
  "ratio": 21.0,
  "aaNormal": true,
  "aaLarge": true,
  "aaaNormal": true,
  "aaaLarge": true
}
```

WCAG 2.1 tier thresholds:
- `aaNormal` / `aaLarge` require ratio ≥ 4.5 / ≥ 3.0
- `aaaNormal` / `aaaLarge` require ratio ≥ 7.0 / ≥ 4.5

**Example**

```json
{ "a": "#000000", "b": "#ffffff" }
```

---

### gamut_map

Map any CSS color string into the sRGB gamut via perceptual OKLCH chroma reduction. Useful for converting wide-gamut colors (P3, Rec2020, arbitrary OKLCH) to displayable sRGB.

**Input schema**

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| input | string | yes      | Any CSS color string, e.g. `"oklch(0.6 0.4 30)"` |

**Output schema**

```json
{
  "hex": "#ff4c2b",
  "oklch": { "l": 0.6, "c": 0.2, "h": 30 },
  "clamped": true
}
```

`clamped` is `true` when the input was outside the sRGB gamut and had to be mapped.

**Example**

```json
{ "input": "oklch(0.6 0.4 30)" }
```

---

### generate_ramp

Generate a tint-to-shade color ramp from a base CSS color. Returns an ordered list of swatches (light to dark) each with hex, OKLCH, WCAG contrast ratios vs white and black, and a gamut flag.

**Input schema**

| Field        | Type    | Required | Description |
|--------------|---------|----------|-------------|
| base         | string  | yes      | Any CSS color string, e.g. `"#3b82f6"` |
| steps        | integer | no       | Number of swatches (2–512). Default: 5 |
| lightnessMin | number  | no       | Lower lightness endpoint (OKLCH L, 0–1). Default: 0.05 |
| lightnessMax | number  | no       | Upper lightness endpoint (OKLCH L, 0–1). Default: 0.97 |
| deltaL       | number  | no       | Symmetric lightness span centered on the base L (overrides fixed range) |

**Output schema**

```json
{
  "swatches": [
    {
      "step": 1,
      "hex": "#e8f0fe",
      "oklch": { "l": 0.95, "c": 0.03, "h": 264 },
      "vsWhite": { "ratio": 1.12, "tier": "FAIL" },
      "vsBlack": { "ratio": 18.75, "tier": "AAA" },
      "inGamut": true
    }
  ]
}
```

**Example**

```json
{ "base": "#3b82f6", "steps": 9 }
```

---

### solve_for_contrast

Find a foreground color that meets one or more WCAG 2.1 contrast targets against a background. Binary-searches OKLCH lightness (holding hue/chroma fixed).

**Input schema**

| Field      | Type                         | Required | Description |
|------------|------------------------------|----------|-------------|
| background | string                       | yes      | Background CSS color string |
| target     | number                       | one of   | Single WCAG 2.1 contrast target (e.g. 4.5, 7) |
| targets    | number[]                     | one of   | Multiple contrast targets (max 50) |
| prefer     | `"lighter"`,`"darker"`,`"either"` | no  | Search direction. Default: `"either"` |
| hue        | number                       | no       | Fixed OKLCH hue (degrees) |
| chroma     | number                       | no       | Fixed OKLCH chroma (≥ 0) |

**Output schema** (single target)

```json
{ "met": true, "color": "#1a1a1a", "ratio": 14.73 }
```

**Output schema** (multiple targets via `targets`)

```json
{
  "results": [
    { "met": true, "color": "#1a1a1a", "ratio": 14.73 },
    { "met": false, "color": "#333333", "ratio": 6.82 }
  ]
}
```

`nearMiss: true` may appear when `met` was granted via the near-ceiling tolerance (the best achievable ratio is within 0.03 of the target because the target is physically unreachable on every direction).

**Example**

```json
{ "background": "#ffffff", "target": 4.5, "prefer": "darker" }
```

---

## MCP Configuration

### Claude Code (`.mcp.json`)

Add to your project's `.mcp.json`:

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

### Claude Desktop (`claude_desktop_config.json`)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on your OS:

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

Replace `/absolute/path/to/color-engine-mcp/dist/server.js` with the actual path to `dist/server.js` in your clone of this repository.

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
