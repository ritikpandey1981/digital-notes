import { InkObject, ObjectCollection, ObjectFactory } from "@folio/document";
import type { ObjectFactoryOptions } from "@folio/document";
import type { HistoryDocumentSession } from "@folio/history";
import type { Stroke } from "@folio/ink";

export interface InkDocumentSessionSnapshot {
  readonly objectCount: number;
  readonly inkObjectCount: number;
  readonly allObjectsImmutable: boolean;
}

export class InkDocumentSession implements HistoryDocumentSession<ObjectCollection> {
  private readonly factory: ObjectFactory;
  private collectionValue = ObjectCollection.empty();

  constructor(options: ObjectFactoryOptions = {}) {
    this.factory = new ObjectFactory(options);
  }

  get collection(): ObjectCollection {
    return this.collectionValue;
  }

  /** Returns the active immutable document at the generic History boundary. */
  getDocument(): ObjectCollection {
    return this.collectionValue;
  }

  /** Installs the exact immutable successor produced by an editor command. */
  replaceDocument(document: ObjectCollection): void {
    if (!(document instanceof ObjectCollection) || !Object.isFrozen(document)) {
      throw new TypeError("InkDocumentSession requires an immutable ObjectCollection successor.");
    }
    this.collectionValue = document;
  }

  /** Creates one immutable stroke object without installing it in the active document. */
  createStrokeObject(stroke: Stroke): InkObject {
    return this.factory.createInkObject({
      stroke,
      zIndex: this.collectionValue.size,
    });
  }

  completeStroke(stroke: Stroke): InkObject {
    const object = this.createStrokeObject(stroke);
    this.collectionValue = this.collectionValue.add(object);
    const stored = this.collectionValue.lookup(object.id);
    if (!(stored instanceof InkObject)) {
      throw new Error("The finalized stroke did not produce an InkObject.");
    }
    return stored;
  }

  /** Replaces one object with a same-identity immutable translated aggregate. */
  translateObject(objectId: string, delta: Readonly<{ x: number; y: number }>): InkObject | null {
    const object = this.collectionValue.lookup(objectId);
    if (!(object instanceof InkObject)) return null;
    const translated = this.factory.translateObject(object, delta);
    this.collectionValue = this.collectionValue.replace(translated);
    const stored = this.collectionValue.lookup(objectId);
    return stored instanceof InkObject ? stored : null;
  }

  snapshot(): InkDocumentSessionSnapshot {
    const objects = this.collectionValue.objects;
    return Object.freeze({
      objectCount: objects.length,
      inkObjectCount: this.collectionValue.statistics.inkObjectCount,
      allObjectsImmutable: objects.every(
        (object) =>
          Object.isFrozen(object) &&
          Object.isFrozen(object.metadata) &&
          Object.isFrozen(object.transform),
      ),
    });
  }

  clear(): void {
    this.collectionValue = ObjectCollection.empty();
  }
}
