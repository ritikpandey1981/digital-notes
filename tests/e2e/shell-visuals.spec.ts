import fs from "node:fs";
import path from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";

test("captures the sketchbook shell in dark and light appearances", async ({
  browserName,
}, testInfo) => {
  void browserName;
  const repositoryRoot = process.cwd();
  const screenshotDirectory =
    process.env.FOLIO_SCREENSHOT_DIR ?? testInfo.outputPath("phase-6-screenshots");
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
    await expect(window.locator("canvas[data-folio-renderer='true']")).toHaveAttribute(
      "data-render-count",
      /[1-9]\d*/,
    );

    await window.screenshot({
      path: path.join(screenshotDirectory, "phase-16-5-light.png"),
      animations: "disabled",
    });

    await window.getByRole("button", { name: "Application menu", exact: true }).click();
    await window.getByRole("menuitem", { name: "Use dark appearance", exact: true }).click();
    await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(window.locator("canvas[data-folio-renderer='true']")).toHaveAttribute(
      "data-render-count",
      /[2-9]\d*|1\d+/,
    );

    await window.screenshot({
      path: path.join(screenshotDirectory, "phase-16-5-dark.png"),
      animations: "disabled",
    });
  } finally {
    await electronApp.close();
  }
});
