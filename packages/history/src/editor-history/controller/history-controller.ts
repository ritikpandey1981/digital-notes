import { HistoryError, isHistoryError } from "../../errors";
import type { EditorCommand } from "../interfaces/editor-command";
import type { IHistoryController } from "../interfaces/history-controller";
import type { IHistoryManager } from "../interfaces/history-manager";
import {
  claimEditorHistoryManager,
  type EditorHistoryLifecycleEvent,
} from "../manager/editor-history-manager";
import type {
  HistoryCommandMetadata,
  HistoryOperation,
  HistoryTransactionOptions,
} from "../model/history-metadata";
import type {
  HistoryFailureNotification,
  HistoryListener,
  HistoryNotification,
  HistorySuccessNotification,
} from "../model/history-notification";
import type { EditorHistoryControllerOptions } from "../model/history-options";
import type { HistoryTransactionState, IHistoryState } from "../state/history-state";

class HistoryControllerImplementation<TDocument> implements IHistoryController<TDocument> {
  readonly #manager: IHistoryManager<TDocument>;
  readonly #listeners = new Set<HistoryListener>();
  readonly #releaseManager: () => void;
  #destroyed = false;
  #operationActive = false;
  #dispatching = false;
  #notificationCount = 0;

  constructor(options: EditorHistoryControllerOptions<TDocument>) {
    this.#manager = options?.manager;
    this.#releaseManager = claimEditorHistoryManager(this.#manager, (event) => {
      this.#handleLifecycleEvent(event);
    });
  }

  executeCommand(command: EditorCommand<TDocument>): IHistoryState {
    return this.#runNotifiedOperation(
      "execute",
      () => this.#manager.executeCommand(command),
      command,
    );
  }

  undo(): IHistoryState {
    return this.#runNotifiedOperation("undo", () => this.#manager.undo());
  }

  redo(): IHistoryState {
    return this.#runNotifiedOperation("redo", () => this.#manager.redo());
  }

  clearHistory(): IHistoryState {
    return this.#runExclusive("clear History", () => this.#manager.clearHistory());
  }

  canUndo(): boolean {
    this.#assertAlive();
    return this.#manager.canUndo();
  }

  canRedo(): boolean {
    this.#assertAlive();
    return this.#manager.canRedo();
  }

  getHistoryState(): IHistoryState {
    this.#assertAlive();
    return this.#manager.getHistoryState();
  }

  getHistoryVersion(): number {
    this.#assertAlive();
    return this.#manager.getHistoryVersion();
  }

  beginTransaction(options?: HistoryTransactionOptions): HistoryTransactionState {
    return this.#runExclusive("begin a transaction", () => this.#manager.beginTransaction(options));
  }

  commitTransaction(): IHistoryState {
    return this.#runExclusive("commit a transaction", () => this.#manager.commitTransaction());
  }

  rollbackTransaction(): IHistoryState {
    return this.#runExclusive("roll back a transaction", () => this.#manager.rollbackTransaction());
  }

  subscribe(listener: HistoryListener): () => void {
    this.#assertAlive();
    if (typeof listener !== "function") {
      throw new HistoryError("INVALID_HISTORY_LISTENER", "History listeners must be functions.");
    }
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#listeners.clear();
    this.#releaseManager();
  }

  #runNotifiedOperation<TResult>(
    operation: HistoryOperation,
    invoke: () => TResult,
    command?: EditorCommand<TDocument>,
  ): TResult {
    this.#assertCanOperate(operation);
    const notificationsBefore = this.#notificationCount;
    this.#operationActive = true;
    try {
      return invoke();
    } catch (error) {
      const historyError = normalizeOperationError(operation, error);
      if (!this.#destroyed && this.#notificationCount === notificationsBefore) {
        this.#publish(
          createFailureNotification(
            operation,
            command === undefined ? null : readCommandMetadata(command),
            this.#manager.getHistoryState(),
            historyError,
          ),
        );
      }
      throw historyError;
    } finally {
      this.#operationActive = false;
    }
  }

  #runExclusive<TResult>(operation: string, invoke: () => TResult): TResult {
    this.#assertCanOperate(operation);
    this.#operationActive = true;
    try {
      return invoke();
    } finally {
      this.#operationActive = false;
    }
  }

  #handleLifecycleEvent(event: EditorHistoryLifecycleEvent): void {
    const notification =
      event.outcome === "succeeded"
        ? createSuccessNotification(event)
        : createFailureNotification(event.operation, event.command, event.state, event.error);
    this.#publish(notification);
  }

  #publish(notification: HistoryNotification): void {
    if (this.#destroyed) return;
    this.#notificationCount += 1;
    this.#dispatching = true;
    try {
      for (const listener of [...this.#listeners]) {
        if (this.#destroyed) break;
        if (!this.#listeners.has(listener)) continue;
        try {
          listener(notification);
        } catch {
          continue;
        }
      }
    } finally {
      this.#dispatching = false;
    }
  }

  #assertAlive(): void {
    if (this.#destroyed) {
      throw new HistoryError(
        "HISTORY_CONTROLLER_DESTROYED",
        "The History controller has been destroyed.",
      );
    }
  }

  #assertCanOperate(operation: string): void {
    this.#assertAlive();
    if (this.#operationActive || this.#dispatching) {
      throw new HistoryError(
        "HISTORY_LIFECYCLE_VIOLATION",
        `Cannot ${operation} while the History controller is coordinating another operation.`,
        { details: Object.freeze({ operation }) },
      );
    }
  }
}

/** Creates the sole editor-facing controller for one generic History manager. */
export function createHistoryController<TDocument>(
  options: EditorHistoryControllerOptions<TDocument>,
): IHistoryController<TDocument> {
  return new HistoryControllerImplementation(options);
}

function createSuccessNotification(
  event: Extract<EditorHistoryLifecycleEvent, { readonly outcome: "succeeded" }>,
): HistorySuccessNotification {
  return Object.freeze({
    operation: event.operation,
    outcome: event.outcome,
    command: event.command,
    state: event.state,
  });
}

function createFailureNotification(
  operation: HistoryOperation,
  command: HistoryCommandMetadata | null,
  state: IHistoryState,
  error: HistoryError,
): HistoryFailureNotification {
  Object.freeze(error);
  return Object.freeze({ operation, outcome: "failed", command, state, error });
}

function readCommandMetadata<TDocument>(
  command: EditorCommand<TDocument>,
): HistoryCommandMetadata | null {
  try {
    if (
      typeof command.id !== "string" ||
      command.id.trim().length === 0 ||
      typeof command.timestamp !== "string" ||
      !Number.isFinite(Date.parse(command.timestamp)) ||
      typeof command.description !== "string" ||
      command.description.trim().length === 0
    ) {
      return null;
    }
    return Object.freeze({
      id: command.id,
      timestamp: command.timestamp,
      description: command.description,
    });
  } catch {
    return null;
  }
}

function normalizeOperationError(operation: HistoryOperation, error: unknown): HistoryError {
  if (isHistoryError(error)) return error;
  const code = {
    execute: "COMMAND_EXECUTION_FAILED",
    redo: "COMMAND_REDO_FAILED",
    undo: "COMMAND_UNDO_FAILED",
  } as const;
  return new HistoryError(code[operation], `History ${operation} failed.`, { cause: error });
}
