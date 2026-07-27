import type { DomainId, JsonObject, Notebook } from "@folio/domain";

export interface PersistenceCompatibility {
  readonly metadata: JsonObject;
  readonly sections: Readonly<Record<DomainId, JsonObject>>;
  readonly pages: Readonly<Record<DomainId, JsonObject>>;
  readonly pageObjects: Readonly<Record<DomainId, JsonObject>>;
  readonly assets: Readonly<Record<DomainId, JsonObject>>;
}

export function createEmptyCompatibility(): PersistenceCompatibility {
  return Object.freeze({
    metadata: Object.freeze({}),
    sections: Object.freeze({}),
    pages: Object.freeze({}),
    pageObjects: Object.freeze({}),
    assets: Object.freeze({}),
  });
}

export type SerializedFileKind = "metadata" | "page" | "section";

export interface SerializedNotebookFile {
  readonly kind: SerializedFileKind;
  readonly id?: DomainId;
  readonly relativePath: string;
  readonly content: string;
}

export interface SerializedNotebook {
  readonly files: readonly SerializedNotebookFile[];
}

export interface NotebookDocumentSet {
  readonly metadata: JsonObject;
  readonly sections: Readonly<Record<DomainId, JsonObject>>;
  readonly pages: Readonly<Record<DomainId, JsonObject>>;
}

export interface LoadedNotebook {
  readonly notebook: Notebook;
  readonly compatibility: PersistenceCompatibility;
  readonly notebookPath: string;
}
