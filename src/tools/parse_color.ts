import { formatHex, inGamut } from 'culori/fn';
import { toRgb, toOklch } from '../init.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function parseColor(input: string): CallToolResult {
  try {
    const rgb = toRgb(input);
    if (!rgb) {
      return {
        content: [{ type: 'text', text: `Error: could not parse color "${input}"` }],
        isError: true,
      };
    }

    const oklch = toOklch(rgb)!;
    const hex = formatHex(rgb);
    const gamut = inGamut('rgb')(rgb);

    const structured = {
      hex,
      rgb: { r: rgb.r, g: rgb.g, b: rgb.b },
      oklch: { l: oklch.l, c: oklch.c, h: oklch.h ?? 0 },
      inGamut: gamut,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
}
