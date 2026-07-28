import { assertValidNotebook } from "@folio/domain";
import type { Notebook } from "@folio/domain";
import type { Command, CommandFactoryOptions, HistoryChangeTarget } from "./command";
import type { LegacyHistoryDirtySink } from "./compatibility/legacy-history-dirty-sink";
import { HistoryError } from "./errors";
import { createSnapshotCommand, resolveCommandMetadata } from "./internal/snapshot-command";
import type { HistorySnapshot, HistoryState, Transaction } from "./state";

export interface HistoryManagerOptions {
  readonly historyLimit?: number;
  readonly dirtyTracker?: LegacyHistoryDirtySink;
}

interface HistoryEntry {
  readonly command: Command;
  readonly before: Notebook;
  readonly after: Notebook;
}

interface ActiveTransaction {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly before: Notebook;
  readonly entries: HistoryEntry[];
}

const DEFAULT_HISTORY_LIMIT = 100;

export class HistoryManager {
  readonly #historyLimit: number;
  readonly #dirtyTracker: LegacyHistoryDirtySink | undefined;
  readonly #verifiedNotebooks = new WeakSet<object>();
  readonly #undoStack: HistoryEntry[] = [];
  readonly #redoStack: HistoryEntry[] = [];
  #notebook: Notebook;
  #savePoint: Notebook;
  #transaction: ActiveTransaction | null = null;
  #revision = 0;

