import { createHash, randomUUID } from "node:crypto";
import type { JsonValue } from "@folio/domain";
import {
  CURRENT_NOTEBOOK_FORMAT_VERSION,
  CURRENT_RECOVERY_FORMAT_VERSION,
  RECOVERY_BACKUP_DIRECTORY,
  RECOVERY_FILE,
} from "./constants";
import { atomicWriteText } from "./atomic-write";
import { PersistenceError, toPersistenceError } from "./errors";
import type { FileSystemAdapter } from "./file-system";
import { nodeFileSystem } from "./file-system";
import { parseJsonObject, stableStringify } from "./json";
import { loadNotebook } from "./load-pipeline";
import { createNotebookPaths, fromRelativeNotebookPath, normalizeNotebookPath } from "./paths";
import type { LoadedNotebook } from "./types";
import { validateRecoveryFormatVersion } from "./versioning";

export type RecoveryTransactionStatus = "preparing" | "ready";

export interface RecoveryFileRecord {
  readonly targetRelativePath: string;
  readonly stagedRelativePath: string;
  readonly stagedSha256: string;
  readonly existed: boolean;
  readonly backupRelativePath: string | null;
  readonly backupSha256: string | null;
}

export interface RecoveryMetadata {
  readonly recoveryFormatVersion: number;
  readonly notebookFormatVersion: number;
  readonly transactionId: string;
  readonly notebookId: string;
  readonly startedAt: string;
  readonly status: RecoveryTransactionStatus;
  readonly files: readonly RecoveryFileRecord[];
}

export interface RecoveryWriteCandidate {
  readonly relativePath: string;
  readonly nextContent: string;
  readonly originalContent: string | null;
}

export interface RecoveryContext {
  readonly createId: () => string;
  readonly now: () => string;
}

export interface RecoveryDetection {
  readonly required: boolean;
  readonly metadata: RecoveryMetadata | null;
  readonly artifacts: readonly string[];
}

export type RecoveryOutcome = "cleaned" | "none" | "recovered" | "rolled-back";

export interface RecoveryResult extends LoadedNotebook {
  readonly outcome: RecoveryOutcome;
}

const defaultRecoveryContext: RecoveryContext = {
  createId: randomUUID,
  now: () => new Date().toISOString(),
};

export async function prepareRecoveryTransaction(
  notebookPath: string,
  notebookId: string,
  candidates: readonly RecoveryWriteCandidate[],
  fileSystem: FileSystemAdapter = nodeFileSystem,
  context: RecoveryContext = defaultRecoveryContext,
): Promise<RecoveryMetadata> {
  const root = normalizeNotebookPath(notebookPath);
  const transactionId = safeTransactionId(context.createId());
  const files = candidates.map((candidate, index): RecoveryFileRecord => {
    fromRelativeNotebookPath(root, candidate.relativePath);
    const stem = `${transactionId}-${String(index).padStart(5, "0")}`;
    return Object.freeze({
      targetRelativePath: candidate.relativePath,
      stagedRelativePath: `${RECOVERY_BACKUP_DIRECTORY}/${stem}.next.json`,
      stagedSha256: sha256(candidate.nextContent),
      existed: candidate.originalContent !== null,
      backupRelativePath:
        candidate.originalContent === null
          ? null
          : `${RECOVERY_BACKUP_DIRECTORY}/${stem}.previous.json`,
      backupSha256: candidate.originalContent === null ? null : sha256(candidate.originalContent),
    });
  });
  const preparing = createRecoveryMetadata(
    notebookId,
    transactionId,
    context.now(),
    "preparing",
    files,
  );
  const recoveryFile = fromRelativeNotebookPath(root, RECOVERY_FILE);
  await atomicWriteText(
    recoveryFile,
    stableStringify(preparing as unknown as JsonValue),
    fileSystem,
  );

  await Promise.all(
    files.flatMap((file, index) => {
      const candidate = candidates[index];
      if (!candidate) return [];
      const writes = [
        atomicWriteText(
          fromRelativeNotebookPath(root, file.stagedRelativePath),
          candidate.nextContent,
          fileSystem,
        ),
      ];
      if (file.backupRelativePath && candidate.originalContent !== null) {
        writes.push(
          atomicWriteText(
            fromRelativeNotebookPath(root, file.backupRelativePath),
            candidate.originalContent,
            fileSystem,
          ),
        );
      }
      return writes;
    }),
  );

  const ready = createRecoveryMetadata(
    notebookId,
    transactionId,
    preparing.startedAt,
    "ready",
    files,
  );
  await atomicWriteText(recoveryFile, stableStringify(ready as unknown as JsonValue), fileSystem);
  return ready;
}

