import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { atomicWriteText } from "../atomic-write";
import { PersistenceError } from "../errors";
import type { FileSystemAdapter } from "../file-system";
import {
  createNotebookPaths,
  documentFileName,
  fromRelativeNotebookPath,
  normalizeNotebookPath,
} from "../paths";

function memoryFileSystem(events: string[], failRename = false): FileSystemAdapter {
  return {
    async createDirectory(path) {
      events.push(`mkdir:${path}`);
    },
    async exists() {
      return false;
    },
    async readDirectory() {
      return [];
    },
    async readTextFile() {
      throw new Error("not implemented");
    },
    async removeFile(path) {
      events.push(`remove:${path}`);
    },
    async rename(source, target) {
      events.push(`rename:${source}->${target}`);
      if (failRename) throw new Error("rename failed");
    },
    async syncFile(path) {
      events.push(`sync:${path}`);
    },
    async writeTextFile(path, content) {
      events.push(`write:${path}:${content}`);
    },
  };
}

describe("notebook paths", () => {
  it("normalizes paths and derives the complete architecture-defined layout", () => {
    const root = normalizeNotebookPath("C:\\notes\\..\\notebooks\\Atlas");
    const paths = createNotebookPaths(root);

    expect(paths.root).toBe(normalizeNotebookPath("C:\\notebooks\\Atlas"));
    expect(paths.metadata).toBe(normalizeNotebookPath("C:\\notebooks\\Atlas\\metadata.json"));
    expect(paths.sections).toBe(normalizeNotebookPath("C:\\notebooks\\Atlas\\sections"));
    expect(paths.pages).toBe(normalizeNotebookPath("C:\\notebooks\\Atlas\\pages"));
    expect(paths.assets).toBe(normalizeNotebookPath("C:\\notebooks\\Atlas\\assets"));
    expect(paths.thumbnails).toBe(normalizeNotebookPath("C:\\notebooks\\Atlas\\thumbnails"));
    expect(paths.folio).toBe(normalizeNotebookPath("C:\\notebooks\\Atlas\\.folio"));
  });

  it("creates safe file names for domain identifiers", () => {
    expect(documentFileName("chapter/1.with spaces")).toBe("item-chapter%2F1%2Ewith%20spaces.json");
  });

  it("accepts normalized relative notebook paths and rejects traversal", () => {
    const root = normalizeNotebookPath("C:\\notebooks\\Atlas");
    expect(fromRelativeNotebookPath(root, "pages/page-1.json")).toBe(
      normalizeNotebookPath("C:\\notebooks\\Atlas\\pages\\page-1.json"),
    );
    expect(() => fromRelativeNotebookPath(root, "../outside.json")).toThrow(PersistenceError);
    expect(() => fromRelativeNotebookPath(root, "/absolute.json")).toThrow(PersistenceError);
  });
});

describe("atomicWriteText", () => {
  it("writes a sibling temporary file, flushes it, then renames it", async () => {
    const events: string[] = [];
    const fs = memoryFileSystem(events);
    await atomicWriteText("C:\\notebook\\metadata.json", "{}\n", fs);

    expect(events).toEqual([
      `mkdir:${dirname("C:\\notebook\\metadata.json")}`,
      "write:C:\\notebook\\metadata.json.tmp:{}\n",
      "sync:C:\\notebook\\metadata.json.tmp",
      "rename:C:\\notebook\\metadata.json.tmp->C:\\notebook\\metadata.json",
    ]);
  });

  it("never writes the target directly and reports rename failures structurally", async () => {
    const events: string[] = [];
    const fs = memoryFileSystem(events, true);

    await expect(atomicWriteText("target.json", "next", fs)).rejects.toMatchObject({
      code: "ATOMIC_WRITE_FAILED",
      path: "target.json",
    });
    expect(events.some((event) => event.startsWith("write:target.json:"))).toBe(false);
    expect(events).toContain("write:target.json.tmp:next");
  });
});
