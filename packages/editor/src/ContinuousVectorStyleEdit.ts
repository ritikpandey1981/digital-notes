import {
  createEditableStyle,
  isVectorObject,
  type EditableStyle,
  type EditableStyleInput,
  type PageDocument,
  type VectorPageObject,
} from "@folio/document";
import type { DocumentContentStateId, IHistoryState } from "@folio/history";
import type { InkDocumentSession } from "./InkDocumentSession";
import { createVectorStyleReplacement } from "./history/update-vector-style-command";

interface ContinuousVectorStyleEditOptions {
  readonly documentSession: InkDocumentSession;
  readonly commit: (original: VectorPageObject, finalStyle: EditableStyle) => IHistoryState;
  readonly onPreviewDocumentChange: (document: PageDocument) => void;
  /** Effective editability, so Layer lock is resolved in one place. */
  readonly isEditable: (object: VectorPageObject) => boolean;
}

interface ActiveVectorStyleEdit {
  readonly original: VectorPageObject;
  readonly previewStateId: DocumentContentStateId;
  current: VectorPageObject;
}

/** Package-private live-preview boundary that emits at most one final History command. */
export class ContinuousVectorStyleEdit {
  readonly #documentSession: InkDocumentSession;
  readonly #commit: ContinuousVectorStyleEditOptions["commit"];
  readonly #onPreviewDocumentChange: ContinuousVectorStyleEditOptions["onPreviewDocumentChange"];
  readonly #isEditable: ContinuousVectorStyleEditOptions["isEditable"];
  #active: ActiveVectorStyleEdit | null = null;

  constructor(options: ContinuousVectorStyleEditOptions) {
    this.#documentSession = options.documentSession;
    this.#commit = options.commit;
    this.#onPreviewDocumentChange = options.onPreviewDocumentChange;
    this.#isEditable = options.isEditable;
  }

  get active(): boolean {
    return this.#active !== null;
  }

  begin(object: VectorPageObject): boolean {
    if (this.#active?.original.id === object.id) return true;
    this.cancel();
    const current = this.#documentSession.page.lookup(object.id);
    if (!isVectorObject(current) || !this.#isEditable(current)) return false;
    this.#active = {
      original: current,
      previewStateId: this.#documentSession.contentStateId,
      current,
    };
    return true;
  }

  update(style: EditableStyleInput): boolean {
    const active = this.#active;
    if (active === null) return false;
    const current = this.#documentSession.page.lookup(active.original.id);
    if (!isVectorObject(current) || !this.#isEditable(current)) {
      this.#active = null;
      return false;
    }
    const resolvedStyle = createEditableStyle(style);
    if (sameStyle(active.current.style, resolvedStyle)) return false;
    const replacement = createVectorStyleReplacement(
      current,
      resolvedStyle,
      active.original.modifiedAt,
    );
    this.#documentSession.replacePageDocument(this.#documentSession.page.replace(replacement));
    active.current = replacement;
    this.#onPreviewDocumentChange(this.#documentSession.page);
    return true;
  }

  commit(): IHistoryState | null {
    const active = this.#takeActive();
    if (active === null) return null;
    const finalStyle = active.current.style;
    if (sameStyle(active.original.style, finalStyle)) {
      this.#restore(active);
      return null;
    }
    this.#restore(active);
    return this.#commit(active.original, finalStyle);
  }

  cancel(): boolean {
    const active = this.#takeActive();
    if (active === null) return false;
    this.#restore(active);
    return true;
  }

  #takeActive(): ActiveVectorStyleEdit | null {
    const active = this.#active;
    this.#active = null;
    return active;
  }

  #restore(active: ActiveVectorStyleEdit): void {
    const current = this.#documentSession.page.lookup(active.original.id);
    if (!isVectorObject(current)) return;
    if (current !== active.original) {
      this.#documentSession.replacePageDocument(
        this.#documentSession.page.replace(active.original),
      );
      this.#onPreviewDocumentChange(this.#documentSession.page);
    }
    // Preview successors are not History, so returning the pre-gesture content
    // must also return the identity it had. Otherwise a cancelled gesture would
    // leave a saved project permanently dirty, and a committed one would record
    // a before-identity no Undo could reach.
    this.#documentSession.restoreContentStateId(active.previewStateId);
  }
}

function sameStyle(first: EditableStyle, second: EditableStyle): boolean {
  return (
    first.strokeColor.hex === second.strokeColor.hex &&
    first.strokeColor.opacity === second.strokeColor.opacity &&
    first.strokeWidth === second.strokeWidth &&
    first.fillColor?.hex === second.fillColor?.hex &&
    first.fillColor?.opacity === second.fillColor?.opacity
  );
}
