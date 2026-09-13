import { HistoryError, isHistoryError } from "../../errors";
import type { EditorCommand } from "../interfaces/editor-command";
import type {
  DocumentContentStateId,
  HistoryDocumentSession,
} from "../interfaces/history-document-session";
import type { IHistoryManager } from "../interfaces/history-manager";
import { createHistoryEntry, withContentStateIdentity } from "../model/history-entry";
import type { HistoryEntry } from "../model/history-entry";
import type {
  HistoryCommandMetadata,
  HistoryOperation,
  HistoryTransactionOptions,
} from "../model/history-metadata";
import type { EditorHistoryManagerOptions } from "../model/history-options";
import { BoundedCommandStack } from "../stack/bounded-command-stack";
import {
  IDLE_HISTORY_EXECUTION_STATE,
  createActiveExecutionState,
  createCompletedExecutionState,
  createHistoryState,
} from "../state/history-state-builder";
import type {
  HistoryExecutionState,
  HistoryTransactionState,
  IHistoryState,
} from "../state/history-state";
import {
  appendTransactionEntry,
  createActiveHistoryTransaction,
  createTransactionState,
} from "../transaction/history-transaction";
import type { ActiveHistoryTransaction } from "../transaction/history-transaction";
import {
  createTransactionHistoryEntry,
  rollbackTransactionCommands,
} from "../transaction/transaction-command-group";
import { assertEditorCommand } from "../validation/command-integrity";

const DEFAULT_HISTORY_LIMIT = 100;
const HISTORY_CONTROLLER_ACCESS = Symbol("folio.history.controller-access");

export type EditorHistoryLifecycleEvent =
  | Readonly<{
      operation: HistoryOperation;
      outcome: "succeeded";
      command: HistoryCommandMetadata;
      state: IHistoryState;
    }>
  | Readonly<{
      operation: HistoryOperation;
      outcome: "failed";
      command: HistoryCommandMetadata;
      state: IHistoryState;
      error: HistoryError;
    }>;

export type EditorHistoryLifecycleObserver = (event: EditorHistoryLifecycleEvent) => void;

interface ControllerOwnableHistoryManager {
  readonly [HISTORY_CONTROLLER_ACCESS]: (observer: EditorHistoryLifecycleObserver) => () => void;
}

class EditorHistoryManagerImplementation<TDocument> implements IHistoryManager<TDocument> {
  readonly #documentSession: HistoryDocumentSession<TDocument>;
  readonly #historyLimit: number;
  readonly #onRetainedCommandsChange: ((commandIds: readonly string[]) => void) | undefined;
  readonly #undoStack: BoundedCommandStack<HistoryEntry<TDocument>>;
  readonly #redoStack: BoundedCommandStack<HistoryEntry<TDocument>>;
  #historyVersion = 0;
  #executionCounter = 0;
  #executionState: HistoryExecutionState = IDLE_HISTORY_EXECUTION_STATE;
  #lastCommand: HistoryCommandMetadata | null = null;
  #controllerObserver: EditorHistoryLifecycleObserver | null = null;
  #activeTransaction: ActiveHistoryTransaction<TDocument> | null = null;
  #transactionOperation: "committing" | "rolling-back" | null = null;

