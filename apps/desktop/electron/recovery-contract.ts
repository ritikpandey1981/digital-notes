import type { ProjectReadResult } from "./project-open-contract";

export const RECOVERY_STORE_CHANNEL = "folio:recovery:store";
export const RECOVERY_CLEAR_CHANNEL = "folio:recovery:clear";
export const RECOVERY_LIST_CHANNEL = "folio:recovery:list";
export const RECOVERY_READ_CHANNEL = "folio:recovery:read";
export const RECOVERY_OPEN_ORIGINAL_CHANNEL = "folio:recovery:open-original";

export const RECOVERY_FORMAT = "folio-recovery";
export const CURRENT_RECOVERY_VERSION = 1;
export const RECOVERY_FILE_EXTENSION = ".folio-recovery";

/** Recovery payloads are application-owned but still disk input on the way back. */
export const MAXIMUM_RECOVERY_BYTES = 64 * 1024 * 1024;
/** How many candidates a startup scan will offer. Generous; the usual count is one. */
export const MAXIMUM_RECOVERY_CANDIDATES = 20;
/** How many directory entries one scan will parse, so a flooded directory cannot hang startup. */
export const MAXIMUM_RECOVERY_SCAN_ENTRIES = 200;
export const MAXIMUM_RECOVERY_TITLE_LENGTH = 500;

/**
 * The abandoned temporary files an interrupted atomic write can leave behind.
 *
 * It matches exactly what the atomic write creates and nothing else, because
 * the startup sweep that uses it deletes what it matches.
 */
export const RECOVERY_TEMPORARY_PATTERN = /^\.folio-[0-9a-f-]{36}\.tmp$/i;

export type RecoveryErrorCode =
  | "INVALID_REQUEST"
  | "NOT_FOUND"
  | "INVALID_RECOVERY"
  | "TOO_LARGE"
  | "PERMISSION_DENIED"
  | "READ_FAILED"
  | "WRITE_FAILED"
  | "STORE_UNAVAILABLE"
  | "UNKNOWN";

export type RecoveryFailure = Readonly<{
  status: "failed";
  error: Readonly<{ code: RecoveryErrorCode; message: string }>;
}>;

export type RecoveryStoreResult = Readonly<{ status: "stored" }> | RecoveryFailure;

export type RecoveryClearResult = Readonly<{ status: "cleared" }> | RecoveryFailure;

/**
 * What the renderer is told about one crash-recovery candidate.
 *
 * Everything here is safe to show: a logical title, when it was captured, and
 * whether an original file is still reachable. The original's location stays in
 * main, which is the only side that ever needs it.
 */
export interface RecoveryCandidateSummary {
  readonly recoveryId: string;
  readonly documentId: string;
  readonly title: string;
  readonly capturedAt: string;
  readonly hadBacking: boolean;
  /** True when main still holds a location it could open the original from. */
  readonly canOpenOriginal: boolean;
}

export type RecoveryListResult =
  Readonly<{ status: "listed"; candidates: readonly RecoveryCandidateSummary[] }> | RecoveryFailure;

/** One candidate's embedded project payload, decoded by the renderer's own codec. */
export type RecoveryReadResult = Readonly<{ status: "read"; content: string }> | RecoveryFailure;

/**
 * What the renderer may say about a recovery snapshot.
 *
 * It carries an opaque backing target id, never a path: main resolves that id
 * against its own registry, so the original file location stays on the side of
 * the boundary that already owns it.
 */
export interface RecoverySnapshotRequest {
  readonly recoveryId: string;
  readonly sessionId: string;
  readonly documentId: string;
  readonly title: string;
  readonly capturedAt: string;
  readonly backingTargetId: string | null;
  readonly content: string;
}

/**
 * The record written to disk.
 *
 * Its own format discriminator and version are deliberately separate from the
 * project format: the embedded `project` stays a canonical v1 `.folio` payload
 * that the existing codec decodes, so recovery can evolve without touching what
 * the user's own files mean.
 */