  constructor(notebook: Notebook, options: HistoryManagerOptions = {}) {
    const historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
      throw new HistoryError(
        "INVALID_HISTORY_LIMIT",
        "History limit must be a positive safe integer.",
        { details: { historyLimit } },
      );
    }
    this.#historyLimit = historyLimit;
    this.#dirtyTracker = options.dirtyTracker;
    this.#assertNotebook(notebook);
    this.#notebook = notebook;
    this.#savePoint = notebook;
    this.#dirtyTracker?.clear();
  }

  get notebook(): Notebook {
    return this.#notebook;
  }

  get isDirty(): boolean {
    return this.#notebook !== this.#savePoint;
  }

  get historyLimit(): number {
    return this.#historyLimit;
  }

  execute(command: Command): HistorySnapshot {
    assertCommand(command);
    const before = this.#notebook;
    const after = command.execute(before);
    this.#assertNotebook(after);
    if (after === before) return this.snapshot();

    const entry = Object.freeze({ command, before, after });
    this.#notebook = after;
    this.#revision += 1;
    if (this.#transaction) {
      this.#transaction.entries.push(entry);
    } else {
      this.#pushUndo(entry);
      this.#redoStack.length = 0;
      this.#syncDirtyState(command.affectedTargets);
    }
    return this.snapshot();
  }

  undo(): HistorySnapshot {
    this.#assertNoActiveTransaction("undo");
    const entry = this.#undoStack.at(-1);
    if (!entry) return this.snapshot();
    const notebook = entry.command.undo(this.#notebook);
    this.#assertNotebook(notebook);
    if (notebook !== entry.before) {
      throw commandResultMismatch(entry.command, "undo");
    }
    this.#undoStack.pop();
    this.#redoStack.push(entry);
    this.#notebook = notebook;
    this.#revision += 1;
    this.#syncDirtyState(entry.command.affectedTargets);
    return this.snapshot();
  }

  redo(): HistorySnapshot {
    this.#assertNoActiveTransaction("redo");
    const entry = this.#redoStack.at(-1);
    if (!entry) return this.snapshot();
    const notebook = entry.command.redo(this.#notebook);
    this.#assertNotebook(notebook);
    if (notebook !== entry.after) {
      throw commandResultMismatch(entry.command, "redo");
    }
    this.#redoStack.pop();
    this.#pushUndo(entry);
    this.#notebook = notebook;
    this.#revision += 1;
    this.#syncDirtyState(entry.command.affectedTargets);
    return this.snapshot();
  }

  clear(): HistorySnapshot {
    this.#assertNoActiveTransaction("clear history");
    this.#undoStack.length = 0;
    this.#redoStack.length = 0;
    return this.snapshot();
  }

  canUndo(): boolean {
    return this.#transaction === null && this.#undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.#transaction === null && this.#redoStack.length > 0;
  }

  beginTransaction(options: CommandFactoryOptions = {}): Transaction {
    if (this.#transaction) {
      throw new HistoryError(
        "TRANSACTION_ACTIVE",
        "Nested history transactions are not supported.",
      );
    }
    const metadata = resolveCommandMetadata(options, "Transaction");
    this.#transaction = {
      id: metadata.id,
      timestamp: metadata.timestamp,
      description: metadata.description,
      before: this.#notebook,
      entries: [],
    };
    return transactionSnapshot(this.#transaction);
  }

  commitTransaction(): HistorySnapshot {
    const transaction = this.#requireTransaction("commit");
    this.#transaction = null;
    if (transaction.entries.length === 0 || this.#notebook === transaction.before) {
      return this.snapshot();
    }

    const affectedTargets = uniqueTargets(
      transaction.entries.flatMap(({ command }) => command.affectedTargets),
    );
    const context = {
      createId: () => transaction.id,
      now: () => transaction.timestamp,
    };
    const command = createSnapshotCommand({
      before: transaction.before,
      after: this.#notebook,
      category: "transaction",
      metadata: {
        id: transaction.id,
        timestamp: transaction.timestamp,
        description: transaction.description,
        context,
      },
      affectedTargets,
    });
    this.#pushUndo(Object.freeze({ command, before: transaction.before, after: this.#notebook }));
    this.#redoStack.length = 0;
    this.#syncDirtyState(affectedTargets);
    return this.snapshot();
  }

  rollbackTransaction(): HistorySnapshot {
    const transaction = this.#requireTransaction("roll back");
    let notebook = this.#notebook;
    for (const entry of [...transaction.entries].reverse()) {
      const undone = entry.command.undo(notebook);
      this.#assertNotebook(undone);
      if (undone !== entry.before) {
        throw commandResultMismatch(entry.command, "undo");
      }
      notebook = undone;
    }
    this.#notebook = notebook;
    this.#transaction = null;
    if (transaction.entries.length > 0) this.#revision += 1;
    return this.snapshot();
  }

  markSavePoint(notebook: Notebook = this.#notebook): HistorySnapshot {
    this.#assertNoActiveTransaction("mark a save point");
    this.#assertNotebook(notebook);
    this.#savePoint = notebook;
    if (!this.isDirty) this.#dirtyTracker?.clear();
    return this.snapshot();
  }

  snapshot(): HistorySnapshot {
    return Object.freeze({ notebook: this.#notebook, revision: this.#revision });
  }

  getState(): HistoryState {
    return Object.freeze({
      snapshot: this.snapshot(),
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      isDirty: this.isDirty,
      undoDepth: this.#undoStack.length,
      redoDepth: this.#redoStack.length,
      historyLimit: this.#historyLimit,
      transaction: this.#transaction ? transactionSnapshot(this.#transaction) : null,
    });
  }

  #pushUndo(entry: HistoryEntry): void {
    this.#undoStack.push(entry);
    if (this.#undoStack.length > this.#historyLimit) {
      this.#undoStack.splice(0, this.#undoStack.length - this.#historyLimit);
    }
  }

  #syncDirtyState(targets: readonly HistoryChangeTarget[]): void {
    if (!this.#dirtyTracker) return;
    if (!this.isDirty) {
      this.#dirtyTracker.clear();
      return;
    }
    uniqueTargets(targets).forEach((target) => {
      if (target.kind === "metadata") this.#dirtyTracker?.markMetadata();
      if (target.kind === "section") this.#dirtyTracker?.markSection(target.sectionId);
      if (target.kind === "page") {
        this.#dirtyTracker?.markPage(target.pageId, target.sectionId);
      }
    });
  }

  #assertNotebook(notebook: Notebook): void {
    if (this.#verifiedNotebooks.has(notebook)) return;
    try {
      assertValidNotebook(notebook);
    } catch (error) {
      throw new HistoryError("INVALID_NOTEBOOK", "Command returned an invalid notebook.", {
        cause: error,
      });
    }
    if (!isDeepFrozen(notebook)) {
      throw new HistoryError(
        "INVALID_NOTEBOOK",
        "History requires deeply immutable notebook aggregates.",
      );
    }
    this.#verifiedNotebooks.add(notebook);
  }

  #assertNoActiveTransaction(operation: string): void {
    if (this.#transaction) {
      throw new HistoryError(
        "TRANSACTION_ACTIVE",
        `Cannot ${operation} while a transaction is active.`,
        { details: { transactionId: this.#transaction.id } },
      );
    }
  }

  #requireTransaction(operation: string): ActiveTransaction {
    if (!this.#transaction) {
      throw new HistoryError(
        "TRANSACTION_NOT_ACTIVE",
        `Cannot ${operation} because no transaction is active.`,
      );
    }
    return this.#transaction;
  }
}

function assertCommand(command: Command): void {
  const categories = new Set(["notebook", "page", "section", "transaction"]);
  if (
    command === null ||
    typeof command !== "object" ||
    !Object.isFrozen(command) ||
    typeof command.id !== "string" ||
    command.id.trim().length === 0 ||
    typeof command.description !== "string" ||
    command.description.trim().length === 0 ||
    typeof command.timestamp !== "string" ||
    !Number.isFinite(Date.parse(command.timestamp)) ||
    !categories.has(command.category) ||
    !Array.isArray(command.affectedTargets) ||
    !Object.isFrozen(command.affectedTargets) ||
    command.affectedTargets.some((target) => !Object.isFrozen(target)) ||
    typeof command.execute !== "function" ||
    typeof command.undo !== "function" ||
    typeof command.redo !== "function"
  ) {
    throw new HistoryError(
      "INVALID_COMMAND",
      "Commands must be immutable and contain valid metadata, targets, execute, undo, and redo.",
    );
  }
}

function commandResultMismatch(command: Command, operation: "redo" | "undo"): HistoryError {
  return new HistoryError(
    "COMMAND_RESULT_MISMATCH",
    `Command '${command.id}' returned a different snapshot during ${operation}.`,
    { details: { commandId: command.id, operation } },
  );
}

function transactionSnapshot(transaction: ActiveTransaction): Transaction {
  return Object.freeze({
    id: transaction.id,
    timestamp: transaction.timestamp,
    description: transaction.description,
    commandCount: transaction.entries.length,
  });
}

function uniqueTargets(targets: readonly HistoryChangeTarget[]): readonly HistoryChangeTarget[] {
  const unique = new Map<string, HistoryChangeTarget>();
  targets.forEach((target) => unique.set(targetKey(target), target));
  return Object.freeze([...unique.values()]);
}

function targetKey(target: HistoryChangeTarget): string {
  if (target.kind === "metadata") return "metadata";
  if (target.kind === "section") return `section:${target.sectionId}`;
  return `page:${target.sectionId}:${target.pageId}`;
}

function isDeepFrozen(value: unknown, visited = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== "object" || visited.has(value)) return true;
  if (!Object.isFrozen(value)) return false;
  visited.add(value);
  return Object.values(value).every((child) => isDeepFrozen(child, visited));
}
