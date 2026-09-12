export type RuntimePreparationResult =
  Readonly<{ status: "ready" }> | Readonly<{ status: "failed"; error: Error }>;

type Cleanup = () => void;

/** Resources may be prepared locally; input and outward publication require ownership. */
export class RuntimeActivation {
  private phase: "preparing" | "ready" | "armed" | "active" | "disposed" = "preparing";
  private readonly installers = new Set<() => Cleanup>();
  private readonly installed = new Map<() => Cleanup, Cleanup>();
  private readonly publications = new Map<object, () => void>();
  private cleanup: Cleanup = () => undefined;
  private failure: Error | null = null;

  constructor(
    private readonly ownsRuntime: () => boolean,
    private readonly reportActiveError: (error: Error) => void,
  ) {}

  get active(): boolean {
    return this.phase === "active" && this.ownsRuntime();
  }

  get ready(): boolean {
    return this.phase === "ready" && this.failure === null;
  }

  finishPreparation(cleanup: Cleanup): RuntimePreparationResult {
    this.cleanup = cleanup;
    if (this.failure !== null) {
      const error = this.failure;
      this.dispose();
      return { status: "failed", error };
    }
    this.phase = "ready";
    return { status: "ready" };
  }

  report(error: Error): void {
    if (this.phase === "disposed") return;
    if (this.active) this.reportActiveError(error);
    else this.failure ??= error;
  }

  /** Coalesces candidate snapshots without exposing candidate controllers to the shell. */
  publish(key: object, publication: () => void, retain = true): void {
    if (this.phase === "disposed") return;
    if (retain) this.publications.set(key, publication);
    if (this.active) publication();
  }

  /** Registration is inert until arm(); unsubscribe is safe before or after activation. */
  onActive(install: () => Cleanup): Cleanup {
    if (this.phase === "disposed") return () => undefined;
    this.installers.add(install);
    if (this.phase === "active") this.installed.set(install, install());
    return () => {
      this.installers.delete(install);
      this.installed.get(install)?.();
      this.installed.delete(install);
    };
  }

  /** Fallible attachment happens while the previous runtime still owns input/publications. */
  arm(): RuntimePreparationResult {
    if (!this.ready) return { status: "failed", error: new Error("Runtime is not ready.") };
    try {
      for (const install of this.installers) this.installed.set(install, install());
      if (this.failure !== null) throw this.failure;
      this.phase = "armed";
      return { status: "ready" };
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Runtime activation failed.");
      this.dispose();
      return { status: "failed", error };
    }
  }

  /** No resource construction here. The host changes ownership before publishing. */
  commit(): RuntimePreparationResult {
    if (this.phase !== "armed") throw new Error("Runtime has not been armed.");
    this.phase = "active";
    return this.restorePublications();
  }

  /** Also restores A's last outward state if candidate publication rejects the handoff. */
  restorePublications(): RuntimePreparationResult {
    try {
      for (const publication of [...this.publications.values()]) publication();
      return { status: "ready" };
    } catch (cause) {
      return {
        status: "failed",
        error: cause instanceof Error ? cause : new Error("Runtime publication failed."),
      };
    }
  }

  /** A stale asynchronous callback cannot re-publish while teardown is in progress. */
  dispose(): void {
    if (this.phase === "disposed") return;
    this.phase = "disposed";
    this.publications.clear();
    const cleanups = [...this.installed.values()].reverse();
    this.installed.clear();
    this.installers.clear();
    for (const cleanup of [...cleanups, this.cleanup]) {
      try {
        cleanup();
      } catch (cause) {
        // Finish releasing all registrations even if one resource refuses cleanup.
        this.failure ??= cause instanceof Error ? cause : new Error("Runtime cleanup failed.");
      }
    }
    this.cleanup = () => undefined;
  }

  listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): Cleanup {
    const guarded: EventListener = (event) => {
      if (this.active) listener(event);
    };
    return this.onActive(() => {
      target.addEventListener(type, guarded, options);
      return () => target.removeEventListener(type, guarded, options);
    });
  }

  /** Adapts existing shortcut installers without changing their command algorithms. */
  eventTarget(target: EventTarget): Pick<EventTarget, "addEventListener" | "removeEventListener"> {
    const removers = new Map<EventListenerOrEventListenerObject, Cleanup>();
    return {
      addEventListener: (type, listener, options) => {
        if (listener === null) return;
        removers.set(
          listener,
          this.listen(
            target,
            type,
            (event) => {
              if (typeof listener === "function") listener(event);
              else listener.handleEvent(event);
            },
            options,
          ),
        );
      },
      removeEventListener: (_type, listener) => {
        if (listener === null) return;
        removers.get(listener)?.();
        removers.delete(listener);
      },
    };
  }
}

/** Keeps callback identity/latest-prop semantics while gating the effect's own lifetime. */
export function runtimeCallback<T extends unknown[]>(
  activation: RuntimeActivation,
  source: { current: ((...args: T) => void) | undefined },
  retain = true,
): { readonly current: (...args: T) => void } {
  return {
    current: (...args) => activation.publish(source, () => source.current?.(...args), retain),
  };
}
