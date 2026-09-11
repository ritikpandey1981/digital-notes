import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  createEmptyFolioProject,
  decodeFolioProject,
  encodeFolioProject,
} from "../../packages/persistence/src/project/index";
import type { DesktopProjectSavePort } from "../../apps/desktop/electron/project-save-contract";
import { launchFolio, surfaceOf } from "./layers-stack-helpers";

test("exposes a narrow save bridge and writes projects without File UI", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "folio-bridge-test-"));
  const destination = path.join(directory, "bridge.folio");
  const { app, window } = await launchFolio();
  try {
    await expect(surfaceOf(window)).toHaveAttribute("data-document-state", "ready");
    expect(
      await window.evaluate(() => {
        const bridge = (window as unknown as { folio: { projects: DesktopProjectSavePort } }).folio;
        return {
          methods: Object.keys(bridge.projects),
          node: typeof (window as unknown as { require?: unknown }).require,
        };
      }),
    ).toEqual({ methods: ["save"], node: "undefined" });
    // Stub only the native destination picker; the production IPC, authorization,
    // target registry, and atomic writer all run unchanged against a temp directory.
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath,
      })) as typeof dialog.showSaveDialog;
    }, destination);
    const project = createEmptyFolioProject({ title: "Bridge logical title" });
    const content = encodeFolioProject(project);
    const first = await window.evaluate(async (content) => {
      const bridge = (window as unknown as { folio: { projects: DesktopProjectSavePort } }).folio;
      return bridge.projects.save({ kind: "saveAs", title: "Bridge logical title", content });
    }, content);
    expect(first.status).toBe("saved");
    if (first.status !== "saved") throw new Error("Expected saved backing");
    expect(Object.keys(first.backing).sort()).toEqual(["displayName", "id"]);
    expect(first.backing.displayName).toBe("bridge.folio");
    expect(await readFile(destination, "utf8")).toBe(content);
    expect(decodeFolioProject(await readFile(destination, "utf8")).metadata.title).toBe(
      "Bridge logical title",
    );

    const second = await window.evaluate(
      async ({ targetId, content }) => {
        const bridge = (window as unknown as { folio: { projects: DesktopProjectSavePort } }).folio;
        return bridge.projects.save({ kind: "save", targetId, content });
      },
      { targetId: first.backing.id, content },
    );
    expect(second).toEqual(first);
    expect(
      await window.evaluate(async () => {
        const bridge = (window as unknown as { folio: { projects: DesktopProjectSavePort } }).folio;
        return bridge.projects.save({ kind: "save", targetId: "unapproved-path", content: "x" });
      }),
    ).toMatchObject({ status: "failed", error: { code: "INVALID_REQUEST" } });

    await window.getByTestId("top-chrome-application").click();
    await expect(window.getByRole("menuitem", { name: /^(New|Open|Save|Save As)$/ })).toHaveCount(
      0,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
