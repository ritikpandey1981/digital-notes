import { InkObject, ObjectCollection, ObjectFactory } from "@folio/document";
import type { ObjectFactoryOptions } from "@folio/document";
import type { Stroke } from "@folio/ink";

export interface InkDocumentSessionSnapshot {
  readonly objectCount: number;
  readonly inkObjectCount: number;
  readonly allObjectsImmutable: boolean;
}

export class InkDocumentSession {
  private readonly factory: ObjectFactory;
  private collectionValue = ObjectCollection.empty();

  constructor(options: ObjectFactoryOptions = {}) {
    this.factory = new ObjectFactory(options);
  }

  get collection(): ObjectCollection {
    return this.collectionValue;
  }

  completeStroke(stroke: Stroke): InkObject {
    const object = this.factory.createInkObject({
      stroke,
      zIndex: this.collectionValue.size,
    });
    this.collectionValue = this.collectionValue.add(object);
    const stored = this.collectionValue.lookup(object.id);
    if (!(stored instanceof InkObject)) {
      throw new Error("The finalized stroke did not produce an InkObject.");
    }
    return stored;
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
