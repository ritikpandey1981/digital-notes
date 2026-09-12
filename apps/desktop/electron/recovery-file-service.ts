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
  MAXIMUM_RECOVERY_CANDIDATES,
  MAXIMUM_RECOVERY_SCAN_ENTRIES,
  RECOVERY_FILE_EXTENSION,
  RECOVERY_FORMAT,
  RECOVERY_TEMPORARY_PATTERN,
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
  /** How many candidates one scan may offer. Extra records stay on disk, untouched. */
  readonly maximumCandidates?: number;
  readonly maximumScanEntries?: number;
}

/**
 * Owns every recovery file this window writes, and every one it later finds.
 *
 * Recovery state is the application's, not the user's: it lives under the
 * application data directory, is replaced atomically so a crash mid-write cannot
 * destroy the previous good snapshot, and never touches the `.folio` the user
 * chose. Reads are equally narrow -- one known directory, one known extension,
 * ids this service itself issued.
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
      // Resolved here so Open Original knows where the project came from without
      // the renderer ever holding a path.
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
   * Reads one record by the id that names it.
   *
   * Main-only: the record carries the original file location, so only the
   * startup flow inside main ever holds a whole one.
   */
  async read(input: unknown): Promise<RecoveryRecord | null> {
    if (!isRecoveryId(input)) return null;
    return this.readRecord(`${input}${RECOVERY_FILE_EXTENSION}`);
  }

  /**
   * Every valid record this application wrote, newest capture first.
   *
   * A record is never dropped for being old: potential artwork outlives any
   * housekeeping rule. Beyond the offered count the extras simply stay on disk
   * for a later startup to find.
   */
  async list(): Promise<readonly RecoveryRecord[]> {
    const entries = await this.entries();
    const records: RecoveryRecord[] = [];
    let scanned = 0;
    const scanLimit = this.options.maximumScanEntries ?? MAXIMUM_RECOVERY_SCAN_ENTRIES;
    for (const entry of entries) {
      if (!entry.endsWith(RECOVERY_FILE_EXTENSION)) continue;
      // A directory somebody filled with junk must not turn startup into a scan
      // of everything in it; the records past this bound are left alone.
      if (scanned >= scanLimit) break;
      scanned += 1;
      const record = await this.readRecord(entry);
      if (record !== null) records.push(record);
    }
    // Chronology comes from the capture itself, not from a filesystem timestamp
    // that a copy, a backup tool, or a restore would have rewritten.
    records.sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
    return Object.freeze(
      records.slice(0, this.options.maximumCandidates ?? MAXIMUM_RECOVERY_CANDIDATES),
    );
  }

  /**
   * Removes the temporary files an interrupted atomic write can leave behind.
   *
   * Only this service's own naming convention, only inside its own directory,
   * and never a committed record: a hard termination mid-write is the one thing
   * that produces these, and nothing else in recovery ever reads them.
   */
  async sweepTemporaryFiles(): Promise<number> {
    const entries = await this.entries();
    let removed = 0;
    for (const entry of entries) {
      if (!RECOVERY_TEMPORARY_PATTERN.test(entry)) continue;
      try {
        await unlink(path.join(this.options.directory, entry));
        removed += 1;
      } catch {
        // A temporary file that will not go is harmless; it is never offered.
      }
    }
    return removed;
  }

  private async entries(): Promise<readonly string[]> {
    try {
      return await readdir(this.options.directory);
    } catch {
      // No directory yet means no recovery state, which is the ordinary case.
      return [];
    }
  }

  private async readRecord(entry: string): Promise<RecoveryRecord | null> {
    try {
      const raw = await readFile(path.join(this.options.directory, entry), "utf8");
      if (raw.length > MAXIMUM_RECOVERY_BYTES) return null;
      const parsed: unknown = JSON.parse(raw);
      return isRecoveryRecord(parsed) ? parsed : null;
    } catch {
      // A truncated or unreadable record is not a recovery candidate. The crash
      // that produced it must not also stop the others being found, and it is
      // left exactly where it is rather than deleted on a guess.
      return null;
    }
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
