import type { SketchbookDocument } from "@folio/document";

export const CURRENT_FOLIO_PROJECT_VERSION = 1;

/** Durable identity and presentation metadata belonging to one editable Folio project. */
export interface FolioProjectMetadata {
  readonly documentId: string;
  readonly title: string;
  readonly createdAt: string;
}

/** Project content only. Backing-store and editor-session state live outside this aggregate. */
export interface FolioProjectSnapshot {
  readonly metadata: FolioProjectMetadata;
  readonly sketchbook: SketchbookDocument;
}

export interface CreateEmptyFolioProjectOptions {
  readonly documentId?: string;
  readonly title?: string;
  readonly createdAt?: string;
  readonly pageId?: string;
  readonly createDocumentId?: () => string;
  readonly now?: () => string;
}
