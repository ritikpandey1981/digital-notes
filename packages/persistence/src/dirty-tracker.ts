import type { Notebook } from "@folio/domain";

export type DirtyStatus = "dirty" | "saved" | "saving";

export type DirtyTarget =
  | Readonly<{ kind: "metadata" }>
  | Readonly<{ kind: "page"; id: string }>
  | Readonly<{ kind: "section"; id: string }>;

export interface DirtySnapshotEntry {
  readonly target: DirtyTarget;
  readonly revision: number;
}

export interface DirtySnapshot {
  readonly revision: number;
  readonly entries: readonly DirtySnapshotEntry[];
}

interface TrackedEntry {
  readonly target: DirtyTarget;
  readonly revision: number;
}

export class DirtyTracker {
  #entries = new Map<string, TrackedEntry>();
  #revision = 0;
  #saving = false;

  get status(): DirtyStatus {
    if (this.#saving) return "saving";
    return this.#entries.size > 0 ? "dirty" : "saved";
  }

  get revision(): number {
    return this.#revision;
  }

  get isDirty(): boolean {
    return this.#entries.size > 0;
  }

  markMetadata(): void {
    this.#mark({ kind: "metadata" });
  }

  markSection(sectionId: string): void {
    this.#mark({ kind: "section", id: sectionId });
    this.#mark({ kind: "metadata" });
  }

  markPage(pageId: string, sectionId?: string): void {
    this.#mark({ kind: "page", id: pageId });
    if (sectionId) this.#mark({ kind: "section", id: sectionId });
    this.#mark({ kind: "metadata" });
  }

  markAll(notebook: Notebook): void {
    this.markMetadata();
    notebook.sections.forEach((section) => {
      this.markSection(section.id);
      section.pages.forEach((page) => this.markPage(page.id));
    });
  }

  snapshot(): DirtySnapshot {
    return Object.freeze({
      revision: this.#revision,
      entries: Object.freeze(
        [...this.#entries.values()].map(({ target, revision }) =>
          Object.freeze({ target, revision }),
        ),
      ),
    });
  }

  beginSave(): DirtySnapshot {
    const snapshot = this.snapshot();
    this.#saving = true;
    return snapshot;
  }

  completeSave(snapshot: DirtySnapshot): void {
    snapshot.entries.forEach(({ target, revision }) => {
      const key = targetKey(target);
      if (this.#entries.get(key)?.revision === revision) this.#entries.delete(key);
    });
    this.#saving = false;
  }

  failSave(): void {
    this.#saving = false;
  }

  clear(): void {
    this.#entries.clear();
    this.#saving = false;
  }

  #mark(target: DirtyTarget): void {
    this.#revision += 1;
    this.#entries.set(targetKey(target), {
      target: Object.freeze({ ...target }),
      revision: this.#revision,
    });
  }
}

export function createDirtyTracker(): DirtyTracker {
  return new DirtyTracker();
}

export function dirtyTargetKey(target: DirtyTarget): string {
  return targetKey(target);
}

function targetKey(target: DirtyTarget): string {
  return target.kind === "metadata" ? "metadata" : `${target.kind}:${target.id}`;
}
