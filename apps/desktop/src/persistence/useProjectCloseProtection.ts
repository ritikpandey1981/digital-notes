import { useEffect } from "react";
import type { ProjectLifecycleCoordinator } from "./project-lifecycle-coordinator";
import type { RecoveryAutosaveCoordinator } from "./recovery-autosave-coordinator";

/**
 * Answers the close question the desktop window asks before it goes away.
 *
 * Main prevents the first close and waits, because resolving unsaved work is
 * asynchronous and the close event is not. Only a granted request answers yes;
 * a cancelled decision, a failed save, and an unconfirmed one all keep the
 * window open with the project untouched.
 */
export function useProjectCloseProtection(
  lifecycle: ProjectLifecycleCoordinator,
  recovery: RecoveryAutosaveCoordinator,
): void {
  useEffect(() => {
    const bridge = typeof window === "undefined" ? undefined : window.folio?.window;
    if (bridge === undefined) return;
    let released = false;
    const unsubscribe = bridge.onCloseRequest((requestId) => {
      void lifecycle.requestCloseProject().then(async (result) => {
        if (released) return;
        // An approved close is the one moment the project is deliberately put
        // away, so its crash snapshot stops being a recovery candidate. A
        // snapshot that refuses to go is stale, not lost work, and must never
        // hold the window open.
        if (result.status === "proceeded")
          await recovery.discardActiveRecovery().catch(() => undefined);
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
  }, [lifecycle, recovery]);
}
