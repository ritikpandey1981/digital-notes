import {
  createEditableStyle,
  isVectorObject,
  type EditableStyle,
  type EditableStyleInput,
  type ObjectCollection,
  type VectorPageObject,
} from "@folio/document";
import type { IHistoryState } from "@folio/history";
import type { InkDocumentSession } from "./InkDocumentSession";
import { createVectorStyleReplacement } from "./history/update-vector-style-command";

interface ContinuousVectorStyleEditOptions {
  readonly documentSession: InkDocumentSession;
  readonly commit: (original: VectorPageObject, finalStyle: EditableStyle) => IHistoryState;
  readonly onPreviewDocumentChange: (document: ObjectCollection) => void;
}

interface ActiveVectorStyleEdit {
  readonly original: VectorPageObject;
  current: VectorPageObject;
}

/** Package-private live-preview boundary that emits at most one final History command. */
export class ContinuousVectorStyleEdit {
  readonly #documentSession: InkDocumentSession;
  readonly #commit: ContinuousVectorStyleEditOptions["commit"];
  readonly #onPreviewDocumentChange: ContinuousVectorStyleEditOptions["onPreviewDocumentChange"];
  #active: ActiveVectorStyleEdit | null = null;

  constructor(options: ContinuousVectorStyleEditOptions) {
    this.#documentSession = options.documentSession;
    this.#commit = options.commit;
    this.#onPreviewDocumentChange = options.onPreviewDocumentChange;
  }

  get active(): boolean {
    return this.#active !== null;
  }

  begin(object: VectorPageObject): boolean {
    if (this.#active?.original.id === object.id) return true;
    this.cancel();
    const current = this.#documentSession.collection.lookup(object.id);
    if (!isVectorObject(current) || !current.visible || current.locked) return false;
    this.#active = { original: current, current };
    return true;
  }

  update(style: EditableStyleInput): boolean {
    const active = this.#active;
    if (active === null) return false;
    const current = this.#documentSession.collection.lookup(active.original.id);
    if (!isVectorObject(current) || !current.visible || current.locked) {
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
    this.#documentSession.replaceDocument(this.#documentSession.collection.replace(replacement));
    active.current = replacement;
    this.#onPreviewDocumentChange(this.#documentSession.collection);
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
    const current = this.#documentSession.collection.lookup(active.original.id);
    if (!isVectorObject(current)) return;
    if (current === active.original) return;
    this.#documentSession.replaceDocument(
      this.#documentSession.collection.replace(active.original),
    );
    this.#onPreviewDocumentChange(this.#documentSession.collection);
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
