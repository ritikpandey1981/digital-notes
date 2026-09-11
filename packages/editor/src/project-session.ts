import type { FolioProjectMetadata, FolioProjectSnapshot } from "@folio/persistence/project";
import { InkDocumentSession } from "./InkDocumentSession";

/**
 * One project's lifetime, independent of its drawing surface and platform host.
 * The document lives only in documentSession; captures retain immutable roots.
 * This owner holds no subscriptions or external resources. Its host releases it
 * on unmount rather than clearing artwork during React effect cleanup/replay.
 */
export class ProjectSession {
  readonly metadata: FolioProjectMetadata;
  readonly documentSession: InkDocumentSession;

  constructor(initialProject: FolioProjectSnapshot) {
    this.metadata = Object.freeze({ ...initialProject.metadata });
    this.documentSession = new InkDocumentSession({ initialDocument: initialProject.sketchbook });
    Object.freeze(this);
  }

  /** Captures the current root without copying artwork or retaining a second store. */
  captureSnapshot(): FolioProjectSnapshot {
    return Object.freeze({
      metadata: this.metadata,
      sketchbook: this.documentSession.getDocument(),
    });
  }
}
