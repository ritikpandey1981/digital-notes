import { defineConfig } from "@playwright/test";
import "../e2e/electron-test-app";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 3_600_000,
  retries: 0,
  reporter: "list",
  outputDir: "../../test-results/performance",
});