  readonly [HISTORY_CONTROLLER_ACCESS] = (
    observer: EditorHistoryLifecycleObserver,
  ): (() => void) => {
    if (this.#controllerObserver !== null) {
      throw new HistoryError(
        "HISTORY_MANAGER_ALREADY_CONTROLLED",
        "A generic History manager can be owned by only one active controller.",
      );
    }
    this.#controllerObserver = observer;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.#controllerObserver === observer) this.#controllerObserver = null;
    };
  };

  constructor(options: EditorHistoryManagerOptions<TDocument>) {
    const resolved = resolveManagerOptions(options);
    this.#documentSession = resolved.documentSession;
    this.#historyLimit = resolved.historyLimit;
    this.#onRetainedCommandsChange = options.onRetainedCommandsChange;
    this.#undoStack = new BoundedCommandStack(this.#historyLimit);
    this.#redoStack = new BoundedCommandStack(this.#historyLimit);
  }

  executeCommand(command: EditorCommand<TDocument>): IHistoryState {
    this.#assertIdle("execute a command");
    assertEditorCommand(command);
    const entry = createHistoryEntry(command);
    this.#executionState = createActiveExecutionState("execute", entry.metadata);

    try {
      const current = this.#documentSession.getDocument();
      const beforeStateId = this.#contentStateId();
      const successor = command.execute(current);
      if (successor !== current) {
        this.#installSuccessor(current, successor);
        // Identity is recorded only after installation, so a command that
        // changes nothing and one that fails both leave content identity alone.
        const committed = withContentStateIdentity(entry, beforeStateId, this.#contentStateId());
        if (this.#activeTransaction) {
          this.#activeTransaction = appendTransactionEntry(this.#activeTransaction, committed);
        } else {
          this.#undoStack.push(committed);
          this.#redoStack.clear();
        }
        this.#historyVersion += 1;
      }
      return this.#completeSuccess("execute", entry.metadata);
    } catch (error) {
      const failure = operationFailure("execute", entry.metadata, error);
      this.#executionState = createCompletedExecutionState("execute", "failed", entry.metadata);
      this.#emitLifecycle(
        Object.freeze({
          operation: "execute",
          outcome: "failed",
          command: entry.metadata,
          state: this.getHistoryState(),
          error: failure,
        }),
      );
      throw failure;
    } finally {
      this.#executionState = IDLE_HISTORY_EXECUTION_STATE;
      this.#publishRetainedCommands();
    }
  }

  undo(): IHistoryState {
    this.#assertIdle("undo");
    this.#assertNoActiveTransaction("undo");
    const entry = this.#undoStack.peek();
    if (!entry) return this.getHistoryState();
    this.#executionState = createActiveExecutionState("undo", entry.metadata);

    try {
      const current = this.#documentSession.getDocument();
      const successor = entry.command.undo(current);
      assertDistinctSuccessor(current, successor, "undo");
      this.#installSuccessor(current, successor);
      this.#restoreContentStateId(entry.beforeStateId);
      this.#undoStack.pop();
      this.#redoStack.push(entry);
      this.#historyVersion += 1;
      return this.#completeSuccess("undo", entry.metadata);
    } catch (error) {
      const failure = operationFailure("undo", entry.metadata, error);
      this.#executionState = createCompletedExecutionState("undo", "failed", entry.metadata);
      this.#emitLifecycle(
        Object.freeze({
          operation: "undo",
          outcome: "failed",
          command: entry.metadata,
          state: this.getHistoryState(),
          error: failure,
        }),
      );
      throw failure;
    } finally {
      this.#executionState = IDLE_HISTORY_EXECUTION_STATE;
      this.#publishRetainedCommands();
    }
  }

  redo(): IHistoryState {
    this.#assertIdle("redo");
    this.#assertNoActiveTransaction("redo");
    const entry = this.#redoStack.peek();
    if (!entry) return this.getHistoryState();
    this.#executionState = createActiveExecutionState("redo", entry.metadata);

    try {
      const current = this.#documentSession.getDocument();
      const successor = entry.command.redo(current);
      assertDistinctSuccessor(current, successor, "redo");
      this.#installSuccessor(current, successor);
      this.#restoreContentStateId(entry.afterStateId);
      this.#redoStack.pop();
      this.#undoStack.push(entry);
      this.#historyVersion += 1;
      return this.#completeSuccess("redo", entry.metadata);
    } catch (error) {
      const failure = operationFailure("redo", entry.metadata, error);
      this.#executionState = createCompletedExecutionState("redo", "failed", entry.metadata);
      this.#emitLifecycle(
        Object.freeze({
          operation: "redo",
          outcome: "failed",
          command: entry.metadata,
          state: this.getHistoryState(),
          error: failure,
        }),
      );
      throw failure;
    } finally {
      this.#executionState = IDLE_HISTORY_EXECUTION_STATE;
      this.#publishRetainedCommands();
    }
  }

  clearHistory(): IHistoryState {
    this.#assertIdle("clear History");
    this.#assertNoActiveTransaction("clear History");
    const changed = !this.#undoStack.isEmpty || !this.#redoStack.isEmpty;
    this.#undoStack.clear();
    this.#redoStack.clear();
    if (changed) this.#historyVersion += 1;
    this.#publishRetainedCommands();
    return this.getHistoryState();
  }

  canUndo(): boolean {
    return (
      this.#executionState.phase === "idle" &&
      this.#activeTransaction === null &&
      !this.#undoStack.isEmpty
    );
  }

  canRedo(): boolean {
    return (
      this.#executionState.phase === "idle" &&
      this.#activeTransaction === null &&
      !this.#redoStack.isEmpty
    );
  }

  getHistoryState(): IHistoryState {
    return createHistoryState({
      undoDepth: this.#undoStack.depth,
      redoDepth: this.#redoStack.depth,
      historyLimit: this.#historyLimit,
      historyVersion: this.#historyVersion,
      executionCounter: this.#executionCounter,
      executionState: this.#executionState,
      activeTransaction: this.#activeTransaction
        ? createTransactionState(this.#activeTransaction)
        : null,
      lastCommand: this.#lastCommand,
    });
  }

  getHistoryVersion(): number {
    return this.#historyVersion;
  }

  beginTransaction(options?: HistoryTransactionOptions): HistoryTransactionState {
    this.#assertIdle("begin a transaction");
    if (this.#activeTransaction) {
      throw new HistoryError(
        "TRANSACTION_ACTIVE",
        "Nested History transactions are not supported.",
        { details: Object.freeze({ transactionId: this.#activeTransaction.metadata.id }) },
      );
    }
    this.#activeTransaction = createActiveHistoryTransaction(options, this.#contentStateId());
    // Everything the transaction writes from here is provisional until it ends.
    this.#documentSession.beginPendingCommit?.();
    return createTransactionState(this.#activeTransaction);
  }

  commitTransaction(): IHistoryState {
    this.#assertIdle("commit a transaction");
    const transaction = this.#requireTransaction("commit");
    this.#transactionOperation = "committing";
    try {
      if (transaction.entries.length > 0) {
        const entry = createTransactionHistoryEntry(transaction);
        this.#undoStack.push(
          withContentStateIdentity(entry, transaction.beforeStateId, this.#contentStateId()),
        );
        this.#redoStack.clear();
      }
      this.#activeTransaction = null;
      return this.getHistoryState();
    } catch (error) {
      throw transactionFailure("commit", transaction.metadata, error);
    } finally {
      this.#transactionOperation = null;
      this.#documentSession.endPendingCommit?.();
      this.#publishRetainedCommands();
    }
  }

  rollbackTransaction(): IHistoryState {
    this.#assertIdle("roll back a transaction");
    const transaction = this.#requireTransaction("roll back");
    this.#transactionOperation = "rolling-back";
    try {
      if (transaction.entries.length > 0) {
        const current = this.#documentSession.getDocument();
        const successor = rollbackTransactionCommands(transaction, current);
        this.#installSuccessor(current, successor);
        this.#restoreContentStateId(transaction.beforeStateId);
        this.#historyVersion += 1;
      }
      this.#activeTransaction = null;
      return this.getHistoryState();
    } catch (error) {
      throw transactionFailure("roll back", transaction.metadata, error);
    } finally {
      this.#transactionOperation = null;
      this.#documentSession.endPendingCommit?.();
      this.#publishRetainedCommands();
    }
  }

  /** Publishes identities, never commands, closures, or document snapshots. */
  #publishRetainedCommands(): void {
    if (this.#onRetainedCommandsChange === undefined) return;
    const ids = new Set<string>();
    for (const entry of this.#undoStack.entries()) ids.add(entry.metadata.id);
    for (const entry of this.#redoStack.entries()) ids.add(entry.metadata.id);
    if (this.#activeTransaction !== null) ids.add(this.#activeTransaction.metadata.id);
    try {
      this.#onRetainedCommandsChange(Object.freeze([...ids]));
    } catch {
      // Companion bookkeeping cannot interrupt the generic History lifecycle.
    }
  }

  #completeSuccess(operation: HistoryOperation, metadata: HistoryCommandMetadata): IHistoryState {
    this.#executionCounter += 1;
    this.#lastCommand = metadata;
    this.#executionState = createCompletedExecutionState(operation, "succeeded", metadata);
    const state = this.getHistoryState();
    this.#emitLifecycle(
      Object.freeze({ operation, outcome: "succeeded", command: metadata, state }),
    );
    return state;
  }

  #emitLifecycle(event: EditorHistoryLifecycleEvent): void {
    try {
      this.#controllerObserver?.(event);
    } catch {
      return;
    }
  }

  /** Reads the session's content identity, or null when it keeps none. */
  #contentStateId(): DocumentContentStateId | null {
    return this.#documentSession.getContentStateId?.() ?? null;
  }

  /** Reinstalls a recorded identity so revisited content is recognised as the same state. */
  #restoreContentStateId(stateId: DocumentContentStateId | null): void {
    if (stateId === null) return;
    this.#documentSession.restoreContentStateId?.(stateId);
  }

  #installSuccessor(current: TDocument, successor: TDocument): void {
    const restoredStateId = this.#contentStateId();
    try {
      this.#documentSession.replaceDocument(successor);
      if (this.#documentSession.getDocument() !== successor) {
        throw new Error("The document session did not retain the command successor.");
      }
    } catch (error) {
      try {
        this.#documentSession.replaceDocument(current);
        // Restoring the predecessor must also restore its identity; otherwise a
        // failed command would leave a saved project looking edited.
        this.#restoreContentStateId(restoredStateId);
      } catch (recoveryError) {
        throw new AggregateError(
          [error, recoveryError],
          "The document session failed to install the successor and restore its predecessor.",
          { cause: recoveryError },
        );
      }
      throw error;
    }
  }

  #assertIdle(operation: string): void {
    if (this.#executionState.phase !== "idle" || this.#transactionOperation !== null) {
      const phase = this.#transactionOperation ?? this.#executionState.phase;
      throw new HistoryError(
        "HISTORY_LIFECYCLE_VIOLATION",
        `Cannot ${operation} while History is ${phase}.`,
        { details: Object.freeze({ phase, operation }) },
      );
    }
  }

  #assertNoActiveTransaction(operation: string): void {
    if (!this.#activeTransaction) return;
    throw new HistoryError(
      "TRANSACTION_ACTIVE",
      `Cannot ${operation} while a transaction is active.`,
      { details: Object.freeze({ transactionId: this.#activeTransaction.metadata.id }) },
    );
  }

  #requireTransaction(operation: string): ActiveHistoryTransaction<TDocument> {
    if (this.#activeTransaction) return this.#activeTransaction;
    throw new HistoryError(
      "TRANSACTION_NOT_ACTIVE",
      `Cannot ${operation} because no transaction is active.`,
    );
  }
}

/** Creates one private generic manager for an active editor document session. */
export function createEditorHistoryManager<TDocument>(
  options: EditorHistoryManagerOptions<TDocument>,
): IHistoryManager<TDocument> {
  return new EditorHistoryManagerImplementation(options);
}

/** Internal ownership hook consumed only by the private History controller. */
export function claimEditorHistoryManager<TDocument>(
  manager: IHistoryManager<TDocument>,
  observer: EditorHistoryLifecycleObserver,
): () => void {
  if (manager === null || typeof manager !== "object") throw invalidHistoryManager();
  const candidate = manager as IHistoryManager<TDocument> &
    Partial<ControllerOwnableHistoryManager>;
  const claim = candidate[HISTORY_CONTROLLER_ACCESS];
  if (typeof claim !== "function") throw invalidHistoryManager();
  return claim.call(candidate, observer);
}

function resolveManagerOptions<TDocument>(options: EditorHistoryManagerOptions<TDocument>): {
  readonly documentSession: HistoryDocumentSession<TDocument>;
  readonly historyLimit: number;
} {
  const documentSession = options?.documentSession;
  if (
    documentSession === null ||
    typeof documentSession !== "object" ||
    typeof documentSession.getDocument !== "function" ||
    typeof documentSession.replaceDocument !== "function"
  ) {
    throw new HistoryError(
      "INVALID_DOCUMENT_SESSION",
      "A History manager requires a document session with read and replacement operations.",
    );
  }
  const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
    throw new HistoryError(
      "INVALID_HISTORY_LIMIT",
      "History limit must be a positive safe integer.",
      { details: Object.freeze({ historyLimit }) },
    );
  }
  if (
    options.onRetainedCommandsChange !== undefined &&
    typeof options.onRetainedCommandsChange !== "function"
  ) {
    throw new HistoryError(
      "INVALID_HISTORY_MANAGER",
      "History retained-command observers must be functions.",
    );
  }
  return Object.freeze({ documentSession, historyLimit });
}

function assertDistinctSuccessor<TDocument>(
  current: TDocument,
  successor: TDocument,
  operation: "redo" | "undo",
): void {
  if (successor === current) {
    throw new Error(`Command ${operation} must produce a distinct immutable successor.`);
  }
}

function operationFailure(
  operation: HistoryOperation,
  metadata: HistoryCommandMetadata,
  cause: unknown,
): HistoryError {
  const code = {
    execute: "COMMAND_EXECUTION_FAILED",
    redo: "COMMAND_REDO_FAILED",
    undo: "COMMAND_UNDO_FAILED",
  } as const;
  if (isHistoryError(cause) && cause.code === code[operation]) return cause;
  return new HistoryError(code[operation], `Command '${metadata.id}' failed during ${operation}.`, {
    cause,
    details: Object.freeze({ commandId: metadata.id, operation }),
  });
}

function invalidHistoryManager(): HistoryError {
  return new HistoryError(
    "INVALID_HISTORY_MANAGER",
    "History controllers require a manager created by createEditorHistoryManager().",
  );
}

function transactionFailure(
  operation: "commit" | "roll back",
  metadata: HistoryCommandMetadata,
  cause: unknown,
): HistoryError {
  const code = operation === "commit" ? "TRANSACTION_COMMIT_FAILED" : "TRANSACTION_ROLLBACK_FAILED";
  if (isHistoryError(cause) && cause.code === code) return cause;
  return new HistoryError(code, `Transaction '${metadata.id}' failed during ${operation}.`, {
    cause,
    details: Object.freeze({ transactionId: metadata.id, operation }),
  });
}
