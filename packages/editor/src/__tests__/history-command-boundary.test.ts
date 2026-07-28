import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const workspaceRoot = join(packageRoot, "..", "..");
const sourceRoot = join(packageRoot, "src");
const moveCommandPath = join(sourceRoot, "history", "move-command.ts");
const rotateCommandPath = join(sourceRoot, "history", "rotate-command.ts");
const scaleCommandPath = join(sourceRoot, "history", "scale-command.ts");
const deleteCommandPath = join(sourceRoot, "history", "delete-command.ts");
const duplicateCommandPath = join(sourceRoot, "history", "duplicate-command.ts");
const coordinatorPath = join(sourceRoot, "history", "editor-history-coordinator.ts");
const commandAdapterPath = join(sourceRoot, "history", "manipulation-command-adapter.ts");
const shortcutsPath = join(sourceRoot, "history", "editor-history-shortcuts.ts");
const canvasSurfacePath = join(sourceRoot, "CanvasSurface.tsx");

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
}

async function productionSourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return productionSourceFiles(path);
      return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
}

describe("Stage 6 command dependency boundary", () => {
  it("declares History only at the editor coordination boundary", async () => {
    const manifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(manifest.dependencies?.["@folio/history"]).toBe("workspace:*");
  });

  it("keeps MoveCommand independent from interaction, rendering, React, and UI", async () => {
    const source = await readFile(moveCommandPath, "utf8");

    expect(source).toContain('from "@folio/document"');
    expect(source).toContain('from "@folio/history"');
    expect(source).not.toMatch(/@folio\/(?:manipulation|rendering|selection|ui)/u);
    expect(source).not.toMatch(/from ["'](?:react|electron)/u);
  });

  it("does not expose the private command from the editor package barrel", async () => {
    const barrel = await readFile(join(sourceRoot, "index.ts"), "utf8");

    expect(barrel).not.toContain("MoveCommand");
    expect(barrel).not.toContain("createMoveCommand");
    expect(barrel).not.toContain("createRotateCommand");
    expect(barrel).not.toContain("createScaleCommand");
    expect(barrel).not.toContain("createDeleteCommand");
    expect(barrel).not.toContain("createDuplicateCommand");
    expect(barrel).not.toContain("EditorHistoryCoordinator");
    expect(barrel).not.toContain("createEditorHistoryCoordinator");
    expect(barrel).not.toContain("createCommandForManipulation");
    expect(barrel).not.toContain("installEditorHistoryShortcuts");
    expect(barrel).not.toContain("resolveScalarTransformCommandInput");
    expect(barrel).not.toContain("transitionScalarTransform");
    expect(barrel).not.toContain("resolveLifecycleMetadata");
    expect(barrel).not.toContain("requireLifecycleObject");
  });

  it("stores no document aggregate or page object in the command", async () => {
    const source = await readFile(moveCommandPath, "utf8");

    expect(source).not.toMatch(
      /readonly\s+#[A-Za-z0-9_]+:\s*(?:InkObject|ObjectCollection|PageObject)/u,
    );
    expect(source).not.toMatch(/readonly\s+(?:after|before|document|snapshot)\s*:/u);
  });

  it("keeps Manipulation independent from Editor and History", async () => {
    const manipulationRoot = join(workspaceRoot, "packages", "manipulation", "src");
    const forbiddenImport = /@folio\/(?:editor|history)/u;
    const violations: string[] = [];

    for (const path of await productionSourceFiles(manipulationRoot)) {
      if (forbiddenImport.test(await readFile(path, "utf8"))) {
        violations.push(path.slice(manipulationRoot.length + 1));
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps History construction private and removes direct move mutation from CanvasSurface", async () => {
    const [
      coordinator,
      commandAdapter,
      shortcuts,
      canvasSurface,
      rotateCommand,
      scaleCommand,
      deleteCommand,
      duplicateCommand,
    ] = await Promise.all([
      readFile(coordinatorPath, "utf8"),
      readFile(commandAdapterPath, "utf8"),
      readFile(shortcutsPath, "utf8"),
      readFile(canvasSurfacePath, "utf8"),
      readFile(rotateCommandPath, "utf8"),
      readFile(scaleCommandPath, "utf8"),
      readFile(deleteCommandPath, "utf8"),
      readFile(duplicateCommandPath, "utf8"),
    ]);

    expect(coordinator).toContain("createEditorHistoryManager");
    expect(coordinator).toContain("createHistoryController");
    expect(coordinator).toContain("createCommandForManipulation");
    expect(coordinator).not.toContain("createMoveCommand");
    expect(commandAdapter).toContain('case "translation"');
    expect(commandAdapter).toContain('case "rotation"');
    expect(commandAdapter).toContain('case "scale"');
    expect(commandAdapter).toContain('case "delete"');
    expect(commandAdapter).toContain('case "duplicate"');
    expect(commandAdapter).toContain("createMoveCommand");
    expect(commandAdapter).toContain("createRotateCommand");
    expect(commandAdapter).toContain("createScaleCommand");
    expect(commandAdapter).toContain("createDeleteCommand");
    expect(commandAdapter).toContain("createDuplicateCommand");
    expect(rotateCommand).not.toMatch(/@folio\/(?:manipulation|rendering|selection|ui)/u);
    expect(scaleCommand).not.toMatch(/@folio\/(?:manipulation|rendering|selection|ui)/u);
    expect(deleteCommand).not.toMatch(/@folio\/(?:manipulation|rendering|selection|ui)/u);
    expect(duplicateCommand).not.toMatch(/@folio\/(?:manipulation|rendering|selection|ui)/u);
    expect(canvasSurface).toContain("createEditorHistoryCoordinator");
    expect(canvasSurface).toContain("executeManipulation");
    expect(canvasSurface).not.toContain("createEditorHistoryManager");
    expect(canvasSurface).not.toContain("createHistoryController");
    expect(canvasSurface).not.toMatch(/documentSession\.translateObject\s*\(/u);
    expect(shortcuts).not.toContain("createEditorHistoryManager");
    expect(shortcuts).not.toContain("createHistoryController");
  });
});
