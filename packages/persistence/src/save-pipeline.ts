import { DomainValidationError } from "@folio/domain";
import type { Notebook } from "@folio/domain";
import { CURRENT_NOTEBOOK_FORMAT_VERSION } from "./constants";
import { atomicWriteText } from "./atomic-write";
import { dirtyTargetKey } from "./dirty-tracker";
import type { DirtySnapshot, DirtyTracker } from "./dirty-tracker";
import { PersistenceError, isPersistenceError } from "./errors";
import type { FileSystemAdapter } from "./file-system";
import { nodeFileSystem } from "./file-system";
import { ensureNotebookFolder } from "./folder-structure";
import { createNotebookPaths, fromRelativeNotebookPath } from "./paths";
import { cleanupRecovery, detectRecovery, prepareRecoveryTransaction } from "./recovery";
import type { RecoveryContext, RecoveryWriteCandidate } from "./recovery";
import { serializeNotebook } from "./serializer";
import type { PersistenceCompatibility, SerializedNotebookFile } from "./types";

export interface SaveNotebookOptions {
  readonly fileSystem?: FileSystemAdapter;
  readonly compatibility?: PersistenceCompatibility;
  readonly dirtyTracker?: DirtyTracker;
  readonly force?: boolean;
  readonly recoveryContext?: RecoveryContext;
}

export interface SaveNotebookResult {
  readonly notebookPath: string;
  readonly formatVersion: number;
  readonly writtenFiles: readonly string[];
  readonly skippedFiles: readonly string[];
}

interface InspectedFile {
  readonly document: SerializedNotebookFile;
  readonly targetPath: string;
  readonly originalContent: string | null;
  readonly selected: boolean;
}

export async function saveNotebook(
  notebookPath: string,
  notebook: Notebook,
  options: SaveNotebookOptions = {},
): Promise<SaveNotebookResult> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const paths = createNotebookPaths(notebookPath);
  const tracker = options.dirtyTracker;
  let dirtySnapshot: DirtySnapshot | undefined;
  try {
    const isInitialSave = !(await fileSystem.exists(paths.metadata));
    await ensureNotebookFolder(paths.root, fileSystem);
    const recovery = await detectRecovery(paths.root, fileSystem);
    if (recovery.required) {
      throw new PersistenceError(
        "INVALID_RECOVERY",
        "Notebook has pending recovery data; recover it before saving.",
        { path: paths.root },
      );
    }

    dirtySnapshot = tracker?.beginSave();
    const serialized = serializeNotebook(notebook, options.compatibility);
    const fullSave = options.force === true || isInitialSave || !tracker;
    const dirtyKeys = new Set(
      dirtySnapshot?.entries.map(({ target }) => dirtyTargetKey(target)) ?? [],
    );
    const hasDirtyEntries = dirtyKeys.size > 0;
    const inspected = await Promise.all(
      serialized.files.map(async (document): Promise<InspectedFile> => {
        const targetPath = fromRelativeNotebookPath(paths.root, document.relativePath);
        const exists = await fileSystem.exists(targetPath);
        const originalContent = exists ? await fileSystem.readTextFile(targetPath) : null;
        const selected =
          fullSave ||
          !exists ||
          matchesDirtyTarget(document, dirtyKeys) ||
          (document.kind === "metadata" && hasDirtyEntries);
        return { document, targetPath, originalContent, selected };
      }),
    );

    const selected = inspected.filter(({ selected }) => selected);
    const changed = selected.filter(
      ({ document, originalContent }) => originalContent !== document.content,
    );
    const skippedFiles = selected
      .filter(({ document, originalContent }) => originalContent === document.content)
      .map(({ document }) => document.relativePath)
      .sort();

    if (changed.length === 0) {
      if (dirtySnapshot) tracker?.completeSave(dirtySnapshot);
      return freezeResult(paths.root, [], skippedFiles);
    }

    const candidates: RecoveryWriteCandidate[] = changed.map(({ document, originalContent }) => ({
      relativePath: document.relativePath,
      nextContent: document.content,
      originalContent,
    }));
    const transaction = await prepareRecoveryTransaction(
      paths.root,
      notebook.id,
      candidates,
      fileSystem,
      options.recoveryContext,
    );

    for (const file of commitOrder(changed)) {
      await atomicWriteText(file.targetPath, file.document.content, fileSystem);
    }

    await cleanupRecovery(paths.root, transaction, fileSystem);
    if (dirtySnapshot) tracker?.completeSave(dirtySnapshot);
    return freezeResult(
      paths.root,
      changed.map(({ document }) => document.relativePath).sort(),
      skippedFiles,
    );
  } catch (error) {
    tracker?.failSave();
    if (isPersistenceError(error)) throw error;
    if (error instanceof DomainValidationError) {
      throw new PersistenceError("INVALID_DATA", "Notebook data failed domain validation.", {
        path: paths.root,
        cause: error,
        details: { issues: error.issues },
      });
    }
    throw new PersistenceError("IO_ERROR", "Notebook save failed.", {
      path: paths.root,
      cause: error,
    });
  }
}

function matchesDirtyTarget(file: SerializedNotebookFile, dirtyKeys: Set<string>): boolean {
  if (file.kind === "metadata") return dirtyKeys.has("metadata");
  if (!file.id) return false;
  return dirtyKeys.has(`${file.kind}:${file.id}`);
}

function commitOrder(files: readonly InspectedFile[]): readonly InspectedFile[] {
  const rank = { page: 0, section: 1, metadata: 2 } as const;
  return [...files].sort((left, right) => {
    const kindOrder = rank[left.document.kind] - rank[right.document.kind];
    return kindOrder || left.document.relativePath.localeCompare(right.document.relativePath, "en");
  });
}

function freezeResult(
  notebookPath: string,
  writtenFiles: readonly string[],
  skippedFiles: readonly string[],
): SaveNotebookResult {
  return Object.freeze({
    notebookPath,
    formatVersion: CURRENT_NOTEBOOK_FORMAT_VERSION,
    writtenFiles: Object.freeze([...writtenFiles]),
    skippedFiles: Object.freeze([...skippedFiles]),
  });
}
