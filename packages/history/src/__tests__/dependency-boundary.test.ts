import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const sourceRoot = join(packageRoot, "src");
const editorHistoryRoot = join(sourceRoot, "editor-history");

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
}

async function productionSourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry): Promise<readonly string[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : productionSourceFiles(path);
      }
      return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
    }),
  );
  return files.flat();
}

describe("@folio/history dependency boundary", () => {
  it("keeps Persistence development-only for legacy compatibility tests", async () => {
    const manifest = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as PackageManifest;

    expect(manifest.dependencies?.["@folio/persistence"]).toBeUndefined();
    expect(manifest.devDependencies?.["@folio/persistence"]).toBe("workspace:*");
  });

  it("contains no production import of Persistence", async () => {
    const importsPersistence = /(?:from\s+|import\s*\()\s*["']@folio\/persistence(?:[/"'])/u;
    const violations: string[] = [];

    for (const path of await productionSourceFiles(sourceRoot)) {
      if (importsPersistence.test(await readFile(path, "utf8"))) {
        violations.push(path.slice(packageRoot.length + 1));
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps every generic History contract free of package dependencies", async () => {
    const importSpecifier = /(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu;
    const violations: string[] = [];

    for (const path of await productionSourceFiles(editorHistoryRoot)) {
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(importSpecifier)) {
        const specifier = match[1];
        if (specifier !== undefined && !specifier.startsWith(".")) {
          violations.push(`${path.slice(packageRoot.length + 1)} -> ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps generic implementation types out of the package barrel", async () => {
    const barrel = await readFile(join(sourceRoot, "index.ts"), "utf8");

    expect(barrel).not.toContain("EditorHistoryManagerImplementation");
    expect(barrel).not.toContain("HistoryControllerImplementation");
    expect(barrel).not.toContain("BoundedCommandStack");
    expect(barrel).not.toContain("HistoryEntry");
    expect(barrel).not.toContain("TransactionCommandGroup");
    expect(barrel).not.toContain("ActiveHistoryTransaction");
    expect(barrel).not.toContain("claimEditorHistoryManager");
  });

  it("keeps generic stack entries command-only and snapshot-free", async () => {
    const entrySource = await readFile(
      join(editorHistoryRoot, "model", "history-entry.ts"),
      "utf8",
    );

    expect(entrySource).toMatch(/readonly command:\s*EditorCommand/u);
    expect(entrySource).toMatch(/readonly metadata:\s*HistoryCommandMetadata/u);
    expect(entrySource).not.toMatch(/readonly\s+(?:after|before|document|snapshot)\s*:/u);
  });

  it("keeps transaction records command-only and snapshot-free", async () => {
    const transactionRoot = join(editorHistoryRoot, "transaction");
    const sources = await Promise.all(
      (await productionSourceFiles(transactionRoot)).map((path) => readFile(path, "utf8")),
    );
    const source = sources.join("\n");

    expect(source).toMatch(/readonly entries:\s*readonly HistoryEntry/u);
    expect(source).toMatch(/readonly #commands:\s*readonly EditorCommand/u);
    expect(source).not.toMatch(/readonly\s+(?:after|before|document|snapshot)\s*:/u);
    expect(source).not.toContain("@folio/");
  });
});
