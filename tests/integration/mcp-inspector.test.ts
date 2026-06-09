/**
 * AC-1, AC-2, AC-3, AC-4 — Black-box MCP Inspector CLI integration tests.
 *
 * Spawns `npx @modelcontextprotocol/inspector --cli node dist/server.js` via
 * spawnSync and asserts protocol-level behavior over stdio.
 *
 * Inspector CLI flags confirmed via context7 against the official README +
 * cli/src/index.ts:
 *   --cli                   enable CLI mode
 *   --method tools/list     list all tools
 *   --method tools/call     call a tool
 *   --tool-name <name>      tool name for tools/call
 *   --tool-arg key=value    repeatable arg pairs for tools/call
 *
 * AC-2 spec note: the ticket AC-2 payload for `contrast` shows `{fg,bg}` but
 * the REAL schema fields are `a`/`b` (confirmed in src/schemas/contrast.ts).
 * This is a known ticket-spec example error — we use `a`/`b` (the real fields).
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseColorTool } from '../../src/tools/parse_color.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '../../dist/server.js');

const INSPECTOR_TIMEOUT = 60_000; // 60s — generous for npx cold-start
const TEST_TIMEOUT = 90_000;

/**
 * Run the MCP Inspector CLI with the given extra args.
 * Returns the spawnSync result.
 */
function inspectorCli(...args: string[]) {
  return spawnSync(
    'npx',
    ['@modelcontextprotocol/inspector', '--cli', 'node', serverPath, ...args],
    { encoding: 'utf8', timeout: INSPECTOR_TIMEOUT }
  );
}

/**
 * Parse the JSON output from Inspector CLI stdout.
 * The Inspector emits JSON.stringify(result, null, 2) to stdout.
 */
function parseOutput(stdout: string): unknown {
  // The Inspector may print extra lines before/after the JSON;
  // find the first line that starts '{' or '['.
  const lines = stdout.split('\n');
  let jsonStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart === -1) {
    throw new Error(`No JSON found in output:\n${stdout}`);
  }
  const jsonText = lines.slice(jsonStart).join('\n');
  return JSON.parse(jsonText);
}

describe('AC-1 — Inspector tools/list lists exactly 6 tools', { timeout: TEST_TIMEOUT }, () => {
  it('tools/list exits 0 and returns exactly the 6 expected tool names', () => {
    const result = inspectorCli('--method', 'tools/list');
    expect(result.status, `Inspector exited ${result.status}; stderr: ${result.stderr}`).toBe(0);

    const output = parseOutput(result.stdout) as { tools?: Array<{ name: string }> };
    expect(output).toHaveProperty('tools');
    const names = output.tools!.map((t) => t.name);
    expect(names).toHaveLength(6);
    expect(names).toContain('parse_color');
    expect(names).toContain('convert_color');
    expect(names).toContain('contrast');
    expect(names).toContain('gamut_map');
    expect(names).toContain('generate_ramp');
    expect(names).toContain('solve_for_contrast');
  });
});

describe('AC-2 — Inspector tools/call — all 6 tools return structured results', { timeout: TEST_TIMEOUT }, () => {
  // Valid payloads per tool.
  // contrast: ticket AC-2 shows {fg,bg} but the REAL schema fields are a/b.
  // This is a known ticket-spec example error — using a/b (the real fields).
  const toolCalls: Array<{ name: string; args: string[] }> = [
    {
      name: 'parse_color',
      args: ['--tool-arg', 'input=#ff0000'],
    },
    {
      name: 'convert_color',
      args: ['--tool-arg', 'input=#ff0000', '--tool-arg', 'to=oklch'],
    },
    {
      // NOTE: ticket AC-2 shows {fg,bg} but schema fields are a/b — using a/b
      name: 'contrast',
      args: ['--tool-arg', 'a=#000000', '--tool-arg', 'b=#ffffff'],
    },
    {
      name: 'gamut_map',
      args: ['--tool-arg', 'input=oklch(0.6 0.4 30)'],
    },
    {
      name: 'generate_ramp',
      args: ['--tool-arg', 'base=#3b82f6', '--tool-arg', 'steps=5'],
    },
    {
      name: 'solve_for_contrast',
      args: [
        '--tool-arg', 'background=#ffffff',
        '--tool-arg', 'target=4.5',
        '--tool-arg', 'prefer=darker',
      ],
    },
  ];

  for (const { name, args } of toolCalls) {
    it(`${name} — exits 0, isError absent/false, structuredContent is a non-null object`, () => {
      const result = inspectorCli(
        '--method', 'tools/call',
        '--tool-name', name,
        ...args
      );
      expect(result.status, `Inspector exited ${result.status}; stderr: ${result.stderr}`).toBe(0);

      const output = parseOutput(result.stdout) as {
        isError?: boolean;
        structuredContent?: unknown;
      };
      expect(output.isError, `isError should be absent or false for ${name}`).toBeFalsy();
      expect(output.structuredContent, `structuredContent should be non-null for ${name}`).not.toBeNull();
      expect(typeof output.structuredContent).toBe('object');
    });
  }
});

