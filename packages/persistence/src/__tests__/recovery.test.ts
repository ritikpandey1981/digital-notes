import { join } from "node:path";
import { createNotebook, createPage } from "@folio/domain";
import { describe, expect, it } from "vitest";
import { DirtyTracker } from "../dirty-tracker";
import type { FileSystemAdapter } from "../file-system";
import { nodeFileSystem } from "../file-system";
import { loadNotebook } from "../load-pipeline";
import { createNotebookPaths, fromRelativeNotebookPath } from "../paths";
import { detectRecovery, readRecoveryMetadata, recoverNotebook } from "../recovery";
import type { RecoveryDetection } from "../recovery";
import { saveNotebook } from "../save-pipeline";
import {
  buildNotebook,
  createTemporaryDirectory,
  removeTemporaryDirectory,
  updateFirstPage,
} from "./helpers";

function interruptedFileSystem(failureTarget: string): FileSystemAdapter {
  let shouldFail = true;
  return {
    ...nodeFileSystem,
    async rename(sourcePath, targetPath) {
      if (shouldFail && targetPath === failureTarget) {
        shouldFail = false;
        throw new Error("simulated process interruption");
      }
      await nodeFileSystem.rename(sourcePath, targetPath);
    },
  };
}

async function createInterruptedSave(notebookPath: string): Promise<{
  readonly changed: ReturnType<typeof buildNotebook>;
  readonly detection: RecoveryDetection;
}> {
  const original = buildNotebook();
  await saveNotebook(notebookPath, original);
  const page = original.sections[0]?.pages[0];
  if (!page) throw new Error("Expected a page fixture.");
  const changedPage = createPage({
    ...page,
    width: page.width + 100,
    updatedAt: "2026-01-05T03:04:05.000Z",
  });
  const changed = createNotebook({
    ...updateFirstPage(original, changedPage),
    name: "Recovered Notebook",
    updatedAt: "2026-01-05T03:04:05.000Z",
  });
  const tracker = new DirtyTracker();
  tracker.markPage(changedPage.id);
  const paths = createNotebookPaths(notebookPath);

  await expect(
    saveNotebook(notebookPath, changed, {
      dirtyTracker: tracker,
      fileSystem: interruptedFileSystem(paths.metadata),
      recoveryContext: {
        createId: () => "transaction-1",
        now: () => "2026-01-05T03:04:06.000Z",
      },
    }),
  ).rejects.toMatchObject({ code: "ATOMIC_WRITE_FAILED", path: paths.metadata });
  expect(tracker.status).toBe("dirty");
  return { changed, detection: await detectRecovery(notebookPath) };
}

describe("crash recovery", () => {
  it("detects and replays a ready transaction after an interrupted save", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Interrupted Save");
    try {
      const { changed, detection } = await createInterruptedSave(notebookPath);
      expect(detection.required).toBe(true);
      expect(detection.metadata).toMatchObject({
        status: "ready",
        transactionId: "transaction-1",
        notebookId: changed.id,
      });
      const metadata = await readRecoveryMetadata(createNotebookPaths(notebookPath).recoveryFile);
      expect(metadata.files).toHaveLength(2);

      const result = await recoverNotebook(notebookPath);
      expect(result.outcome).toBe("recovered");
      expect(result.notebook).toEqual(changed);
      expect(await detectRecovery(notebookPath)).toEqual({
        required: false,
        metadata: null,
        artifacts: [],
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("rolls back to the previous consistent notebook if replay is interrupted", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Recovery Rollback");
    const original = buildNotebook();
    try {
      const { detection } = await createInterruptedSave(notebookPath);
      const pageRecord = detection.metadata?.files.find(({ targetRelativePath }) =>
        targetRelativePath.startsWith("pages/"),
      );
      if (!pageRecord) throw new Error("Expected a page recovery record.");
      const pageTarget = fromRelativeNotebookPath(notebookPath, pageRecord.targetRelativePath);

      const result = await recoverNotebook(notebookPath, interruptedFileSystem(pageTarget));
      expect(result.outcome).toBe("rolled-back");
      expect(result.notebook).toEqual(original);
      expect((await loadNotebook(notebookPath)).notebook).toEqual(original);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("detects orphan temporary files and cleans them after loading the canonical data", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Orphan Temporary File");
    const notebook = buildNotebook();
    try {
      await saveNotebook(notebookPath, notebook);
      const orphan = `${createNotebookPaths(notebookPath).metadata}.tmp`;
      await nodeFileSystem.writeTextFile(orphan, "orphaned bytes");
      expect(await detectRecovery(notebookPath)).toMatchObject({ required: true, metadata: null });

      const result = await recoverNotebook(notebookPath);
      expect(result.outcome).toBe("cleaned");
      expect(result.notebook).toEqual(notebook);
      expect(await nodeFileSystem.exists(orphan)).toBe(false);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("rejects recovery artifacts whose checksum no longer matches metadata", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Tampered Recovery");
    try {
      const { detection } = await createInterruptedSave(notebookPath);
      const staged = detection.metadata?.files[0]?.stagedRelativePath;
      if (!staged) throw new Error("Expected a staged recovery artifact.");
      await nodeFileSystem.writeTextFile(
        fromRelativeNotebookPath(notebookPath, staged),
        '{"tampered":true}\n',
      );

      await expect(recoverNotebook(notebookPath)).rejects.toMatchObject({
        code: "INVALID_RECOVERY",
      });
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });

  it("loads normally when no recovery is needed", async () => {
    const temporaryRoot = await createTemporaryDirectory();
    const notebookPath = join(temporaryRoot, "Clean Notebook");
    try {
      const notebook = buildNotebook();
      await saveNotebook(notebookPath, notebook);
      const result = await recoverNotebook(notebookPath);
      expect(result.outcome).toBe("none");
      expect(result.notebook).toEqual(notebook);
    } finally {
      await removeTemporaryDirectory(temporaryRoot);
    }
  });
});
