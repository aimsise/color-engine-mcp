#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import './init.js'; // side-effect: register culori modes
import { registerParseColor } from './tools/parse_color.js';
import { registerConvertColor } from './tools/convert_color.js';
import { registerContrast } from './tools/contrast.js';
import { registerGamutMap } from './tools/gamut_map.js';
import { registerGenerateRamp } from './tools/generate_ramp.js';
import { registerSolveForContrast } from './tools/solve_for_contrast.js';

export const server = new McpServer(
  {
    name: 'color-engine',
    title: 'Color Engine',
    version: '1.0.1',
  },
  {
    instructions: [
      'Color Engine: six pure, in-memory CSS color tools.',
      'parse_color parses any supported CSS color string to canonical forms;',
      'convert_color converts a color between CSS notations;',
      'contrast computes the WCAG 2.1 contrast ratio (optionally APCA Lc) and pass/fail levels for a fg/bg pair;',
      'gamut_map maps an out-of-sRGB-gamut color into sRGB (idempotent; in-gamut inputs pass through unchanged);',
      'generate_ramp builds an OKLCH lightness ramp with contrast-tiered swatches (optionally as design tokens);',
      'solve_for_contrast adjusts a color’s OKLCH lightness until it meets a target contrast ratio against a background.',
      'Design is OKLCH-first: ramps and solving operate in OKLCH for perceptual uniformity, and displayed outputs are sRGB-clamped hex plus rounded OKLCH (L/C 5dp, H 2dp; ratios 2dp).',
      'Tool errors come back as isError results whose text is "CODE: static message" (e.g. "PARSE_FAILED: could not parse the color string"); raw input is never echoed.',
      'Prefer solve_for_contrast over contrast when you need a color that MEETS a target ratio (it searches lightness for you); use contrast only to measure an existing fg/bg pair.',
    ].join(' '),
  },
);

// Each tool owns its own `registerTool` call (with input + output zod schemas)
// inside its tool file; server.ts just wires them in.
registerParseColor(server);
registerConvertColor(server);
registerContrast(server);
registerGamutMap(server);
registerGenerateRamp(server);
registerSolveForContrast(server);

// Only connect transport when run as entrypoint (not when imported by tests).
// argv[1] must be realpath'd: npm bin shims invoke this file through a
// symlink (node_modules/.bin/color-engine-mcp), while import.meta.url is
// already symlink-resolved by the ESM loader — a raw comparison never
// matches under npx and the server would exit without connecting.
const isEntrypoint = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (isEntrypoint) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
