import {
  createPageLike,
  duplicatePage,
  EllipseObject,
  InkObject,
  LineObject,
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  RectangleObject,
  SketchbookDocument,
  type PageGeometry,
  type PagePaper,
} from "@folio/document";
import type { ObjectFactoryOptions } from "@folio/document";
import type {
  EditableStyleInput,
  EllipseGeometry,
  LineGeometry,
  RectangleGeometry,
} from "@folio/document";
import type { DocumentContentStateId, HistoryDocumentSession } from "@folio/history";
import type { Stroke } from "@folio/ink";

export interface InkDocumentSessionSnapshot {
  readonly objectCount: number;
  readonly inkObjectCount: number;
  readonly allObjectsImmutable: boolean;
  readonly layerCount: number;
  readonly activeLayerId: string;
  readonly membershipConsistent: boolean;
  readonly pageCount: number;
  readonly activePageId: string;
}

/** Editor-only per-page camera memory. Never document state, never History. */
export interface PageViewportMemory {
  readonly zoom: number;
  readonly position: Readonly<{ x: number; y: number }>;
  readonly mode: string;
}

export interface InkDocumentSessionOptions extends ObjectFactoryOptions {
  readonly initialDocument?: SketchbookDocument;
  readonly createPageId?: () => string;
  readonly createLayerId?: () => string;
  /**
   * Reports that this session settled on a different content state.
   *
   * It fires once per settled identity, never during a live preview gesture and
   * never for session-only state, so a listener can treat every notification as
   * a committed state worth acting on.
   */
  readonly onContentStateChange?: () => void;
}

let documentSessionOrdinal = 0;

/**
 * Mints process-unique content identities for one session.
 *
 * A per-session prefix keeps two projects' identities disjoint, so a replaced
 * runtime can never mistake the incoming project's content for the outgoing
 * project's save checkpoint.
 */
function createContentStateIdFactory(): () => DocumentContentStateId {
  const session = (documentSessionOrdinal += 1);
  let version = 0;
  return () => `content-${session}-${(version += 1)}` as DocumentContentStateId;
}

