export type {
  Command,
  CommandCategory,
  CommandFactoryOptions,
  HistoryChangeTarget,
  HistoryContext,
} from "./command";
export {
  createRenameNotebookCommand,
  createUpdateNotebookMetadataCommand,
} from "./commands/notebook-commands";
export {
  createAddPageCommand,
  createDeletePageCommand,
  createDuplicatePageCommand,
  createReorderPagesCommand,
} from "./commands/page-commands";
export type { DuplicatePageCommand } from "./commands/page-commands";
export {
  createAddSectionCommand,
  createDeleteSectionCommand,
  createRenameSectionCommand,
  createReorderSectionsCommand,
} from "./commands/section-commands";
export { HistoryError, isHistoryError } from "./errors";
export type { HistoryErrorCode, HistoryErrorOptions } from "./errors";
export { HistoryManager } from "./history-manager";
export type { HistoryManagerOptions } from "./history-manager";
export type { HistorySnapshot, HistoryState, Transaction } from "./state";
