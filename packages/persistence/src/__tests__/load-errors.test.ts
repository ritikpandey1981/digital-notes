import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureNotebookFolder } from "../folder-structure";
import { nodeFileSystem } from "../file-system";
import { loadNotebook } from "../load-pipeline";
import { createNotebookPaths, pageRelativePath, sectionRelativePath } from "../paths";
import { saveNotebook } from "../save-pipeline";
import { validateNotebookFormatVersion, validateRecoveryFormatVersion } from "../versioning";
import { buildNotebook, createTemporaryDirectory, removeTemporaryDirectory } from "./helpers";

describe("notebook loading failures", () => {
  it("reports a missing metadata file as a structured error", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Missing Metadata");
    try {
      await ensureNotebookFolder(notebookPath);
      await expect(loadNotebook(notebookPath)).rejects.toMatchObject({
        code: "MISSING_FILE",
        path: createNotebookPaths(notebookPath).metadata,
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it.each([
    ["section", sectionRelativePath("section-1")],
    ["page", pageRelativePath("page-1-1")],
  ])("reports a missing referenced %s document", async (_kind, relativePath) => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Missing Document");
    try {
      await saveNotebook(notebookPath, buildNotebook());
      const target = join(notebookPath, ...relativePath.split("/"));
      await rm(target);
      await expect(loadNotebook(notebookPath)).rejects.toMatchObject({
        code: "MISSING_FILE",
        path: target,
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("reports missing architecture-required folders", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Missing Folder");
    try {
      await saveNotebook(notebookPath, buildNotebook());
      await rm(join(notebookPath, "thumbnails"), { recursive: true });
      await expect(loadNotebook(notebookPath)).rejects.toMatchObject({
        code: "MISSING_FILE",
        path: join(notebookPath, "thumbnails"),
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("distinguishes corrupted JSON from filesystem errors", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Corrupt JSON");
    const target = join(notebookPath, ...pageRelativePath("page-1-1").split("/"));
    try {
      await saveNotebook(notebookPath, buildNotebook());
      await writeFile(target, "{ definitely not json", "utf8");
      await expect(loadNotebook(notebookPath)).rejects.toMatchObject({
        code: "CORRUPT_JSON",
        path: target,
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("rejects unsupported notebook versions in every document type", async () => {
    for (const relativePath of [
      "metadata.json",
      sectionRelativePath("section-1"),
      pageRelativePath("page-1-1"),
    ]) {
      const temporaryRoot = await createTemporaryDirectory();
      const notebookPath = join(temporaryRoot, "Future Version");
      const target = join(notebookPath, ...relativePath.split("/"));
      try {
        await saveNotebook(notebookPath, buildNotebook());
        const content = await readFile(target, "utf8");
        await writeFile(
          target,
          content.replace('"formatVersion": 1', '"formatVersion": 999'),
          "utf8",
        );
        await expect(loadNotebook(notebookPath)).rejects.toMatchObject({
          code: "UNSUPPORTED_VERSION",
        });
      } finally {
        await removeTemporaryDirectory(temporaryRoot);
      }
    }
  });

  it("delegates model invariants to @folio/domain and wraps them structurally", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Invalid Domain Data");
    const metadataPath = join(notebookPath, "metadata.json");
    try {
      await saveNotebook(notebookPath, buildNotebook());
      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      metadata.name = "";
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

      await expect(loadNotebook(notebookPath)).rejects.toMatchObject({
        code: "INVALID_DATA",
        details: { issues: expect.any(Array) },
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("normalizes raw filesystem failures into structured I/O errors", async () => {
    await expect(
      loadNotebook("C:\\notebooks\\Unavailable", {
        fileSystem: {
          ...nodeFileSystem,
          exists: async () => {
            throw new Error("permission denied");
          },
        },
      }),
    ).rejects.toMatchObject({
      code: "IO_ERROR",
      path: expect.stringContaining("Unavailable"),
    });
  });
});

describe("format version validators", () => {
  it("accepts the current versions and rejects missing or future versions", () => {
    expect(validateNotebookFormatVersion(1)).toBe(1);
    expect(validateRecoveryFormatVersion(1)).toBe(1);
    expect(() => validateNotebookFormatVersion(undefined)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_VERSION" }),
    );
    expect(() => validateNotebookFormatVersion(2)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_VERSION" }),
    );
    expect(() => validateRecoveryFormatVersion(2)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_VERSION" }),
    );
  });
});
