import type { ProjectRuntime, ProjectRuntimeHost } from "@folio/editor";

/**
 * Binds an offered action to the project that offered it.
 *
 * A notification outlives the thing it was about. "Layer deleted — Undo" can
 * still be on screen after the user opens another project, and the History it
 * was talking about is gone by then. The action therefore checks, at the moment
 * it is invoked, that the runtime it belongs to is still the one in front of
 * the user, and does nothing otherwise.
 *
 * This is ownership, not error handling: the notification provider learns
 * nothing about projects, and an action belonging to the live runtime is
 * unaffected by any of this.
 */
export function createRuntimeScopedAction(
  host: ProjectRuntimeHost,
  runtime: ProjectRuntime,
  action: () => void,
): () => void {
  return () => {
    if (host.active !== runtime) return;
    action();
  };
}
