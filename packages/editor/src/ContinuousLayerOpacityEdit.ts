import type { Layer, PageDocument } from "@folio/document";
import type { DocumentContentStateId, IHistoryState } from "@folio/history";
import type { InkDocumentSession } from "./InkDocumentSession";

interface ContinuousLayerOpacityEditOptions {
  readonly documentSession: InkDocumentSession;
  readonly commit: (layerId: string, initialOpacity: number, finalOpacity: number) => IHistoryState;
  readonly onPreviewDocumentChange: (document: PageDocument) => void;
}

interface ActiveLayerOpacityEdit {
  readonly layerId: string;
  readonly initialOpacity: number;
  readonly previewStateId: DocumentContentStateId;
  currentOpacity: number;
}

/**
 * Package-private live-preview boundary for layer opacity.
 *
 * Previews replace the document outside History; committing emits at most one
 * command carrying the original and final opacity.
 */
export class ContinuousLayerOpacityEdit {
  readonly #documentSession: ContinuousLayerOpacityEditOptions["documentSession"];
  readonly #commit: ContinuousLayerOpacityEditOptions["commit"];
  readonly #onPreviewDocumentChange: ContinuousLayerOpacityEditOptions["onPreviewDocumentChange"];
  #active: ActiveLayerOpacityEdit | null = null;

  constructor(options: ContinuousLayerOpacityEditOptions) {
    this.#documentSession = options.documentSession;
    this.#commit = options.commit;
    this.#onPreviewDocumentChange = options.onPreviewDocumentChange;
  }

  get active(): boolean {
    return this.#active !== null;
  }

  get activeLayerId(): string | null {
    return this.#active?.layerId ?? null;
  }

  begin(layerId: string): boolean {
    if (this.#active?.layerId === layerId) return true;
    this.cancel();
    const layer = this.#currentLayer(layerId);
    if (layer === undefined) return false;
    this.#active = {
      layerId,
      initialOpacity: layer.opacity,
      previewStateId: this.#documentSession.contentStateId,
      currentOpacity: layer.opacity,
    };
    return true;
  }

  update(opacity: number): boolean {
    const active = this.#active;
    if (active === null) return false;
    const layer = this.#currentLayer(active.layerId);
    if (layer === undefined) {
      this.#active = null;
      return false;
    }
    if (!Number.isFinite(opacity)) return false;
    const clamped = Math.min(1, Math.max(0, opacity));
    if (clamped === active.currentOpacity) return false;
    this.#documentSession.replacePageDocument(
      this.#documentSession.page.updateLayer(active.layerId, { opacity: clamped }),
    );
    active.currentOpacity = clamped;
    this.#onPreviewDocumentChange(this.#documentSession.page);
    return true;
  }

  commit(): IHistoryState | null {
    const active = this.#takeActive();
    if (active === null) return null;
    this.#restore(active);
    if (active.currentOpacity === active.initialOpacity) return null;
    return this.#commit(active.layerId, active.initialOpacity, active.currentOpacity);
  }

  cancel(): boolean {
    const active = this.#takeActive();
    if (active === null) return false;
    this.#restore(active);
    return true;
  }

  #currentLayer(layerId: string): Layer | undefined {
    return this.#documentSession.page.layer(layerId);
  }

  #takeActive(): ActiveLayerOpacityEdit | null {
    const active = this.#active;
    this.#active = null;
    return active;
  }

  #restore(active: ActiveLayerOpacityEdit): void {
    const layer = this.#currentLayer(active.layerId);
    if (layer === undefined) return;
    if (layer.opacity !== active.initialOpacity) {
      this.#documentSession.replacePageDocument(
        this.#documentSession.page.updateLayer(active.layerId, { opacity: active.initialOpacity }),
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
