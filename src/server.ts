import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import './init.js'; // side-effect: register culori modes
import { parseColor } from './tools/parse_color.js';

export const server = new McpServer({
  name: 'color-engine',
  version: '0.1.0',
});

server.registerTool(
  'parse_color',
  {
    description: 'Parse a CSS color string and return hex, rgb, oklch, and gamut info.',
    inputSchema: {
      input: z.string().describe('CSS color string, e.g. "tomato", "#ff6347", "oklch(0.6 0.18 27)"'),
    },
    outputSchema: {
      hex: z.string(),
      rgb: z.object({ r: z.number(), g: z.number(), b: z.number() }),
      oklch: z.object({ l: z.number(), c: z.number(), h: z.number() }),
      inGamut: z.boolean(),
    },
  },
  async ({ input }) => {
    return parseColor(input);
  }
);

// Only connect transport when run as entrypoint (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
