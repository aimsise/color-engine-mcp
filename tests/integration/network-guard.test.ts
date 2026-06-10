/**
 * AC-5 — No network I/O or filesystem writes in tool code.
 *
 * (a) Static: `grep -rE 'fetch\(|https?:|fs\.write' src/tools/` returns no matches.
 * (b) Runtime: stubs globalThis.fetch to throw 'network-forbidden', calls all 6
 *     handlers with valid inputs, asserts none throw or return 'network-forbidden'.
 */

import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseColorTool } from '../../src/tools/parse_color.js';
import { convertColorTool } from '../../src/tools/convert_color.js';
import { contrastTool } from '../../src/tools/contrast.js';
import { gamutMapTool } from '../../src/tools/gamut_map.js';
import { generateRampTool } from '../../src/tools/generate_ramp.js';
import { solveTool } from '../../src/tools/solve_for_contrast.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AC-5(a) — Static: no fetch/http/fs.write in src/tools/', () => {
  it('grep -rE finds no network or fs-write calls in src/tools/', () => {
    const result = spawnSync(
      'grep',
      ['-rE', 'fetch\\(|https?:|fs\\.write', join(repoRoot, 'src/tools/')],
      { encoding: 'utf8' }
    );
    // exit 1 means no matches (grep convention) — that's what we want.
    // exit 0 means matches found — that would be a failure.
    expect(result.stdout.trim(), `Unexpected network/fs-write calls found:\n${result.stdout}`).toBe('');
  });
});

describe('AC-5(b) — Runtime: fetch stub does not propagate through any tool handler', () => {
  it('parseColorTool with fetch stub does not throw network-forbidden', () => {
    vi.stubGlobal('fetch', () => { throw new Error('network-forbidden'); });
    const result = parseColorTool('#ff0000');
    const text = JSON.stringify(result);
    expect(text).not.toContain('network-forbidden');
    expect(result.isError).toBeFalsy();
  });

  it('convertColorTool with fetch stub does not throw network-forbidden', () => {
    vi.stubGlobal('fetch', () => { throw new Error('network-forbidden'); });
    const result = convertColorTool('#ff0000', 'oklch');
    const text = JSON.stringify(result);
    expect(text).not.toContain('network-forbidden');
    expect(result.isError).toBeFalsy();
  });

  it('contrastTool with fetch stub does not throw network-forbidden', () => {
    vi.stubGlobal('fetch', () => { throw new Error('network-forbidden'); });
    const result = contrastTool('#000000', '#ffffff');
    const text = JSON.stringify(result);
    expect(text).not.toContain('network-forbidden');
    expect(result.isError).toBeFalsy();
  });

  it('gamutMapTool with fetch stub does not throw network-forbidden', () => {
    vi.stubGlobal('fetch', () => { throw new Error('network-forbidden'); });
    const result = gamutMapTool('oklch(0.6 0.4 30)');
    const text = JSON.stringify(result);
    expect(text).not.toContain('network-forbidden');
    expect(result.isError).toBeFalsy();
  });

  it('generateRampTool with fetch stub does not throw network-forbidden', () => {
    vi.stubGlobal('fetch', () => { throw new Error('network-forbidden'); });
    const result = generateRampTool({ base: '#3b82f6', steps: 5 });
    const text = JSON.stringify(result);
    expect(text).not.toContain('network-forbidden');
    expect(result.isError).toBeFalsy();
  });

  it('solveTool with fetch stub does not throw network-forbidden', () => {
    vi.stubGlobal('fetch', () => { throw new Error('network-forbidden'); });
    const result = solveTool({ background: '#ffffff', target: 4.5, prefer: 'darker' });
    const text = JSON.stringify(result);
    expect(text).not.toContain('network-forbidden');
    expect(result.isError).toBeFalsy();
  });
});
