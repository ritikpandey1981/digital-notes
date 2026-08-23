export interface WorkspaceHistoryActions {
  readonly undo: () => void;
  readonly redo: () => void;
}

export interface WorkspaceHistoryAvailability {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export const EMPTY_WORKSPACE_HISTORY: WorkspaceHistoryAvailability = Object.freeze({
  canUndo: false,
  canRedo: false,
});