export async function detectRecovery(
  notebookPath: string,
  fileSystem: FileSystemAdapter = nodeFileSystem,
): Promise<RecoveryDetection> {
  const paths = createNotebookPaths(notebookPath);
  if (!(await fileSystem.exists(paths.root))) {
    return Object.freeze({ required: false, metadata: null, artifacts: Object.freeze([]) });
  }
  const metadata = (await fileSystem.exists(paths.recoveryFile))
    ? await readRecoveryMetadata(paths.recoveryFile, fileSystem)
    : null;
  const artifacts = await findRecoveryArtifacts(paths.root, fileSystem);
  return Object.freeze({
    required: metadata !== null || artifacts.length > 0,
    metadata,
    artifacts: Object.freeze(artifacts),
  });
}

export async function recoverNotebook(
  notebookPath: string,
  fileSystem: FileSystemAdapter = nodeFileSystem,
): Promise<RecoveryResult> {
  const root = normalizeNotebookPath(notebookPath);
  const detection = await detectRecovery(root, fileSystem);
  if (!detection.required) {
    return withOutcome(await loadNotebook(root, { fileSystem }), "none");
  }

  if (!detection.metadata || detection.metadata.status === "preparing") {
    const loaded = await loadNotebook(root, { fileSystem });
    await cleanupRecovery(root, detection.metadata, fileSystem);
    return withOutcome(loaded, "cleaned");
  }

  const metadata = detection.metadata;
  const prepared = await validatePreparedFiles(root, metadata, fileSystem);
  try {
    for (const file of prepared) {
      await atomicWriteText(
        fromRelativeNotebookPath(root, file.record.targetRelativePath),
        file.stagedContent,
        fileSystem,
      );
    }
    const loaded = await loadNotebook(root, { fileSystem });
    await cleanupRecovery(root, metadata, fileSystem);
    return withOutcome(loaded, "recovered");
  } catch (recoveryError) {
    try {
      for (const file of prepared) {
        const targetPath = fromRelativeNotebookPath(root, file.record.targetRelativePath);
        if (file.record.existed && file.backupContent !== null) {
          await atomicWriteText(targetPath, file.backupContent, fileSystem);
        } else {
          await fileSystem.removeFile(targetPath);
        }
      }
      const loaded = await loadNotebook(root, { fileSystem });
      await cleanupRecovery(root, metadata, fileSystem);
      return withOutcome(loaded, "rolled-back");
    } catch (rollbackError) {
      throw new PersistenceError("RECOVERY_FAILED", "Recovery and rollback both failed.", {
        path: root,
        cause: rollbackError,
        details: { recoveryError: String(recoveryError) },
      });
    }
  }
}

