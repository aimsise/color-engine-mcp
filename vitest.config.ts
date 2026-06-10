import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // Passing ratchet (TEST-4): thresholds set a few points BELOW the
      // measured baseline (stmts 89.2 / branch 81.71 / funcs 86.95 /
      // lines 89.58) so coverage cannot silently regress, while leaving
      // headroom so a small src change does not break the build. Raise
      // these as coverage improves.
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 83,
        lines: 85,
      },
    },
  },
});