export interface RecoveryRecord {
  readonly format: typeof RECOVERY_FORMAT;
  readonly formatVersion: number;
  readonly recoveryId: string;
  readonly sessionId: string;
  readonly capturedAt: string;
  readonly documentId: string;
  readonly title: string;
  readonly hadBacking: boolean;
  /** Main-owned original location, for Open Original. Never sent to the renderer. */
  readonly source: Readonly<{ path: string }> | null;
  readonly project: string;
}

/** The renderer's write authority: replace its own record, or drop one by id. */
export interface DesktopRecoveryPort {
  readonly store: (request: RecoverySnapshotRequest) => Promise<RecoveryStoreResult>;
  readonly clear: (recoveryId: string) => Promise<RecoveryClearResult>;
}

/**
 * The renderer's read authority, added for the startup recovery flow.
 *
 * Every operation is scoped to an id main itself issued and can still find in
 * its own directory. There is no directory listing, no path, and no way to name
 * a file that is not a recovery record.
 */
export interface DesktopRecoveryDiscoveryPort {
  readonly list: () => Promise<RecoveryListResult>;
  readonly read: (recoveryId: string) => Promise<RecoveryReadResult>;
  /** Reads the original file this candidate came from, as a normal Open would. */
  readonly openOriginal: (recoveryId: string) => Promise<ProjectReadResult>;
}

export function recoveryFailure(code: RecoveryErrorCode, message: string): RecoveryFailure {
  return { status: "failed", error: { code, message } };
}

/** Recovery ids name files, so they are restricted to a shape no path can escape. */
export function isRecoveryId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function isNonBlankString(value: unknown, maximumLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximumLength;
}

export function isRecoverySnapshotRequest(value: unknown): value is RecoverySnapshotRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = [
    "recoveryId",
    "sessionId",
    "documentId",
    "title",
    "capturedAt",
    "backingTargetId",
    "content",
  ];
  if (Object.keys(record).length !== keys.length) return false;
  if (!keys.every((key) => Object.hasOwn(record, key))) return false;
  return (
    isRecoveryId(record.recoveryId) &&
    isRecoveryId(record.sessionId) &&
    isNonBlankString(record.documentId, 200) &&
    typeof record.title === "string" &&
    record.title.length <= MAXIMUM_RECOVERY_TITLE_LENGTH &&
    isNonBlankString(record.capturedAt, 40) &&
    Number.isFinite(Date.parse(record.capturedAt as string)) &&
    (record.backingTargetId === null || isRecoveryId(record.backingTargetId)) &&
    typeof record.content === "string" &&
    record.content.length > 0
  );
}

/**
 * Validates a record read back from disk.
 *
 * Startup reads these when nothing guarantees the file was written by a version
 * that still exists, or was not truncated by the very crash it records. Every
 * string a summary would carry is bounded here, so an oversized field cannot
 * reach the renderer by way of a hand-written file.
 */
export function isRecoveryRecord(value: unknown): value is RecoveryRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.format === RECOVERY_FORMAT &&
    record.formatVersion === CURRENT_RECOVERY_VERSION &&
    isRecoveryId(record.recoveryId) &&
    isRecoveryId(record.sessionId) &&
    isNonBlankString(record.capturedAt, 40) &&
    Number.isFinite(Date.parse(record.capturedAt as string)) &&
    isNonBlankString(record.documentId, 200) &&
    typeof record.title === "string" &&
    record.title.length <= MAXIMUM_RECOVERY_TITLE_LENGTH &&
    typeof record.hadBacking === "boolean" &&
    (record.source === null ||
      (record.source !== null &&
        typeof record.source === "object" &&
        typeof (record.source as Record<string, unknown>).path === "string")) &&
    typeof record.project === "string" &&
    record.project.length > 0
  );
}

/** Everything about a record that is safe to show, and nothing more. */
export function toRecoveryCandidateSummary(record: RecoveryRecord): RecoveryCandidateSummary {
  return Object.freeze({
    recoveryId: record.recoveryId,
    documentId: record.documentId,
    title: record.title,
    capturedAt: record.capturedAt,
    hadBacking: record.hadBacking,
    canOpenOriginal: record.source !== null,
  });
}
