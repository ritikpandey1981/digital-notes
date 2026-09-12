import { useCallback, useSyncExternalStore } from "react";
import type {
  ProjectPersistenceCoordinator,
  ProjectShellState,
} from "./project-persistence-coordinator";

/** What the shell shows before a project exists to describe. */
const EMPTY_SHELL_STATE: ProjectShellState = Object.freeze({
  title: "",
  isDirty: false,
  hasBackingFile: false,
  hasConfirmedCheckpoint: false,
  hasUnsavedRisk: false,
  isBusy: false,
});

/**
 * Follows the active project's state for display.
 *
 * The coordinator publishes a new value only when something actually changed,
 * so this re-renders on a real transition and never on a timer. There is no
 * copy of project state here: the hook holds no state of its own, and the
 * coordinator remains the only authority.
 */
export function useProjectShellState(
  coordinator: ProjectPersistenceCoordinator | null,
): ProjectShellState {
  const subscribe = useCallback(
    (onStoreChange: () => void) => coordinator?.subscribeState(onStoreChange) ?? (() => undefined),
    [coordinator],
  );
  const getSnapshot = useCallback(
    () => coordinator?.shellState ?? EMPTY_SHELL_STATE,
    [coordinator],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
