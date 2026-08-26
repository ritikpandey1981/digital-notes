import {
  EllipseObject,
  InkObject,
  LineObject,
  ObjectCollection,
  ObjectFactory,
  PageDocument,
  RectangleObject,
} from "@folio/document";
import type { ObjectFactoryOptions } from "@folio/document";
import type {
  EditableStyleInput,
  EllipseGeometry,
  LineGeometry,
  RectangleGeometry,
} from "@folio/document";
import type { HistoryDocumentSession } from "@folio/history";
import type { Stroke } from "@folio/ink";

export interface InkDocumentSessionSnapshot {
  readonly objectCount: number;
  readonly inkObjectCount: number;
  readonly allObjectsImmutable: boolean;
  readonly layerCount: number;
  readonly activeLayerId: string;
  readonly membershipConsistent: boolean;
}

/**
 * Owns the active immutable {@link PageDocument} and the editor-only active
 * layer selection.
 *
 * `activeLayerId` is editor state: it never enters History, and History only
 * ever observes the immutable page.
 */
export class InkDocumentSession implements HistoryDocumentSession<PageDocument> {
  private readonly factory: ObjectFactory;
  private documentValue = PageDocument.empty();
  private activeLayerIdValue = PageDocument.empty().bottomLayer.id;

  constructor(options: ObjectFactoryOptions = {}) {
    this.factory = new ObjectFactory(options);
  }

  get page(): PageDocument {
    return this.documentValue;
  }

  get collection(): ObjectCollection {
    return this.documentValue.objects;
  }

  /** Returns the editor-owned active layer, falling back to the bottom Layer. */
  get activeLayerId(): string {
    return this.documentValue.resolveActiveLayerId(this.activeLayerIdValue);
  }

  /** Selects the active layer. This never produces document History. */
  setActiveLayerId(layerId: string): boolean {
    if (this.documentValue.layer(layerId) === undefined) return false;
    if (this.activeLayerIdValue === layerId) return false;
    this.activeLayerIdValue = layerId;
    return true;
  }

  /** Returns the active immutable document at the generic History boundary. */
  getDocument(): PageDocument {
    return this.documentValue;
  }

  /** Installs the exact immutable successor produced by an editor command. */
  replaceDocument(document: PageDocument): void {
    if (!(document instanceof PageDocument) || !Object.isFrozen(document)) {
      throw new TypeError("InkDocumentSession requires an immutable PageDocument successor.");
    }
    this.documentValue = document;
    this.activeLayerIdValue = document.resolveActiveLayerId(this.activeLayerIdValue);
  }

  /** Returns the canonical flattened index at which new artwork enters. */
  activeInsertionIndex(): number {
    return this.documentValue.appendIndexFor(this.activeLayerId);
  }

  /** Creates one immutable stroke object without installing it in the active document. */
  createStrokeObject(stroke: Stroke): InkObject {
    return this.factory.createInkObject({ stroke, zIndex: this.activeInsertionIndex() });
  }

  createLineObject(geometry: LineGeometry, style: EditableStyleInput): LineObject {
    return this.factory.createLineObject({
      geometry,
      style,
      zIndex: this.activeInsertionIndex(),
    });
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
    this.documentValue = this.documentValue.add(object, this.activeLayerId);
    const stored = this.documentValue.lookup(object.id);
    if (!(stored instanceof InkObject)) {
      throw new Error("The finalized stroke did not produce an InkObject.");
    }
    return stored;
  }

  /** Replaces one object with a same-identity immutable translated aggregate. */
  translateObject(objectId: string, delta: Readonly<{ x: number; y: number }>): InkObject | null {
    const object = this.documentValue.lookup(objectId);
    if (!(object instanceof InkObject)) return null;
    const translated = this.factory.translateObject(object, delta);
    this.documentValue = this.documentValue.replace(translated);
    const stored = this.documentValue.lookup(objectId);
    return stored instanceof InkObject ? stored : null;
  }

  snapshot(): InkDocumentSessionSnapshot {
    const objects = this.documentValue.objects.objects;
    const membership = this.documentValue.layers.flatMap((layer) => layer.objectIds);
    return Object.freeze({
      objectCount: objects.length,
      inkObjectCount: this.documentValue.objects.statistics.inkObjectCount,
      allObjectsImmutable: objects.every(
        (object) =>
          Object.isFrozen(object) &&
          Object.isFrozen(object.metadata) &&
          Object.isFrozen(object.transform),
      ),
      layerCount: this.documentValue.layerCount,
      activeLayerId: this.activeLayerId,
      membershipConsistent:
        membership.length === objects.length &&
        membership.every((objectId, index) => objects[index]?.id === objectId),
    });
  }

  clear(): void {
    this.documentValue = PageDocument.empty();
    this.activeLayerIdValue = this.documentValue.bottomLayer.id;
  }
}