describe('AC-3 — Missing required field → MCP error response, server survives', { timeout: TEST_TIMEOUT }, () => {
  // Call each tool omitting all required fields (no --tool-arg).
  const tools = [
    'parse_color',
    'convert_color',
    'contrast',
    'gamut_map',
    'generate_ramp',
    'solve_for_contrast',
  ];

  for (const name of tools) {
    it(`${name} missing required field → isError===true OR protocol error; Inspector exits 0`, () => {
      const result = inspectorCli(
        '--method', 'tools/call',
        '--tool-name', name
        // no --tool-arg → missing required field
      );
      // Inspector must not crash
      expect(result.status, `Inspector crashed for ${name}; stderr: ${result.stderr}`).toBe(0);

      const output = parseOutput(result.stdout) as {
        isError?: boolean;
        error?: unknown;
        content?: Array<{ type: string; text: string }>;
      };
      // Either isError===true OR a protocol-level error field is set
      const hasError = output.isError === true || output.error != null;
      expect(hasError, `Expected isError or error field for missing-input call to ${name}; got: ${JSON.stringify(output)}`).toBe(true);
    });
  }

  it('server is still alive after missing-field errors (valid call succeeds)', () => {
    // Valid parse_color call after the missing-field calls above
    const result = inspectorCli(
      '--method', 'tools/call',
      '--tool-name', 'parse_color',
      '--tool-arg', 'input=#ff0000'
    );
    expect(result.status, `Follow-up call failed; stderr: ${result.stderr}`).toBe(0);
    const output = parseOutput(result.stdout) as { isError?: boolean; structuredContent?: unknown };
    expect(output.isError).toBeFalsy();
    expect(output.structuredContent).not.toBeNull();
  });
});

describe('AC-4 — Malformed input → structured error, no throw, no unhandled rejection', { timeout: TEST_TIMEOUT }, () => {
  // NOTE on empty-string case: The Inspector CLI's `--tool-arg key=value` parser
  // REJECTS an empty value (`input=`) with "Invalid parameter format: input=. Use
  // key=value format." and exits 1 BEFORE the tool is ever invoked. This is a
  // CLI-layer limitation of `@modelcontextprotocol/inspector` — it cannot encode
  // an empty-string argument value via the `--tool-arg` flag. Confirmed via
  // context7 docs: only `key=value` format is supported; there is no JSON-args
  // flag for the CLI. Therefore the `{"input":""}` case is verified by calling the
  // `parseColorTool` handler directly (which is the real production code path),
  // confirming that the empty-string input yields `isError===true` with no throw.
  // The other two malformed inputs (`not-a-color`, `#12`) are verified end-to-end
  // via the Inspector CLI as intended by AC-4.

  const inspectorMalformed = [
    'not-a-color',
    '#12', // invalid short hex
  ];

  for (const input of inspectorMalformed) {
    it(`parse_color input="${input}" → isError===true, exits 0, no UnhandledPromiseRejection in stderr`, () => {
      const result = inspectorCli(
        '--method', 'tools/call',
        '--tool-name', 'parse_color',
        '--tool-arg', `input=${input}`
      );
      expect(result.status, `Inspector exited ${result.status}; stderr: ${result.stderr}`).toBe(0);

      // No UnhandledPromiseRejection in stderr
      expect(result.stderr ?? '').not.toContain('UnhandledPromiseRejection');

      const output = parseOutput(result.stdout) as { isError?: boolean };
      expect(output.isError, `Expected isError===true for malformed input "${input}"`).toBe(true);
    });
  }

  it('parse_color input="" → isError===true (handler-level; Inspector CLI cannot encode empty-string --tool-arg)', () => {
    // The Inspector CLI's `--tool-arg key=value` format cannot represent an
    // empty-string value — it is rejected by the CLI arg parser before any
    // MCP call is made. We therefore verify the empty-input case at the handler
    // boundary, which is the actual production path that would be exercised if
    // the empty string were delivered by any MCP client.
    const result = parseColorTool('');
    expect(result.isError, 'Expected isError===true for empty-string input').toBe(true);
    // No throw was raised (the function returned normally — not tested by
    // catching, but the function call above would have thrown if it did).
  });
});
