import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  projectFileSystem,
  platformErrorCode,
  writeProjectAtomically,
} from "./project-atomic-write";
import {
  CURRENT_RECOVERY_VERSION,
  MAXIMUM_RECOVERY_BYTES,
  RECOVERY_FILE_EXTENSION,
  RECOVERY_FORMAT,
  isRecoveryId,
  isRecoveryRecord,
  isRecoverySnapshotRequest,
  recoveryFailure,
  type RecoveryClearResult,
  type RecoveryRecord,
  type RecoveryStoreResult,
} from "./recovery-contract";

export interface RecoveryFileServiceOptions {
  /** Application-owned directory, never beside the user's own project file. */
  readonly directory: string;
  /** Resolves an opaque backing target to its original path, for main-only metadata. */
  readonly resolveBackingPath?: (targetId: string) => string | null;
  readonly write?: typeof writeProjectAtomically;
  readonly ensureDirectory?: (directory: string) => Promise<void>;
}

/**
 * Owns every recovery file this window writes.
 *
 * Recovery state is the application's, not the user's: it lives under the
 * application data directory, is replaced atomically so a crash mid-write cannot
 * destroy the previous good snapshot, and never touches the `.folio` the user
 * chose.
 */
export class DesktopRecoveryFileService {
  private disposed = false;

  constructor(private readonly options: RecoveryFileServiceOptions) {}

  dispose(): void {
    this.disposed = true;
  }

  /** Absolute path for one record. The id shape is validated before it reaches here. */
  private pathFor(recoveryId: string): string {
    return path.join(this.options.directory, `${recoveryId}${RECOVERY_FILE_EXTENSION}`);
  }

  async store(input: unknown): Promise<RecoveryStoreResult> {
    if (this.disposed) return recoveryFailure("STORE_UNAVAILABLE", "The recovery store is closed.");
    if (!isRecoverySnapshotRequest(input))
      return recoveryFailure("INVALID_REQUEST", "Invalid recovery snapshot request.");
    if (Buffer.byteLength(input.content, "utf8") > MAXIMUM_RECOVERY_BYTES)
      return recoveryFailure("TOO_LARGE", "The project is too large to keep a recovery copy of.");
    const record: RecoveryRecord = {
      format: RECOVERY_FORMAT,
      formatVersion: CURRENT_RECOVERY_VERSION,
      recoveryId: input.recoveryId,
      sessionId: input.sessionId,
      capturedAt: input.capturedAt,
      documentId: input.documentId,
      title: input.title,
      hadBacking: input.backingTargetId !== null,
      // Resolved here so a future Open Original knows where the project came
      // from without the renderer ever holding a path.
      source:
        input.backingTargetId === null
          ? null
          : resolveSource(this.options.resolveBackingPath?.(input.backingTargetId)),
      project: input.content,
    };
    try {
      await (this.options.ensureDirectory ?? ensureDirectory)(this.options.directory);
      await (this.options.write ?? writeProjectAtomically)(
        this.pathFor(input.recoveryId),
        JSON.stringify(record),
        projectFileSystem,
        () => !this.disposed,
      );
      return { status: "stored" };
    } catch (error) {
      return recoveryFailure(
        mapRecoveryError(error),
        "The recovery snapshot could not be written.",
      );
    }
  }

  /** Drops one record. A record that is already gone is a success, not a failure. */
  async clear(input: unknown): Promise<RecoveryClearResult> {
    if (!isRecoveryId(input))
      return recoveryFailure("INVALID_REQUEST", "Invalid recovery identifier.");
    try {
      await unlink(this.pathFor(input));
      return { status: "cleared" };
    } catch (error) {
      if (platformErrorCode(error) === "ENOENT") return { status: "cleared" };
      return recoveryFailure(
        mapRecoveryError(error),
        "The recovery snapshot could not be removed.",
      );
    }
  }

  /**
   * Reads every valid record this application wrote.
   *
   * Internal to main: P7 will build the startup recovery flow on it. It is not
   * reachable from the renderer, which has no reason to enumerate recovery state.
   */
  async list(): Promise<readonly RecoveryRecord[]> {
    let entries: readonly string[];
    try {
      entries = await readdir(this.options.directory);
    } catch {
      return [];
    }
    const records: RecoveryRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(RECOVERY_FILE_EXTENSION)) continue;
      try {
        const raw = await readFile(path.join(this.options.directory, entry), "utf8");
        if (raw.length > MAXIMUM_RECOVERY_BYTES) continue;
        const parsed: unknown = JSON.parse(raw);
        if (isRecoveryRecord(parsed)) records.push(parsed);
      } catch {
        // A truncated or unreadable record is not a recovery candidate. The
        // crash that produced it must not also stop the others being found.
      }
    }
    return Object.freeze(records);
  }
}

function resolveSource(resolved: string | null | undefined): Readonly<{ path: string }> | null {
  return typeof resolved === "string" && resolved.length > 0
    ? Object.freeze({ path: resolved })
    : null;
}

async function ensureDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

function mapRecoveryError(error: unknown): "PERMISSION_DENIED" | "WRITE_FAILED" | "UNKNOWN" {
  const code = platformErrorCode(error) ?? (error instanceof Error ? error.message : undefined);
  if (code === "EACCES" || code === "EPERM" || code === "PERMISSION_DENIED")
    return "PERMISSION_DENIED";
  return code === undefined ? "UNKNOWN" : "WRITE_FAILED";
}
