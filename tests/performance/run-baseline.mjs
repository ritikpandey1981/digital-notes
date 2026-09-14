import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const run = process.env.FOLIO_BASELINE_RUN ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
const output = path.resolve("test-results/performance-data", run);
mkdirSync(output, { recursive: true });
const started = new Date();
const args = process.argv.slice(2);
const manifest = {
  startedAt: started.toISOString(),
  command: [process.execPath, "tests/performance/run-baseline.mjs", ...args],
  run,
  groups: process.env.FOLIO_BASELINE_GROUPS ?? "all",
  stages: process.env.FOLIO_BASELINE_STAGES ?? "all",
  modelSizes: process.env.FOLIO_BASELINE_MODEL_SIZES ?? "all",
  performanceMode: true,
};
writeFileSync(path.join(output, "run.json"), JSON.stringify(manifest, null, 2));
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--config=tests/performance/playwright.config.ts",
    ...args,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, FOLIO_PERFORMANCE_BASELINE: "1", FOLIO_BASELINE_RUN: run },
  },
);
writeFileSync(
  path.join(output, "run.json"),
  JSON.stringify(
    {
      ...manifest,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - started.getTime(),
      exitCode: result.status,
      signal: result.signal,
      ...(result.error ? { error: result.error.message } : {}),
    },
    null,
    2,
  ),
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
