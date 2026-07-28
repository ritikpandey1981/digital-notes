import type { EditorCommand } from "../interfaces/editor-command";
import { createHistoryEntry } from "../model/history-entry";
import type { HistoryEntry } from "../model/history-entry";
import type { HistoryCommandMetadata } from "../model/history-metadata";
import type { ActiveHistoryTransaction } from "./history-transaction";

class TransactionCommandGroup<TDocument> implements EditorCommand<TDocument> {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly #commands: readonly EditorCommand<TDocument>[];

  constructor(metadata: HistoryCommandMetadata, commands: readonly EditorCommand<TDocument>[]) {
    this.id = metadata.id;
    this.timestamp = metadata.timestamp;
    this.description = metadata.description;
    this.#commands = Object.freeze([...commands]);
    Object.freeze(this);
  }

  execute(document: TDocument): TDocument {
    return applyCommands(this.#commands, "execute", document);
  }

  undo(document: TDocument): TDocument {
    return applyCommands([...this.#commands].reverse(), "undo", document);
  }

  redo(document: TDocument): TDocument {
    return applyCommands(this.#commands, "redo", document);
  }
}

export function createTransactionHistoryEntry<TDocument>(
  transaction: ActiveHistoryTransaction<TDocument>,
): HistoryEntry<TDocument> {
  const group = new TransactionCommandGroup(
    transaction.metadata,
    transaction.entries.map(({ command }) => command),
  );
  return createHistoryEntry(group);
}

export function rollbackTransactionCommands<TDocument>(
  transaction: ActiveHistoryTransaction<TDocument>,
  document: TDocument,
): TDocument {
  const group = new TransactionCommandGroup(
    transaction.metadata,
    transaction.entries.map(({ command }) => command),
  );
  return group.undo(document);
}

function applyCommands<TDocument>(
  commands: readonly EditorCommand<TDocument>[],
  operation: "execute" | "redo" | "undo",
  document: TDocument,
): TDocument {
  let current = document;
  for (const command of commands) {
    const successor = command[operation](current);
    if (successor === current) {
      throw new Error(
        `Transaction child command '${command.id}' ${operation} must produce a distinct immutable successor.`,
      );
    }
    current = successor;
  }
  return current;
}
