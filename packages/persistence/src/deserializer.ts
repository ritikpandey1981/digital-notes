import {
  DomainValidationError,
  assertValidAsset,
  assertValidPageObject,
  createAsset,
  createNotebook,
  createPage,
  createPageObject,
  createSection,
} from "@folio/domain";
import type {
  Asset,
  AssetKind,
  JsonObject,
  NotebookCover,
  NotebookSettings,
  Page,
  PageBackground,
  PageObject,
  PageObjectCapabilities,
  PageObjectType,
  Position,
} from "@folio/domain";
import { PersistenceError } from "./errors";
import { extractUnknownFields, isPlainRecord } from "./json";
import type { NotebookDocumentSet, PersistenceCompatibility } from "./types";
import { validateNotebookFormatVersion } from "./versioning";

const metadataFields = [
  "formatVersion",
  "documentType",
  "id",
  "name",
  "createdAt",
  "updatedAt",
  "cover",
  "theme",
  "sectionIds",
  "assets",
  "settings",
] as const;
const sectionFields = [
  "formatVersion",
  "documentType",
  "id",
  "title",
  "pageIds",
  "color",
  "icon",
] as const;
const pageFields = [
  "formatVersion",
  "documentType",
  "id",
  "width",
  "height",
  "background",
  "objects",
  "createdAt",
  "updatedAt",
] as const;
const pageObjectFields = [
  "id",
  "type",
  "position",
  "rotation",
  "locked",
  "visible",
  "capabilities",
] as const;
const assetFields = ["id", "kind", "fileName", "mediaType", "byteLength", "createdAt"] as const;

export interface DeserializedNotebook {
  readonly notebook: ReturnType<typeof createNotebook>;
  readonly compatibility: PersistenceCompatibility;
}

export function deserializeNotebook(documents: NotebookDocumentSet): DeserializedNotebook {
  const metadata = documents.metadata;
  validateDocument(metadata, "notebook", "metadata.json");
  const sectionIds = stringArray(metadata.sectionIds, "metadata.json", "sectionIds");
  const sectionExtensions: Record<string, JsonObject> = {};
  const pageExtensions: Record<string, JsonObject> = {};
  const pageObjectExtensions: Record<string, JsonObject> = {};
  const assetExtensions: Record<string, JsonObject> = {};

  try {
    const assets = recordArray(metadata.assets, "metadata.json", "assets").map((assetDocument) => {
      const asset = deserializeAsset(assetDocument);
      assetExtensions[asset.id] = extractUnknownFields(assetDocument, assetFields);
      return asset;
    });

    const sections = sectionIds.map((sectionId) => {
      const sectionDocument = documents.sections[sectionId];
      if (!sectionDocument) {
        throw new PersistenceError("MISSING_FILE", `Missing section document '${sectionId}'.`, {
          details: { sectionId },
        });
      }
      validateDocument(sectionDocument, "section", `section:${sectionId}`);
      matchingId(sectionDocument, sectionId, `section:${sectionId}`);
      sectionExtensions[sectionId] = extractUnknownFields(sectionDocument, sectionFields);

      const pageIds = stringArray(sectionDocument.pageIds, `section:${sectionId}`, "pageIds");
      const pages = pageIds.map((pageId) => {
        const pageDocument = documents.pages[pageId];
        if (!pageDocument) {
          throw new PersistenceError("MISSING_FILE", `Missing page document '${pageId}'.`, {
            details: { pageId, sectionId },
          });
        }
        validateDocument(pageDocument, "page", `page:${pageId}`);
        matchingId(pageDocument, pageId, `page:${pageId}`);
        pageExtensions[pageId] = extractUnknownFields(pageDocument, pageFields);
        return deserializePage(pageDocument, pageObjectExtensions);
      });

      return createSection({
        id: value(sectionDocument, "id") as string,
        title: value(sectionDocument, "title") as string,
        pages,
        color: value(sectionDocument, "color") as string | null,
        icon: value(sectionDocument, "icon") as string | null,
      });
    });

    const notebook = createNotebook({
      id: value(metadata, "id") as string,
      name: value(metadata, "name") as string,
      createdAt: value(metadata, "createdAt") as string,
      updatedAt: value(metadata, "updatedAt") as string,
      cover: value(metadata, "cover") as NotebookCover,
      theme: value(metadata, "theme") as string,
      sections,
      assets,
      settings: value(metadata, "settings") as NotebookSettings,
    });

    return Object.freeze({
      notebook,
      compatibility: Object.freeze({
        metadata: extractUnknownFields(metadata, metadataFields),
        sections: Object.freeze(sectionExtensions),
        pages: Object.freeze(pageExtensions),
        pageObjects: Object.freeze(pageObjectExtensions),
        assets: Object.freeze(assetExtensions),
      }),
    });
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    if (error instanceof DomainValidationError) {
      throw new PersistenceError("INVALID_DATA", "Notebook data failed domain validation.", {
        cause: error,
        details: { issues: error.issues },
      });
    }
    throw new PersistenceError("INVALID_DATA", "Notebook document structure is invalid.", {
      cause: error,
    });
  }
}

