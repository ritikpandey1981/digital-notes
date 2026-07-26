import fs from "node:fs";
import path from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";

test("captures the Phase 2 shell in light and dark themes", async ({ browserName }, testInfo) => {
  void browserName;
  const repositoryRoot = process.cwd();
  const screenshotDirectory =
    process.env.FOLIO_SCREENSHOT_DIR ?? testInfo.outputPath("phase-2-screenshots");
  fs.mkdirSync(screenshotDirectory, { recursive: true });

  const electronApp = await electron.launch({
    args: [path.join(repositoryRoot, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });

  try {
    const window = await electronApp.firstWindow();
    await window.setViewportSize({ width: 1440, height: 900 });
    await expect(window.locator("html")).toHaveAttribute("data-theme", "light");

    await window.screenshot({
      path: path.join(screenshotDirectory, "phase-2-light.png"),
      animations: "disabled",
    });

    await window.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");

    await window.screenshot({
      path: path.join(screenshotDirectory, "phase-2-dark.png"),
      animations: "disabled",
    });
  } finally {
    await electronApp.close();
  }
});