export async function cleanupRecovery(
  notebookPath: string,
  metadata: RecoveryMetadata | null = null,
  fileSystem: FileSystemAdapter = nodeFileSystem,
): Promise<void> {
  const paths = createNotebookPaths(notebookPath);
  let activeMetadata = metadata;
  if (!activeMetadata && (await fileSystem.exists(paths.recoveryFile))) {
    try {
      activeMetadata = await readRecoveryMetadata(paths.recoveryFile, fileSystem);
    } catch {
      activeMetadata = null;
    }
  }

  const knownArtifacts = new Set<string>([paths.recoveryFile, `${paths.recoveryFile}.tmp`]);
  activeMetadata?.files.forEach((file) => {
    knownArtifacts.add(fromRelativeNotebookPath(paths.root, file.stagedRelativePath));
    knownArtifacts.add(`${fromRelativeNotebookPath(paths.root, file.stagedRelativePath)}.tmp`);
    if (file.backupRelativePath) {
      knownArtifacts.add(fromRelativeNotebookPath(paths.root, file.backupRelativePath));
      knownArtifacts.add(`${fromRelativeNotebookPath(paths.root, file.backupRelativePath)}.tmp`);
    }
  });
  (await findRecoveryArtifacts(paths.root, fileSystem)).forEach((artifact) =>
    knownArtifacts.add(artifact),
  );
  await Promise.all([...knownArtifacts].map((artifact) => fileSystem.removeFile(artifact)));
}

export async function readRecoveryMetadata(
  filePath: string,
  fileSystem: FileSystemAdapter = nodeFileSystem,
): Promise<RecoveryMetadata> {
  try {
    const document = parseJsonObject(await fileSystem.readTextFile(filePath), filePath);
    validateRecoveryFormatVersion(document.recoveryFormatVersion, filePath);
    if (
      document.notebookFormatVersion !== CURRENT_NOTEBOOK_FORMAT_VERSION ||
      typeof document.transactionId !== "string" ||
      typeof document.notebookId !== "string" ||
      typeof document.startedAt !== "string" ||
      (document.status !== "preparing" && document.status !== "ready") ||
      !Array.isArray(document.files)
    ) {
      throw new PersistenceError("INVALID_RECOVERY", "Recovery metadata is malformed.", {
        path: filePath,
      });
    }
    const files = document.files.map((file, index) => validateRecoveryFile(file, filePath, index));
    return Object.freeze({
      recoveryFormatVersion: document.recoveryFormatVersion as number,
      notebookFormatVersion: document.notebookFormatVersion,
      transactionId: document.transactionId,
      notebookId: document.notebookId,
      startedAt: document.startedAt,
      status: document.status,
      files: Object.freeze(files),
    });
  } catch (error) {
    throw toPersistenceError(
      error,
      "INVALID_RECOVERY",
      "Unable to read recovery metadata.",
      filePath,
    );
  }
}

interface PreparedRecoveryFile {
  readonly record: RecoveryFileRecord;
  readonly stagedContent: string;
  readonly backupContent: string | null;
}

async function validatePreparedFiles(
  root: string,
  metadata: RecoveryMetadata,
  fileSystem: FileSystemAdapter,
): Promise<readonly PreparedRecoveryFile[]> {
  return Promise.all(
    metadata.files.map(async (record) => {
      const stagedContent = await readAndValidateRecoveryContent(
        root,
        record.stagedRelativePath,
        record.stagedSha256,
        fileSystem,
      );
      const backupContent = record.backupRelativePath
        ? await readAndValidateRecoveryContent(
            root,
            record.backupRelativePath,
            record.backupSha256 as string,
            fileSystem,
          )
        : null;
      return Object.freeze({ record, stagedContent, backupContent });
    }),
  );
}

async function readAndValidateRecoveryContent(
  root: string,
  relativePath: string,
  expectedHash: string,
  fileSystem: FileSystemAdapter,
): Promise<string> {
  const absolutePath = fromRelativeNotebookPath(root, relativePath);
  if (!(await fileSystem.exists(absolutePath))) {
    throw new PersistenceError("INVALID_RECOVERY", "Recovery artifact is missing.", {
      path: absolutePath,
    });
  }
  const content = await fileSystem.readTextFile(absolutePath);
  if (sha256(content) !== expectedHash) {
    throw new PersistenceError("INVALID_RECOVERY", "Recovery artifact checksum does not match.", {
      path: absolutePath,
    });
  }
  parseJsonObject(content, absolutePath);
  return content;
}