function deserializePage(document: JsonObject, objectExtensions: Record<string, JsonObject>): Page {
  const objects = recordArray(document.objects, `page:${String(document.id)}`, "objects").map(
    (objectDocument) => {
      const candidate = {
        id: value(objectDocument, "id"),
        type: value(objectDocument, "type"),
        position: value(objectDocument, "position"),
        rotation: value(objectDocument, "rotation"),
        locked: value(objectDocument, "locked"),
        visible: value(objectDocument, "visible"),
        capabilities: value(objectDocument, "capabilities"),
      };
      assertValidPageObject(candidate);
      const object = createPageObject({
        id: candidate.id,
        type: candidate.type as PageObjectType,
        position: candidate.position as Position,
        rotation: candidate.rotation as number,
        locked: candidate.locked as boolean,
        visible: candidate.visible as boolean,
        capabilities: candidate.capabilities as PageObjectCapabilities,
      }) as PageObject;
      objectExtensions[object.id] = extractUnknownFields(objectDocument, pageObjectFields);
      return object;
    },
  );

  return createPage({
    id: value(document, "id") as string,
    width: value(document, "width") as number,
    height: value(document, "height") as number,
    background: value(document, "background") as PageBackground,
    objects,
    createdAt: value(document, "createdAt") as string,
    updatedAt: value(document, "updatedAt") as string,
  });
}

function deserializeAsset(document: JsonObject): Asset {
  const candidate = {
    id: value(document, "id"),
    kind: value(document, "kind"),
    fileName: value(document, "fileName"),
    mediaType: value(document, "mediaType"),
    byteLength: value(document, "byteLength"),
    createdAt: value(document, "createdAt"),
  };
  assertValidAsset(candidate);
  return createAsset({
    id: candidate.id,
    kind: candidate.kind as AssetKind,
    fileName: candidate.fileName,
    mediaType: candidate.mediaType,
    byteLength: candidate.byteLength,
    createdAt: candidate.createdAt,
  });
}

function validateDocument(document: JsonObject, type: string, filePath: string): void {
  validateNotebookFormatVersion(document.formatVersion, filePath);
  if (document.documentType !== type) {
    throw new PersistenceError("INVALID_DATA", `Expected ${type} document.`, {
      path: filePath,
      details: { received: document.documentType },
    });
  }
}

function matchingId(document: JsonObject, expectedId: string, filePath: string): void {
  if (document.id !== expectedId) {
    throw new PersistenceError("INVALID_DATA", "Document id does not match its reference.", {
      path: filePath,
      details: { expectedId, received: document.id },
    });
  }
}

function value(document: JsonObject, key: string): unknown {
  return document[key];
}

function stringArray(input: unknown, filePath: string, field: string): string[] {
  if (!Array.isArray(input) || input.some((entry) => typeof entry !== "string")) {
    throw new PersistenceError("INVALID_DATA", `Expected ${field} to be an array of strings.`, {
      path: filePath,
    });
  }
  return [...input] as string[];
}

function recordArray(input: unknown, filePath: string, field: string): JsonObject[] {
  if (!Array.isArray(input) || input.some((entry) => !isPlainRecord(entry))) {
    throw new PersistenceError("INVALID_DATA", `Expected ${field} to be an array of objects.`, {
      path: filePath,
    });
  }
  return input as JsonObject[];
}
