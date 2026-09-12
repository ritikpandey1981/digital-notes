import type { ProjectSession } from "./project-session";
import type { RuntimeActivation, RuntimePreparationResult } from "./runtime-activation";

export interface ProjectRuntime {
  readonly project: ProjectSession;
  readonly id: number;
  activation: RuntimeActivation | null;
}

export type ProjectRuntimeReplacementResult =
  | Readonly<{ status: "activated"; runtime: ProjectRuntime }>
  | Readonly<{ status: "busy" }>
  | Readonly<{ status: "failed"; error: Error }>;

/** One active authority and at most one inert candidate. No document copies or platform I/O. */
export class ProjectRuntimeHost {
  private ordinal = 0;
  private activeValue: ProjectRuntime;
  private candidateValue: ProjectRuntime | null = null;
  private resolveReplacement: ((result: ProjectRuntimeReplacementResult) => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshotValue: readonly ProjectRuntime[];
  private connected = true;

  constructor(
    project: ProjectSession,
    private readonly canReplace: () => boolean = () => true,
  ) {
    this.activeValue = this.createRuntime(project);
    this.snapshotValue = Object.freeze([this.activeValue]);
  }

  get active(): ProjectRuntime {
    return this.activeValue;
  }

  get replacing(): boolean {
    return this.candidateValue !== null;
  }

  attach(runtime: ProjectRuntime, activation: RuntimeActivation): void {
    if (runtime !== this.activeValue && runtime !== this.candidateValue) {
      activation.dispose();
      return;
    }
    runtime.activation = activation;
  }

  readonly getSnapshot = (): readonly ProjectRuntime[] => this.snapshotValue;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** React effect replay can reconnect the same project owner without clearing artwork. */
  connect(): () => void {
    this.connected = true;
    return () => {
      this.connected = false;
      if (this.candidateValue !== null)
        this.finish({ status: "failed", error: new Error("Runtime host was unmounted.") });
    };
  }

  /** Internal lifecycle entry point; future File UI must add unsaved-change protection first. */
  replace(project: ProjectSession): Promise<ProjectRuntimeReplacementResult> {
    if (!this.connected)
      return Promise.resolve({ status: "failed", error: new Error("Runtime host is unmounted.") });
    if (this.candidateValue !== null || !this.canReplace())
      return Promise.resolve({ status: "busy" });
    if (project === this.activeValue.project)
      return Promise.resolve({ status: "failed", error: new Error("Project is already active.") });
    this.candidateValue = this.createRuntime(project);
    const result = new Promise<ProjectRuntimeReplacementResult>((resolve) => {
      this.resolveReplacement = resolve;
    });
    this.publish();
    return result;
  }

  prepared(runtime: ProjectRuntime, result: RuntimePreparationResult): void {
    if (runtime !== this.activeValue && runtime !== this.candidateValue) {
      runtime.activation?.dispose();
      return;
    }
    if (result.status === "failed") {
      if (runtime === this.candidateValue) this.finish(result);
      return;
    }
    const activation = runtime.activation;
    if (activation === null) return;
    const armed = activation.arm();
    if (armed.status === "failed") {
      if (runtime === this.candidateValue) this.finish(armed);
      return;
    }
    const previous = this.activeValue;
    // Single synchronous authority change. Old callbacks immediately lose permission.
    this.activeValue = runtime;
    const committed = activation.commit();
    if (committed.status === "failed") {
      this.activeValue = previous;
      previous.activation?.restorePublications();
      if (runtime === this.candidateValue) this.finish(committed);
      else activation.dispose();
      return;
    }
    if (previous !== runtime) previous.activation?.dispose();
    if (runtime === this.candidateValue) this.finish({ status: "activated", runtime });
  }

  private finish(result: ProjectRuntimeReplacementResult): void {
    if (result.status !== "activated") this.candidateValue?.activation?.dispose();
    this.candidateValue = null;
    const resolve = this.resolveReplacement;
    this.resolveReplacement = null;
    this.publish();
    resolve?.(result);
  }

  private createRuntime(project: ProjectSession): ProjectRuntime {
    return { id: ++this.ordinal, project, activation: null };
  }

  private publish(): void {
    this.snapshotValue = Object.freeze(
      this.candidateValue === null ? [this.activeValue] : [this.activeValue, this.candidateValue],
    );
    for (const listener of this.listeners) listener();
  }
}
