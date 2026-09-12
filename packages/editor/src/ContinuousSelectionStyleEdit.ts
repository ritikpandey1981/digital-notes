import {
  createEditableStyle,
  InkObject,
  isVectorObject,
  ObjectFactory,
  type PageDocument,
  type PageObject,
  type VectorPageObject,
} from "@folio/document";
import type { DocumentContentStateId, IHistoryState } from "@folio/history";
import type { InkDocumentSession } from "./InkDocumentSession";
import { createVectorStyleReplacement } from "./history/update-vector-style-command";
import { applyInkStyle, inkStyleValues, type InkStylePatch } from "./InkStyleEdit";

/** Appearance patch applicable to Ink and vector objects alike. */
export interface SelectionStylePatch {
  readonly color?: string;
  readonly width?: number;
  readonly opacity?: number;
}

export interface SelectionStyleCommit {
  readonly inkEdits: readonly Readonly<{
    objectId: string;
    expectedObjectModifiedAt: string;
    initialStyle: InkStylePatch;
    finalStyle: InkStylePatch;
  }>[];
  readonly vectorEdits: readonly Readonly<{
    original: VectorPageObject;
    finalStyle: ReturnType<typeof createEditableStyle>;
  }>[];
}

interface ContinuousSelectionStyleEditOptions {
  readonly documentSession: InkDocumentSession;
  readonly commit: (edits: SelectionStyleCommit) => IHistoryState | null;
  readonly onPreviewDocumentChange: (document: PageDocument) => void;
  readonly isEditable: (object: PageObject) => boolean;
}

interface ActiveSelectionStyleEdit {
  readonly originals: readonly PageObject[];
  readonly previewStateId: DocumentContentStateId;
  current: SelectionStylePatch;
}

/**
 * Live-preview boundary for appearance edits across the whole selection.
 *
 * Previews replace the document outside History; committing emits one composite
 * History action for the entire gesture regardless of how many objects or how
 * many pointer samples were involved. Nothing here touches BrushPresets, active
 * tool state, or Shape creation defaults.
 */
export class ContinuousSelectionStyleEdit {
  readonly #documentSession: InkDocumentSession;
  readonly #commit: ContinuousSelectionStyleEditOptions["commit"];
  readonly #onPreviewDocumentChange: ContinuousSelectionStyleEditOptions["onPreviewDocumentChange"];
  readonly #isEditable: ContinuousSelectionStyleEditOptions["isEditable"];
  readonly #factory = new ObjectFactory();
  #active: ActiveSelectionStyleEdit | null = null;

  constructor(options: ContinuousSelectionStyleEditOptions) {
    this.#documentSession = options.documentSession;
    this.#commit = options.commit;
    this.#onPreviewDocumentChange = options.onPreviewDocumentChange;
    this.#isEditable = options.isEditable;
  }

  get active(): boolean {
    return this.#active !== null;
  }

  begin(objectIds: readonly string[]): boolean {
    this.cancel();
    const originals = objectIds
      .map((objectId) => this.#documentSession.page.lookup(objectId))
      .filter((object): object is PageObject => object !== undefined && this.#isEditable(object));
    if (originals.length === 0) return false;
    this.#active = {
      originals: Object.freeze(originals),
      previewStateId: this.#documentSession.contentStateId,
      current: {},
    };
    this.#documentSession.beginTransientEdit();
    return true;
  }

  update(patch: SelectionStylePatch): boolean {
    const active = this.#active;
    if (active === null) return false;
    const next = Object.freeze({ ...active.current, ...patch });
    if (samePatch(active.current, next)) return false;
    active.current = next;
    let page = this.#documentSession.page;
    let changed = false;
    for (const original of active.originals) {
      const replacement = this.#styled(original, next);
      if (replacement === null) continue;
      page = page.replace(replacement);
      changed = true;
    }
    if (!changed) return false;
    this.#documentSession.replacePageDocument(page);
    this.#onPreviewDocumentChange(this.#documentSession.page);
    return true;
  }

  commit(): IHistoryState | null {
    const active = this.#takeActive();
    if (active === null) return null;
    this.#restore(active);
    if (Object.keys(active.current).length === 0) return null;
    const inkEdits: SelectionStyleCommit["inkEdits"][number][] = [];
    const vectorEdits: SelectionStyleCommit["vectorEdits"][number][] = [];
    for (const original of active.originals) {
      const replacement = this.#styled(original, active.current);
      if (replacement === null) continue;
      if (original instanceof InkObject) {
        const initial = inkStyleValues(original);
        const final = inkStyleValues(replacement as InkObject);
        if (
          initial.color === final.color &&
          initial.width === final.width &&
          initial.opacity === final.opacity
        ) {
          continue;
        }
        inkEdits.push(
          Object.freeze({
            objectId: original.id,
            expectedObjectModifiedAt: original.modifiedAt,
            initialStyle: initial,
            finalStyle: final,
          }),
        );
      } else if (isVectorObject(original) && isVectorObject(replacement)) {
        if (sameVectorStyle(original, replacement)) continue;
        vectorEdits.push(Object.freeze({ original, finalStyle: replacement.style }));
      }
    }
    if (inkEdits.length === 0 && vectorEdits.length === 0) return null;
    return this.#commit(
      Object.freeze({ inkEdits: Object.freeze(inkEdits), vectorEdits: Object.freeze(vectorEdits) }),
    );
  }