function defaultIdFactory(prefix: string): () => string {
  let ordinal = 0;
  return () => {
    ordinal += 1;
    const random =
      globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${ordinal.toString(36)}`;
    return `${prefix}-${random}`;
  };
}

/**
 * Owns the active immutable {@link SketchbookDocument} plus the editor-only
 * session state that must not enter History.
 *
 * Session state is deliberately keyed by page identity: the active page, and
 * each page's own active Layer and camera. None of it is document state, so
 * switching pages produces zero History.
 */
export class InkDocumentSession implements HistoryDocumentSession<SketchbookDocument> {
  private readonly factory: ObjectFactory;
  private readonly createContentStateIdValue = createContentStateIdFactory();
  private contentStateIdValue: DocumentContentStateId;
  private publishedStateIdValue: DocumentContentStateId;
  private readonly onContentStateChangeValue: (() => void) | undefined;
  /** Depth of open live-preview gestures, whose intermediate content is not a state. */
  private transientEditDepth = 0;
  private readonly createPageIdValue: () => string;
  private readonly createLayerIdValue: () => string;
  private pendingCommitDepth = 0;
  private readonly settledWaiters: (() => void)[] = [];
  private readonly createObjectIdValue: () => string;
  private documentValue: SketchbookDocument;
  private activePageIdValue: string;
  private readonly activeLayerByPage = new Map<string, string>();
  private readonly viewportByPage = new Map<string, PageViewportMemory>();

  constructor(options: InkDocumentSessionOptions = {}) {
    this.factory = new ObjectFactory(options);
    this.createPageIdValue = options.createPageId ?? defaultIdFactory("page");
    this.createLayerIdValue = options.createLayerId ?? defaultIdFactory("layer");
    this.createObjectIdValue = options.createId ?? defaultIdFactory("object");
    const initialDocument = options.initialDocument ?? SketchbookDocument.empty();
    if (!(initialDocument instanceof SketchbookDocument) || !Object.isFrozen(initialDocument)) {
      throw new TypeError("InkDocumentSession requires an immutable initial SketchbookDocument.");
    }
    this.documentValue = initialDocument;
    this.contentStateIdValue = this.createContentStateIdValue();
    this.publishedStateIdValue = this.contentStateIdValue;
    this.onContentStateChangeValue = options.onContentStateChange;
    this.activePageIdValue = this.documentValue.firstPage.id;
  }

  get sketchbook(): SketchbookDocument {
    return this.documentValue;
  }

  get activePage(): Page {
    return this.documentValue.requirePage(this.activePageId);
  }

  get activePageId(): string {
    return this.documentValue.resolveActivePageId(this.activePageIdValue);
  }

  /** The active page's immutable Layer/artwork document. */
  get page(): PageDocument {
    return this.activePage.content;
  }

  get collection(): ObjectCollection {
    return this.page.objects;
  }

  get geometry(): PageGeometry {
    return this.activePage.geometry;
  }

  get paper(): PagePaper {
    return this.activePage.paper;
  }

  /** Selects the active page. This never produces document History. */
  setActivePageId(pageId: string): boolean {
    if (this.documentValue.page(pageId) === undefined) return false;
    if (this.activePageIdValue === pageId) return false;
    this.activePageIdValue = pageId;
    return true;
  }

  /** Returns the editor-owned active layer for the active page. */
  get activeLayerId(): string {
    return this.page.resolveActiveLayerId(this.activeLayerByPage.get(this.activePageId));
  }

  /** Selects the active layer for the active page. Never produces History. */
  setActiveLayerId(layerId: string): boolean {
    if (this.page.layer(layerId) === undefined) return false;
    if (this.activeLayerId === layerId) return false;
    this.activeLayerByPage.set(this.activePageId, layerId);
    return true;
  }

  /** Reads one page's remembered camera, or null when it has never been set. */
  viewportMemory(pageId: string): PageViewportMemory | null {
    return this.viewportByPage.get(pageId) ?? null;
  }

  rememberViewport(pageId: string, memory: PageViewportMemory): void {
    if (this.documentValue.page(pageId) === undefined) return;
    this.viewportByPage.set(pageId, Object.freeze({ ...memory }));
  }

  /** Returns the active immutable document at the generic History boundary. */
  getDocument(): SketchbookDocument {
    return this.documentValue;
  }

  /**
   * Runtime-only identity of the content this session currently holds.
   *
   * Persistence compares it against a save checkpoint. It is never serialized
   * and never derived from History depth, so undoing back to saved content is
   * recognised as that same content.
   */
  get contentStateId(): DocumentContentStateId {
    return this.contentStateIdValue;
  }

  /** Reads content identity at the generic History boundary. */
  getContentStateId(): DocumentContentStateId {
    return this.contentStateIdValue;
  }

  /** Reinstalls an identity minted earlier, after History revisits existing content. */
  restoreContentStateId(stateId: DocumentContentStateId): void {
    if (typeof stateId !== "string" || stateId.length === 0) {
      throw new TypeError("InkDocumentSession requires a previously minted content identity.");
    }
    this.contentStateIdValue = stateId;
    this.publishContentState();
  }

  /**
   * Opens a live-preview gesture.
   *
   * A gesture writes successor documents the user has not committed to, so the
   * states it passes through are not states anything should persist. They are
   * announced as one settled state when the gesture resolves, which for a
   * cancelled gesture is the state it started from.
   */
  beginTransientEdit(): void {
    this.transientEditDepth += 1;
  }

  endTransientEdit(): void {
    if (this.transientEditDepth === 0) return;
    this.transientEditDepth -= 1;
    this.publishContentState();
    this.releaseSettledWaiters();
  }

  /** True while a live-preview gesture is holding uncommitted content. */
  get hasTransientEdit(): boolean {
    return this.transientEditDepth > 0;
  }

  /**
   * Announces a History transaction whose successors are not yet decided.
   *
   * Called by History itself, never by editor code. It is the other half of the
   * same question a preview gesture answers: the document currently shows
   * something the user has not agreed to keep.
   */
  beginPendingCommit(): void {
    this.pendingCommitDepth += 1;
  }

  endPendingCommit(): void {
    if (this.pendingCommitDepth === 0) return;
    this.pendingCommitDepth -= 1;
    this.publishContentState();
    this.releaseSettledWaiters();
  }

  /**
   * True when the document holds a state the user has actually committed to.
   *
   * This is the single question persistence asks. An unsettled document is one
   * mid-gesture or mid-transaction, and the state it is showing may be taken
   * back the moment the user lets go.
   */
  get isSettled(): boolean {
    return this.transientEditDepth === 0 && this.pendingCommitDepth === 0;
  }

  /** Resolves as soon as the document is settled, immediately if it already is. */
  whenSettled(): Promise<void> {
    if (this.isSettled) return Promise.resolve();
    return new Promise<void>((resolve) => this.settledWaiters.push(resolve));
  }

  private releaseSettledWaiters(): void {
    if (!this.isSettled || this.settledWaiters.length === 0) return;
    for (const resolve of this.settledWaiters.splice(0)) resolve();
  }

  private publishContentState(): void {
    if (!this.isSettled) return;
    if (this.contentStateIdValue === this.publishedStateIdValue) return;
    this.publishedStateIdValue = this.contentStateIdValue;
    this.onContentStateChangeValue?.();
  }

  /** Installs the exact immutable successor produced by an editor command. */
  replaceDocument(document: SketchbookDocument): void {
    if (!(document instanceof SketchbookDocument) || !Object.isFrozen(document)) {
      throw new TypeError("InkDocumentSession requires an immutable SketchbookDocument successor.");
    }
    // Session state changes alone must never advance content identity, so only
    // an actual document replacement mints one.
    if (document !== this.documentValue)
      this.contentStateIdValue = this.createContentStateIdValue();
    this.documentValue = document;
    this.activePageIdValue = document.resolveActivePageId(this.activePageIdValue);
    for (const pageId of [...this.activeLayerByPage.keys()]) {
      if (document.page(pageId) === undefined) this.activeLayerByPage.delete(pageId);
    }
    for (const pageId of [...this.viewportByPage.keys()]) {
      if (document.page(pageId) === undefined) this.viewportByPage.delete(pageId);
    }
    this.publishContentState();
  }

  /** Replaces only the active page's artwork document. */
  replacePageDocument(content: PageDocument): void {
    this.replaceDocument(this.documentValue.replacePage(this.activePage.withContent(content)));
  }

  /** Creates an empty blank page inheriting only the active page's physical geometry. */
  createInheritedPage(): Page {
    return createPageLike(this.activePage, {
      createPageId: this.createPageIdValue,
      createLayerId: this.createLayerIdValue,
    });
  }

  /** Clones one page with entirely fresh page, layer, and object identities. */
  duplicatePageById(pageId: string): Page {
    return duplicatePage(this.documentValue.requirePage(pageId), {
      createPageId: this.createPageIdValue,
      createLayerId: this.createLayerIdValue,
      createObjectId: this.createObjectIdValue,
    });
  }

  /** Returns the canonical flattened index at which new artwork enters. */
  activeInsertionIndex(): number {
    return this.page.appendIndexFor(this.activeLayerId);
  }

  createStrokeObject(stroke: Stroke): InkObject {
    return this.factory.createInkObject({ stroke, zIndex: this.activeInsertionIndex() });
  }

  createLineObject(geometry: LineGeometry, style: EditableStyleInput): LineObject {
    return this.factory.createLineObject({ geometry, style, zIndex: this.activeInsertionIndex() });
  }

  createRectangleObject(geometry: RectangleGeometry, style: EditableStyleInput): RectangleObject {
    return this.factory.createRectangleObject({
      geometry,
      style,
      zIndex: this.activeInsertionIndex(),
    });
  }

  createEllipseObject(geometry: EllipseGeometry, style: EditableStyleInput): EllipseObject {
    return this.factory.createEllipseObject({
      geometry,
      style,
      zIndex: this.activeInsertionIndex(),
    });
  }

  completeStroke(stroke: Stroke): InkObject {
    const object = this.createStrokeObject(stroke);
    this.replacePageDocument(this.page.add(object, this.activeLayerId));
    const stored = this.page.lookup(object.id);
    if (!(stored instanceof InkObject)) {
      throw new Error("The finalized stroke did not produce an InkObject.");
    }
    return stored;
  }

  /** Replaces one object with a same-identity immutable translated aggregate. */
  translateObject(objectId: string, delta: Readonly<{ x: number; y: number }>): InkObject | null {
    const object = this.page.lookup(objectId);
    if (!(object instanceof InkObject)) return null;
    this.replacePageDocument(this.page.replace(this.factory.translateObject(object, delta)));
    const stored = this.page.lookup(objectId);
    return stored instanceof InkObject ? stored : null;
  }

  snapshot(): InkDocumentSessionSnapshot {
    const page = this.page;
    const objects = page.objects.objects;
    const membership = page.layers.flatMap((layer) => layer.objectIds);
    return Object.freeze({
      objectCount: objects.length,
      inkObjectCount: page.objects.statistics.inkObjectCount,
      allObjectsImmutable: objects.every(
        (object) =>
          Object.isFrozen(object) &&
          Object.isFrozen(object.metadata) &&
          Object.isFrozen(object.transform),
      ),
      layerCount: page.layerCount,
      activeLayerId: this.activeLayerId,
      membershipConsistent:
        membership.length === objects.length &&
        membership.every((objectId, index) => objects[index]?.id === objectId),
      pageCount: this.documentValue.pageCount,
      activePageId: this.activePageId,
    });
  }

  clear(): void {
    this.contentStateIdValue = this.createContentStateIdValue();
    this.publishedStateIdValue = this.contentStateIdValue;
    this.documentValue = SketchbookDocument.empty();
    this.activePageIdValue = this.documentValue.firstPage.id;
    this.activeLayerByPage.clear();
    this.viewportByPage.clear();
  }
}
