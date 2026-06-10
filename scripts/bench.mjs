/**
 * Micro-benchmark for the six color-engine tool handlers.
 *
 * IMPORTANT: this script imports the BUILT handlers from `dist/`, so run
 * `npm run build` first (or just `npm install`, whose prepare hook builds).
 * Then: `npm run bench`
 *
 * Method: for each case, 20 warmup calls, then 200 timed iterations with
 * `performance.now()`; the MEDIAN ms per call is printed. Covers a typical
 * input per tool plus the two worst cases (generate_ramp steps=512 and
 * solve_for_contrast with 50 targets). Pure in-memory work: no network, no
 * filesystem writes.
 */
import { performance } from 'node:perf_hooks';

// Side-effect import FIRST: registers the culori color modes the handlers
// rely on (mirrors src/init.ts ordering in the server entrypoint).
await import(new URL('../dist/init.js', import.meta.url).href);

const tools = await import(new URL('../dist/tools/index.js', import.meta.url).href);

const WARMUP = 20;
const ITERATIONS = 200;

/** 50 contrast targets spread across the meaningful WCAG range (1.5..13.75). */
const fiftyTargets = Array.from({ length: 50 }, (_, i) => 1.5 + i * 0.25);

const cases = [
  {
    name: 'parse_color (typical)',
    run: () => tools.parseColorTool('oklch(0.62 0.19 259.81)'),
  },
  {
    name: 'convert_color (typical)',
    run: () => tools.convertColorTool('#3b82f6', 'oklch'),
  },
  {
    name: 'contrast (typical)',
    run: () => tools.contrastTool('#3b82f6', '#ffffff'),
  },
  {
    name: 'gamut_map (typical, out-of-gamut)',
    run: () => tools.gamutMapTool('oklch(0.7 0.35 150)'),
  },
  {
    name: 'generate_ramp (typical, steps=5)',
    run: () => tools.generateRampTool({ base: '#3b82f6', steps: 5 }),
  },
  {
    name: 'solve_for_contrast (typical, single target)',
    run: () => tools.solveTool({ background: '#ffffff', target: 4.5 }),
  },
  {
    name: 'generate_ramp (WORST CASE, steps=512)',
    run: () => tools.generateRampTool({ base: '#3b82f6', steps: 512 }),
  },
  {
    name: 'solve_for_contrast (WORST CASE, 50 targets)',
    run: () => tools.solveTool({ background: '#ffffff', targets: fiftyTargets }),
  },
];

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

console.log(`color-engine-mcp benchmark (median of ${ITERATIONS} iterations, ${WARMUP} warmup)`);
console.log(`node ${process.version}\n`);

let failed = 0;
for (const c of cases) {
  // Sanity check: a benchmark of an unexpected error path would be misleading.
  const probe = c.run();
  if (probe?.isError) {
    console.log(`${c.name.padEnd(48)} SKIPPED (handler returned isError)`);
    failed += 1;
    continue;
  }

  for (let i = 0; i < WARMUP; i += 1) c.run();

  const samples = new Array(ITERATIONS);
  for (let i = 0; i < ITERATIONS; i += 1) {
    const t0 = performance.now();
    c.run();
    samples[i] = performance.now() - t0;
  }

  console.log(`${c.name.padEnd(48)} median ${median(samples).toFixed(3)} ms`);
}

if (failed > 0) {
  console.error(`\n${failed} case(s) skipped due to handler errors.`);
  process.exitCode = 1;
}
