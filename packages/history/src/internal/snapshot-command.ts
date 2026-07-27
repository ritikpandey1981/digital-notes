import type { Notebook } from "@folio/domain";
import type {
  Command,
  CommandCategory,
  CommandFactoryOptions,
  HistoryChangeTarget,
  HistoryContext,
} from "../command";
import { HistoryError } from "../errors";

export interface ResolvedCommandMetadata {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly context: HistoryContext;
}

export interface SnapshotCommandInput {
  readonly before: Notebook;
  readonly after: Notebook;
  readonly category: CommandCategory;
  readonly metadata: ResolvedCommandMetadata;
  readonly affectedTargets: readonly HistoryChangeTarget[];
}

const defaultContext: HistoryContext = {
  createId: () => globalThis.crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

export function resolveCommandMetadata(
  options: CommandFactoryOptions,
  defaultDescription: string,
): ResolvedCommandMetadata {
  const context: HistoryContext = {
    createId: options.context?.createId ?? defaultContext.createId,
    now: options.context?.now ?? defaultContext.now,
  };
  const id = options.id ?? context.createId();
  const timestamp = options.timestamp ?? context.now();
  const description = options.description ?? defaultDescription;
  assertNonBlank(id, "Command id");
  assertNonBlank(description, "Command description");
  if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp))) {
    throw new HistoryError("INVALID_COMMAND", "Command timestamp must be ISO-compatible.", {
      details: { timestamp },
    });
  }
  return Object.freeze({ id, timestamp, description, context });
}

export function createSnapshotCommand(input: SnapshotCommandInput): Command {
  const affectedTargets = Object.freeze(
    input.affectedTargets.map((target) => Object.freeze({ ...target })),
  );
  const command: Command = {
    id: input.metadata.id,
    timestamp: input.metadata.timestamp,
    description: input.metadata.description,
    category: input.category,
    affectedTargets,
    execute: (notebook) =>
      transition(notebook, input.before, input.after, input.metadata.id, "execute"),
    undo: (notebook) => transition(notebook, input.after, input.before, input.metadata.id, "undo"),
    redo: (notebook) => transition(notebook, input.before, input.after, input.metadata.id, "redo"),
  };
  return Object.freeze(command);
}

function transition(
  notebook: Notebook,
  expected: Notebook,
  result: Notebook,
  commandId: string,
  operation: "execute" | "redo" | "undo",
): Notebook {
  if (notebook !== expected) {
    throw new HistoryError(
      "COMMAND_STATE_MISMATCH",
      `Cannot ${operation} command '${commandId}' against a different notebook snapshot.`,
      { details: { commandId, operation } },
    );
  }
  return result;
}

function assertNonBlank(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HistoryError("INVALID_COMMAND", `${label} must not be blank.`);
  }
}
