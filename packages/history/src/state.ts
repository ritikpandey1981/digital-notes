import type { Notebook } from "@folio/domain";

export interface Transaction {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
  readonly commandCount: number;
}

export interface HistorySnapshot {
  readonly notebook: Notebook;
  readonly revision: number;
}

export interface HistoryState {
  readonly snapshot: HistorySnapshot;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly isDirty: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly historyLimit: number;
  readonly transaction: Transaction | null;
}
