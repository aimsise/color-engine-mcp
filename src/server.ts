import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'node:url';
import './init.js'; // side-effect: register culori modes
import { registerParseColor } from './tools/parse_color.js';
import { registerConvertColor } from './tools/convert_color.js';
import { registerContrast } from './tools/contrast.js';
import { registerGamutMap } from './tools/gamut_map.js';
import { registerGenerateRamp } from './tools/generate_ramp.js';
import { registerSolveForContrast } from './tools/solve_for_contrast.js';

export const server = new McpServer({
  name: 'color-engine',
  version: '0.1.0',
});

// Each tool owns its own `registerTool` call (with input + output zod schemas)
// inside its tool file; server.ts just wires them in.
registerParseColor(server);
registerConvertColor(server);
registerContrast(server);
registerGamutMap(server);
registerGenerateRamp(server);
registerSolveForContrast(server);

// Only connect transport when run as entrypoint (not when imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
