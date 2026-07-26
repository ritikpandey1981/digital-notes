import path from "node:path";
import { expect, test, _electron as electron } from "@playwright/test";

test("launches and exercises the Phase 2 application shell", async () => {
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
    await expect(window.getByRole("toolbar", { name: "Notebook tools" })).toBeVisible();
    await expect(window.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    await expect(window.getByLabel("Notebook workspace")).toBeVisible();
    const canvasHost = window.getByTestId("canvas-host");
    await expect(canvasHost).toHaveAttribute("data-canvas-state", "placeholder");
    await canvasHost.evaluate((host) => host.setAttribute("data-mount-probe", "retained"));
    await expect(window.getByText("Page 1 of 12")).toBeVisible();

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await expect(window.getByRole("contentinfo")).toContainText("Pen");

    await window.getByRole("button", { name: "Show notification preview" }).click();
    await expect(window.getByRole("status")).toContainText("Shell ready");

    await window.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(window.getByRole("dialog")).toContainText("Appearance");
    await window.getByRole("button", { name: "Cancel" }).click();

    await window.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(canvasHost).toHaveAttribute("data-mount-probe", "retained");
  } finally {
    await electronApp.close();
  }
});
