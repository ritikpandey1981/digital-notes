import { mkdir, lstat, open, readdir, unlink } from "node:fs/promises";
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
  MAXIMUM_RECOVERY_PROJECT_BYTES,
  MAXIMUM_RECOVERY_SCAN_ENTRIES,
  RECOVERY_FILE_EXTENSION,
  RECOVERY_FORMAT,
  RECOVERY_TEMPORARY_PATTERN,
  isRecoveryId,
  isRecoveryRecord,
  isRecoverySnapshotRequest,
  recoveryFailure,
  toRecoveryCandidateSummary,
  type RecoveryCandidateSummary,
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
  private suspended = false;
  private generation = 0;

  constructor(private readonly options: RecoveryFileServiceOptions) {}

  dispose(): void {
    this.disposed = true;
    this.revoke();
  }

  /**
   * Withdraws authority from the document that held it.
   *
   * Navigation and a lost renderer both mean the page that could ask for this
   * is gone. A write already in flight for that page must not commit, and
   * nothing is served again until the trusted document is back.
   */
  revoke(): void {
    this.suspended = true;
    this.generation += 1;
  }

  /** The trusted document loaded again, so it may use recovery again. */
  restore(): void {
    if (this.disposed) return;
    this.suspended = false;
  }

  /** Whether the caller that started an operation may still finish it. */
  private available(generation: number): boolean {
    return !this.disposed && !this.suspended && generation === this.generation;
  }

  /** Absolute path for one record. The id shape is validated before it reaches here. */
  private pathFor(recoveryId: string): string {
    return path.join(this.options.directory, `${recoveryId}${RECOVERY_FILE_EXTENSION}`);
  }

  async store(input: unknown): Promise<RecoveryStoreResult> {
    if (!this.available(this.generation))
      return recoveryFailure("STORE_UNAVAILABLE", "The recovery store is closed.");
    if (!isRecoverySnapshotRequest(input))
      return recoveryFailure("INVALID_REQUEST", "Invalid recovery snapshot request.");
    if (Buffer.byteLength(input.content, "utf8") > MAXIMUM_RECOVERY_PROJECT_BYTES)
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
    const serialized = JSON.stringify(record);
    // Measured as it will be read. A payload that passes on its own can still
    // produce an envelope no read would ever accept.
    if (Buffer.byteLength(serialized, "utf8") > MAXIMUM_RECOVERY_BYTES)
      return recoveryFailure("TOO_LARGE", "The project is too large to keep a recovery copy of.");
    const generation = this.generation;
    try {
      await (this.options.ensureDirectory ?? ensureDirectory)(this.options.directory);
      await (this.options.write ?? writeProjectAtomically)(
        this.pathFor(input.recoveryId),
        serialized,
        projectFileSystem,
        () => this.available(generation),
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
    return this.readRecord(input);
  }

  /**
   * Every valid record this application wrote, newest capture first.
   *
   * A record is never dropped for being old: potential artwork outlives any
   * housekeeping rule. Beyond the offered count the extras simply stay on disk
   * for a later startup to find.
   */
  async list(): Promise<readonly RecoveryCandidateSummary[]> {
    const entries = await this.entries();
    const summaries: RecoveryCandidateSummary[] = [];
    let scanned = 0;
    const scanLimit = this.options.maximumScanEntries ?? MAXIMUM_RECOVERY_SCAN_ENTRIES;
    for (const entry of entries) {
      if (!entry.endsWith(RECOVERY_FILE_EXTENSION)) continue;
      // A directory somebody filled with junk must not turn startup into a scan
      // of everything in it; the records past this bound are left alone.
      if (scanned >= scanLimit) break;
      scanned += 1;
      const record = await this.readRecord(entry.slice(0, -RECOVERY_FILE_EXTENSION.length));
      // Only the summary is kept. Deciding what to offer must not mean holding
      // every project in a recovery directory in memory at once.
      if (record !== null) summaries.push(toRecoveryCandidateSummary(record));
    }
    // Chronology comes from the capture itself, not from a filesystem timestamp
    // that a copy, a backup tool, or a restore would have rewritten.
    summaries.sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
    return Object.freeze(
      summaries.slice(0, this.options.maximumCandidates ?? MAXIMUM_RECOVERY_CANDIDATES),
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

  private async readRecord(recoveryId: string): Promise<RecoveryRecord | null> {
    if (!isRecoveryId(recoveryId)) return null;
    try {
      const raw = await readBoundedFile(this.pathFor(recoveryId));
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isRecoveryRecord(parsed)) return null;
      // A record copied or renamed under another id is not that id's record.
      return parsed.recoveryId === recoveryId ? parsed : null;
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

/**
 * Reads a recovery file without letting its size decide how much memory to use.
 *
 * The same shape as the project reader: check the entry is a regular file
 * rather than a link or a directory, bound every read, and stop the moment the
 * content exceeds what recovery accepts, so an oversized or hostile file costs
 * one buffer rather than its whole length.
 */
async function readBoundedFile(filename: string): Promise<string | null> {
  const entry = await lstat(filename);
  if (!entry.isFile() || entry.isSymbolicLink()) return null;
  if (entry.size > MAXIMUM_RECOVERY_BYTES) return null;
  const handle = await open(filename, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAXIMUM_RECOVERY_BYTES) return null;
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAXIMUM_RECOVERY_BYTES - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAXIMUM_RECOVERY_BYTES) return null;
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } finally {
    await handle.close();
  }
}
