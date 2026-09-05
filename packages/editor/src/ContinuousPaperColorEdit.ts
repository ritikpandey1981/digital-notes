import type { IHistoryState } from "@folio/history";
import type { InkDocumentSession } from "./InkDocumentSession";

interface ContinuousPaperColorEditOptions {
  readonly documentSession: InkDocumentSession;
  readonly commit: (pageId: string, finalColor: string) => IHistoryState | null;
  readonly onPreviewDocumentChange: (pageId: string) => void;
}

interface ActivePaperColorEdit {
  readonly pageId: string;
  readonly initialColor: string;
  currentColor: string;
}

/**
 * Sole owner of the live paper-colour transaction.
 *
 * Preview successors stay outside History. Every exit takes the active record
 * before restoring or committing, so repeated blur/dismiss/unmount signals can
 * resolve an edit neither twice nor halfway.
 */
export class ContinuousPaperColorEdit {
  readonly #documentSession: ContinuousPaperColorEditOptions["documentSession"];
  readonly #commit: ContinuousPaperColorEditOptions["commit"];
  readonly #onPreviewDocumentChange: ContinuousPaperColorEditOptions["onPreviewDocumentChange"];
  #active: ActivePaperColorEdit | null = null;

  constructor(options: ContinuousPaperColorEditOptions) {
    this.#documentSession = options.documentSession;
    this.#commit = options.commit;
    this.#onPreviewDocumentChange = options.onPreviewDocumentChange;
  }

  get active(): boolean {
    return this.#active !== null;
  }

  get activePageId(): string | null {
    return this.#active?.pageId ?? null;
  }

  begin(pageId: string): boolean {
    if (this.#active?.pageId === pageId) return true;
    this.cancel();
    const page = this.#documentSession.sketchbook.page(pageId);
    if (page === undefined) return false;
    this.#active = {
      pageId,
      initialColor: page.paper.color,
      currentColor: page.paper.color,
    };
    return true;
  }

  update(color: string): boolean {
    const active = this.#active;
    if (active === null) return false;
    const page = this.#documentSession.sketchbook.page(active.pageId);
    if (page === undefined) {
      this.#active = null;
      return false;
    }
    const next = page.withPaper({ color });
    if (next === page) return false;
    this.#documentSession.replaceDocument(this.#documentSession.sketchbook.replacePage(next));
    active.currentColor = next.paper.color;
    this.#onPreviewDocumentChange(active.pageId);
    return true;
  }

  commit(): IHistoryState | null {
    const active = this.#takeActive();
    if (active === null) return null;
    this.#restore(active);
    if (active.currentColor === active.initialColor) return null;
    return this.#commit(active.pageId, active.currentColor);
  }

  cancel(): boolean {
    const active = this.#takeActive();
    if (active === null) return false;
    this.#restore(active);
    return true;
  }

  #takeActive(): ActivePaperColorEdit | null {
    const active = this.#active;
    this.#active = null;
    return active;
  }

  #restore(active: ActivePaperColorEdit): void {
    const page = this.#documentSession.sketchbook.page(active.pageId);
    if (page === undefined || page.paper.color === active.initialColor) return;
    const restored = page.withPaper({ color: active.initialColor });
    this.#documentSession.replaceDocument(this.#documentSession.sketchbook.replacePage(restored));
    this.#onPreviewDocumentChange(active.pageId);
  }
}
