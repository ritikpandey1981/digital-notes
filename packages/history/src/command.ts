import type { Notebook } from "@folio/domain";

export type CommandCategory = "notebook" | "page" | "section" | "transaction";

export type HistoryChangeTarget =
  | Readonly<{ kind: "metadata" }>
  | Readonly<{ kind: "section"; sectionId: string }>
  | Readonly<{ kind: "page"; pageId: string; sectionId: string }>;

export interface Command {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly category: CommandCategory;
  readonly affectedTargets: readonly HistoryChangeTarget[];
  readonly execute: (notebook: Notebook) => Notebook;
  readonly undo: (notebook: Notebook) => Notebook;
  readonly redo: (notebook: Notebook) => Notebook;
}

export interface HistoryContext {
  readonly createId: () => string;
  readonly now: () => string;
}

export interface CommandFactoryOptions {
  readonly id?: string;
  readonly timestamp?: string;
  readonly description?: string;
  readonly context?: Partial<HistoryContext>;
}
