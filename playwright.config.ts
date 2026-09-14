import { defineConfig } from "@playwright/test";
// Loaded in every worker before its specs, so each launched app gets its own
// application data directory and can be ended even while holding unsaved work.
import "./tests/e2e/electron-test-app";

export default defineConfig({
  testDir: "./tests/e2e",
  // Keep normal-suite cleanup away from retained performance measurements.
  outputDir: "./test-results/e2e",
  fullyParallel: false,
  // Electron pointer input targets the foreground desktop window and is not cross-process safe.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  timeout: 30_000,
});
