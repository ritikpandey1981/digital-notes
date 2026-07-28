import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const workspaceRoot = join(packageRoot, "..", "..");
const sourceRoot = join(packageRoot, "src");
const moveCommandPath = join(sourceRoot, "history", "move-command.ts");
const coordinatorPath = join(sourceRoot, "history", "editor-history-coordinator.ts");
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
    expect(barrel).not.toContain("EditorHistoryCoordinator");
    expect(barrel).not.toContain("createEditorHistoryCoordinator");
    expect(barrel).not.toContain("installEditorHistoryShortcuts");
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
    const [coordinator, shortcuts, canvasSurface] = await Promise.all([
      readFile(coordinatorPath, "utf8"),
      readFile(shortcutsPath, "utf8"),
      readFile(canvasSurfacePath, "utf8"),
    ]);

    expect(coordinator).toContain("createEditorHistoryManager");
    expect(coordinator).toContain("createHistoryController");
    expect(canvasSurface).toContain("createEditorHistoryCoordinator");
    expect(canvasSurface).not.toContain("createEditorHistoryManager");
    expect(canvasSurface).not.toContain("createHistoryController");
    expect(canvasSurface).not.toMatch(/documentSession\.translateObject\s*\(/u);
    expect(shortcuts).not.toContain("createEditorHistoryManager");
    expect(shortcuts).not.toContain("createHistoryController");
  });
});
