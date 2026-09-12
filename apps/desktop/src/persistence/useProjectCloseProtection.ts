import { useEffect } from "react";
import type { ProjectLifecycleCoordinator } from "./project-lifecycle-coordinator";

/**
 * Answers the close question the desktop window asks before it goes away.
 *
 * Main prevents the first close and waits, because resolving unsaved work is
 * asynchronous and the close event is not. Only a granted request answers yes;
 * a cancelled decision, a failed save, and an unconfirmed one all keep the
 * window open with the project untouched.
 */
export function useProjectCloseProtection(lifecycle: ProjectLifecycleCoordinator): void {
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.folio?.window;
    if (bridge === undefined) return;
    let released = false;
    const unsubscribe = bridge.onCloseRequest((requestId) => {
      void lifecycle.requestCloseProject().then((result) => {
        if (released) return;
        void bridge.respondToCloseRequest({
          requestId,
          allow: result.status === "proceeded",
        });
      });
    });
    return () => {
      released = true;
      unsubscribe();
    };
  }, [lifecycle]);
}