function createRecoveryMetadata(
  notebookId: string,
  transactionId: string,
  startedAt: string,
  status: RecoveryTransactionStatus,
  files: readonly RecoveryFileRecord[],
): RecoveryMetadata {
  return Object.freeze({
    recoveryFormatVersion: CURRENT_RECOVERY_FORMAT_VERSION,
    notebookFormatVersion: CURRENT_NOTEBOOK_FORMAT_VERSION,
    transactionId,
    notebookId,
    startedAt,
    status,
    files: Object.freeze([...files]),
  });
}

function validateRecoveryFile(value: unknown, filePath: string, index: number): RecoveryFileRecord {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !("targetRelativePath" in value) ||
    !("stagedRelativePath" in value) ||
    !("stagedSha256" in value) ||
    !("existed" in value) ||
    !("backupRelativePath" in value) ||
    !("backupSha256" in value) ||
    typeof value.targetRelativePath !== "string" ||
    typeof value.stagedRelativePath !== "string" ||
    typeof value.stagedSha256 !== "string" ||
    typeof value.existed !== "boolean" ||
    (value.backupRelativePath !== null && typeof value.backupRelativePath !== "string") ||
    (value.backupSha256 !== null && typeof value.backupSha256 !== "string")
  ) {
    throw new PersistenceError("INVALID_RECOVERY", "Recovery file record is malformed.", {
      path: filePath,
      details: { index },
    });
  }
  if (
    value.existed !== (value.backupRelativePath !== null) ||
    value.existed !== (value.backupSha256 !== null)
  ) {
    throw new PersistenceError("INVALID_RECOVERY", "Recovery backup metadata is inconsistent.", {
      path: filePath,
      details: { index },
    });
  }
  return Object.freeze({
    targetRelativePath: value.targetRelativePath,
    stagedRelativePath: value.stagedRelativePath,
    stagedSha256: value.stagedSha256,
    existed: value.existed,
    backupRelativePath: value.backupRelativePath,
    backupSha256: value.backupSha256,
  });
}

async function findRecoveryArtifacts(
  root: string,
  fileSystem: FileSystemAdapter,
): Promise<string[]> {
  const paths = createNotebookPaths(root);
  const directories = [...new Set([paths.root, paths.sections, paths.pages, paths.folio])];
  const artifacts: string[] = [];
  for (const directory of directories) {
    if (!(await fileSystem.exists(directory))) continue;
    const entries = await fileSystem.readDirectory(directory);
    entries.forEach((entry) => {
      if (
        entry.isFile &&
        (entry.name.endsWith(".tmp") ||
          (directory === paths.recoveryBackups &&
            (entry.name.endsWith(".next.json") || entry.name.endsWith(".previous.json"))))
      ) {
        artifacts.push(
          fromRelativeNotebookPath(
            paths.root,
            relativeFromKnownDirectory(paths, directory, entry.name),
          ),
        );
      }
    });
  }
  return artifacts.sort();
}

function relativeFromKnownDirectory(
  paths: ReturnType<typeof createNotebookPaths>,
  directory: string,
  fileName: string,
): string {
  if (directory === paths.root) return fileName;
  if (directory === paths.sections) return `sections/${fileName}`;
  if (directory === paths.pages) return `pages/${fileName}`;
  if (directory === paths.folio) return `.folio/${fileName}`;
  return `${RECOVERY_BACKUP_DIRECTORY}/${fileName}`;
}

function withOutcome(loaded: LoadedNotebook, outcome: RecoveryOutcome): RecoveryResult {
  return Object.freeze({ ...loaded, outcome });
}

function safeTransactionId(value: string): string {
  const safe = value.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  if (!safe) throw new PersistenceError("INVALID_RECOVERY", "Recovery transaction id is invalid.");
  return safe;
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