  cancel(): boolean {
    const active = this.#takeActive();
    if (active === null) return false;
    this.#restore(active);
    return true;
  }

  #styled(original: PageObject, patch: SelectionStylePatch): PageObject | null {
    const current = this.#documentSession.page.lookup(original.id);
    if (current === undefined || !this.#isEditable(current)) return null;
    if (original instanceof InkObject) {
      return applyInkStyle(
        original,
        {
          ...(patch.color === undefined ? {} : { color: patch.color }),
          ...(patch.width === undefined ? {} : { width: patch.width }),
          ...(patch.opacity === undefined ? {} : { opacity: patch.opacity }),
        },
        this.#factory,
        original.modifiedAt,
      );
    }
    if (!isVectorObject(original)) return null;
    const style = createEditableStyle({
      strokeColor: Object.freeze({
        hex: patch.color ?? original.style.strokeColor.hex,
        opacity: patch.opacity ?? original.style.strokeColor.opacity,
      }),
      strokeWidth: patch.width ?? original.style.strokeWidth,
      ...(original.style.fillColor === undefined ? {} : { fillColor: original.style.fillColor }),
    });
    return createVectorStyleReplacement(original, style, original.modifiedAt);
  }

  #takeActive(): ActiveSelectionStyleEdit | null {
    const active = this.#active;
    this.#active = null;
    return active;
  }

  #restore(active: ActiveSelectionStyleEdit): void {
    try {
      let page = this.#documentSession.page;
      let changed = false;
      let missing = false;
      for (const original of active.originals) {
        const current = page.lookup(original.id);
        if (current === undefined) {
          missing = true;
          continue;
        }
        if (current === original) continue;
        page = page.replace(original);
        changed = true;
      }
      if (changed) {
        this.#documentSession.replacePageDocument(page);
        this.#onPreviewDocumentChange(this.#documentSession.page);
      }
      // Preview successors are not History, so returning the pre-gesture content
      // must also return the identity it had. Otherwise a cancelled gesture would
      // leave a saved project permanently dirty, and a committed one would record
      // a before-identity no Undo could reach. An object removed mid-gesture is a
      // real change this cannot undo, so identity then stays where it is.
      if (!missing) this.#documentSession.restoreContentStateId(active.previewStateId);
    } finally {
      // The gesture always ends here, on every exit, so the settled state is
      // announced exactly once whether it committed or was abandoned.
      this.#documentSession.endTransientEdit();
    }
  }
}

function samePatch(first: SelectionStylePatch, second: SelectionStylePatch): boolean {
  return (
    first.color === second.color && first.width === second.width && first.opacity === second.opacity
  );
}

function sameVectorStyle(first: VectorPageObject, second: VectorPageObject): boolean {
  return (
    first.style.strokeColor.hex === second.style.strokeColor.hex &&
    first.style.strokeColor.opacity === second.style.strokeColor.opacity &&
    first.style.strokeWidth === second.style.strokeWidth
  );
}
