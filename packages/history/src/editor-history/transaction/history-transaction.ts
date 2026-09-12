import { HistoryError } from "../../errors";
import type { DocumentContentStateId } from "../interfaces/history-document-session";
import type { HistoryEntry } from "../model/history-entry";
import type { HistoryCommandMetadata, HistoryTransactionOptions } from "../model/history-metadata";
import type { HistoryTransactionState } from "../state/history-state";

/** Private immutable record for the one active generic History transaction. */
export interface ActiveHistoryTransaction<TDocument> {
  readonly metadata: HistoryCommandMetadata;
  readonly entries: readonly HistoryEntry<TDocument>[];
  /**
   * Content identity held before the first child command ran.
   *
   * A rollback restores it, and a commit records it as the composite entry's
   * before-identity, so one gesture reads as one content transition.
   */
  readonly beforeStateId: DocumentContentStateId | null;
}

export function createActiveHistoryTransaction<TDocument>(
  options: HistoryTransactionOptions = {},
  beforeStateId: DocumentContentStateId | null = null,
): ActiveHistoryTransaction<TDocument> {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw invalidTransactionMetadata();
  }
  const metadata = resolveTransactionMetadata(options);
  return Object.freeze({ metadata, entries: Object.freeze([]), beforeStateId });
}

export function appendTransactionEntry<TDocument>(
  transaction: ActiveHistoryTransaction<TDocument>,
  entry: HistoryEntry<TDocument>,
): ActiveHistoryTransaction<TDocument> {
  return Object.freeze({
    metadata: transaction.metadata,
    entries: Object.freeze([...transaction.entries, entry]),
    beforeStateId: transaction.beforeStateId,
  });
}

export function createTransactionState<TDocument>(
  transaction: ActiveHistoryTransaction<TDocument>,
): HistoryTransactionState {
  return Object.freeze({
    ...transaction.metadata,
    commandCount: transaction.entries.length,
  });
}

function resolveTransactionMetadata(options: HistoryTransactionOptions): HistoryCommandMetadata {
  const id = options.id ?? globalThis.crypto.randomUUID();
  const timestamp = options.timestamp ?? new Date().toISOString();
  const description = options.description ?? "Transaction";

  if (!isNonBlankString(id) || !isIsoTimestamp(timestamp) || !isNonBlankString(description)) {
    throw invalidTransactionMetadata(Object.freeze({ id, timestamp, description }));
  }

  return Object.freeze({ id, timestamp, description });
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function invalidTransactionMetadata(details?: Readonly<Record<string, unknown>>): HistoryError {
  return new HistoryError(
    "INVALID_COMMAND",
    "Transactions require an options object with a non-blank id and description plus an ISO-compatible timestamp.",
    details ? { details } : {},
  );
}
