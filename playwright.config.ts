import { defineConfig } from "@playwright/test";
// Loaded in every worker before its specs, so teardown can end an app that is
// holding unsaved work. See the module for why quit, and only quit, is forced.
import "./tests/e2e/force-quit-teardown";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  // Electron pointer input targets the foreground desktop window and is not cross-process safe.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  timeout: 30_000,
});
