import { describe, it, expect } from 'vitest';
import { server } from './server.js';

describe('server smoke test', () => {
  it('registers at least one tool (parse_color)', () => {
    // In @modelcontextprotocol/sdk 1.29.0 the internal registry is a plain
    // record keyed by tool name (NOT a Map), so inspect it via Object.keys.
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    const toolNames = Object.keys(tools);
    expect(toolNames.length).toBeGreaterThan(0);
    expect(toolNames).toContain('parse_color');
  });

  it('exposes a human-readable title and usage instructions', () => {
    // SDK 1.29.0: serverInfo (incl. title) is stored on the underlying
    // Server as _serverInfo, and ServerOptions.instructions as _instructions.
    const inner = server.server as unknown as {
      _serverInfo: { name: string; title?: string; version: string };
      _instructions?: string;
    };
    expect(inner._serverInfo.title).toBe('Color Engine');
    expect(inner._instructions).toBeTypeOf('string');
    expect(inner._instructions).toContain('solve_for_contrast');
    expect(inner._instructions).toContain('CODE: static message');
  });
});
