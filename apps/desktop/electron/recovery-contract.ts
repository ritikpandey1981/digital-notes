export const RECOVERY_STORE_CHANNEL = "folio:recovery:store";
export const RECOVERY_CLEAR_CHANNEL = "folio:recovery:clear";

export const RECOVERY_FORMAT = "folio-recovery";
export const CURRENT_RECOVERY_VERSION = 1;
export const RECOVERY_FILE_EXTENSION = ".folio-recovery";

/** Recovery payloads are application-owned but still disk input on the way back. */
export const MAXIMUM_RECOVERY_BYTES = 64 * 1024 * 1024;

export type RecoveryErrorCode =
  | "INVALID_REQUEST"
  | "TOO_LARGE"
  | "PERMISSION_DENIED"
  | "WRITE_FAILED"
  | "STORE_UNAVAILABLE"
  | "UNKNOWN";

export type RecoveryStoreResult =
  | Readonly<{ status: "stored" }>
  | Readonly<{ status: "failed"; error: Readonly<{ code: RecoveryErrorCode; message: string }> }>;

export type RecoveryClearResult =
  | Readonly<{ status: "cleared" }>
  | Readonly<{ status: "failed"; error: Readonly<{ code: RecoveryErrorCode; message: string }> }>;

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
  /** Main-owned original location, for a future Open Original. Never sent to the renderer. */
  readonly source: Readonly<{ path: string }> | null;
  readonly project: string;
}

/** The renderer's entire recovery authority: replace its own record, or drop it. */
export interface DesktopRecoveryPort {
  readonly store: (request: RecoverySnapshotRequest) => Promise<RecoveryStoreResult>;
  readonly clear: (recoveryId: string) => Promise<RecoveryClearResult>;
}

export function recoveryFailure(
  code: RecoveryErrorCode,
  message: string,
): Readonly<{ status: "failed"; error: Readonly<{ code: RecoveryErrorCode; message: string }> }> {
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
    record.title.length <= 500 &&
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
 * P7 reads these at startup, when nothing guarantees the file was written by a
 * version that still exists, or was not truncated by the very crash it records.
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
    typeof record.hadBacking === "boolean" &&
    (record.source === null ||
      (record.source !== null &&
        typeof record.source === "object" &&
        typeof (record.source as Record<string, unknown>).path === "string")) &&
    typeof record.project === "string" &&
    record.project.length > 0
  );
}
