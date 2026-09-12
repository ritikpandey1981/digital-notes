export type {
  Command,
  CommandCategory,
  CommandFactoryOptions,
  HistoryChangeTarget,
  HistoryContext,
} from "./command";
export type { LegacyHistoryDirtySink } from "./compatibility/legacy-history-dirty-sink";
export { createHistoryController } from "./editor-history/controller/history-controller";
export type { EditorCommand } from "./editor-history/interfaces/editor-command";
export type {
  DocumentContentStateId,
  HistoryDocumentSession,
} from "./editor-history/interfaces/history-document-session";
export type { IHistoryController } from "./editor-history/interfaces/history-controller";
export type { IHistoryManager } from "./editor-history/interfaces/history-manager";
export { createEditorHistoryManager } from "./editor-history/manager/editor-history-manager";
export type {
  HistoryCommandMetadata,
  HistoryOperation,
  HistoryOperationOutcome,
  HistoryTransactionOptions,
} from "./editor-history/model/history-metadata";
export type {
  HistoryFailureNotification,
  HistoryListener,
  HistoryNotification,
  HistorySuccessNotification,
} from "./editor-history/model/history-notification";
export type {
  EditorHistoryControllerOptions,
  EditorHistoryManagerOptions,
} from "./editor-history/model/history-options";
export type {
  CompletedHistoryExecutionState,
  ExecutingHistoryExecutionState,
  HistoryExecutionPhase,
  HistoryExecutionState,
  HistoryTransactionState,
  IdleHistoryExecutionState,
  IHistoryState,
  RedoingHistoryExecutionState,
  UndoingHistoryExecutionState,
} from "./editor-history/state/history-state";
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
