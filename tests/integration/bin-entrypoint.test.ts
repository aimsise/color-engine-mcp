/**
 * Regression test — the bin entrypoint must connect the stdio transport when
 * invoked through a symlink, exactly as npm bin shims do
 * (node_modules/.bin/color-engine-mcp is a symlink to dist/server.js).
 *
 * v1.0.0 compared the raw process.argv[1] against the realpath'd
 * import.meta.url; under npx the two never matched, so the server exited
 * silently (code 0) without serving a single request.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, '../../dist/server.js');

const TEST_TIMEOUT = 30_000;
const RESPONSE_TIMEOUT = 15_000;

const INITIALIZE_REQUEST =
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'bin-entrypoint-test', version: '0.0.0' },
    },
  }) + '\n';

interface InitializeResult {
  serverInfo?: { name?: string; version?: string };
}

/** Spawn `node <entry>`, send initialize over stdio, resolve with the result. */
function initializeVia(entry: string): Promise<InitializeResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new Error(
          `no initialize response within ${RESPONSE_TIMEOUT}ms; ` +
            `stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`
        )
      );
    }, RESPONSE_TIMEOUT);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const line = stdout.split('\n').find((l) => l.trim().startsWith('{'));
      if (line && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        try {
          const response = JSON.parse(line) as { result?: InitializeResult };
          resolve(response.result ?? {});
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('exit', (code) => {
      // Exiting before any response is exactly the v1.0.0 bug signature.
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(
          new Error(
            `server exited (code ${code}) without responding to initialize; ` +
              `stderr=${JSON.stringify(stderr)}`
          )
        );
      }
    });
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });
    child.stdin.write(INITIALIZE_REQUEST);
  });
}

const tempDir = mkdtempSync(join(tmpdir(), 'color-engine-bin-'));

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('bin entrypoint guard', { timeout: TEST_TIMEOUT }, () => {
  it('responds to initialize when invoked directly (node dist/server.js)', async () => {
    const result = await initializeVia(serverPath);
    expect(result.serverInfo?.name).toBe('color-engine');
  });

  it('responds to initialize when invoked through a symlink (npm .bin shim shape)', async () => {
    const symlinkPath = join(tempDir, 'color-engine-mcp');
    symlinkSync(serverPath, symlinkPath);
    const result = await initializeVia(symlinkPath);
    expect(result.serverInfo?.name).toBe('color-engine');
  });
});
