import path from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";

test("launches the Electron shell and renders the Phase 1 screen", async () => {
  const repositoryRoot = process.cwd();
  const electronApp = await electron.launch({
    args: [path.join(repositoryRoot, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });

  try {
    const window = await electronApp.firstWindow();
    await expect(window).toHaveTitle("Folio");
    await expect(window.getByRole("heading", { name: "Folio" })).toBeVisible();
    await expect(window.getByRole("button", { name: "Foundation ready" })).toBeDisabled();
  } finally {
    await electronApp.close();
  }
});
