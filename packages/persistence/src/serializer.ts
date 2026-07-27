import { assertValidNotebook } from "@folio/domain";
import type { Asset, JsonObject, JsonValue, Notebook, PageObject } from "@folio/domain";
import { CURRENT_NOTEBOOK_FORMAT_VERSION, NOTEBOOK_METADATA_FILE } from "./constants";
import { stableStringify } from "./json";
import { pageRelativePath, sectionRelativePath } from "./paths";
import { createEmptyCompatibility } from "./types";
import type { PersistenceCompatibility, SerializedNotebook, SerializedNotebookFile } from "./types";

export function serializeNotebook(
  notebook: Notebook,
  compatibility: PersistenceCompatibility = createEmptyCompatibility(),
): SerializedNotebook {
  assertValidNotebook(notebook);
  const files: SerializedNotebookFile[] = [];

  const assets = notebook.assets.map((asset) => serializeAsset(asset, compatibility));
  const metadata: JsonObject = {
    ...compatibility.metadata,
    formatVersion: CURRENT_NOTEBOOK_FORMAT_VERSION,
    documentType: "notebook",
    id: notebook.id,
    name: notebook.name,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
    cover: notebook.cover as JsonValue,
    theme: notebook.theme,
    sectionIds: notebook.sections.map(({ id }) => id),
    assets,
    settings: notebook.settings,
  };

  files.push({
    kind: "metadata",
    relativePath: NOTEBOOK_METADATA_FILE,
    content: stableStringify(metadata),
  });

  notebook.sections.forEach((section) => {
    const sectionDocument: JsonObject = {
      ...(compatibility.sections[section.id] ?? {}),
      formatVersion: CURRENT_NOTEBOOK_FORMAT_VERSION,
      documentType: "section",
      id: section.id,
      title: section.title,
      pageIds: section.pages.map(({ id }) => id),
      color: section.color,
      icon: section.icon,
    };
    files.push({
      kind: "section",
      id: section.id,
      relativePath: sectionRelativePath(section.id),
      content: stableStringify(sectionDocument),
    });

    section.pages.forEach((page) => {
      const objects = page.objects.map((object) => serializePageObject(object, compatibility));
      const pageDocument: JsonObject = {
        ...(compatibility.pages[page.id] ?? {}),
        formatVersion: CURRENT_NOTEBOOK_FORMAT_VERSION,
        documentType: "page",
        id: page.id,
        width: page.width,
        height: page.height,
        background: page.background as unknown as JsonValue,
        objects,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      };
      files.push({
        kind: "page",
        id: page.id,
        relativePath: pageRelativePath(page.id),
        content: stableStringify(pageDocument),
      });
    });
  });

  return Object.freeze({ files: Object.freeze(files) });
}

function serializePageObject(
  object: PageObject,
  compatibility: PersistenceCompatibility,
): JsonObject {
  return {
    ...(compatibility.pageObjects[object.id] ?? {}),
    id: object.id,
    type: object.type,
    position: object.position as unknown as JsonValue,
    rotation: object.rotation,
    locked: object.locked,
    visible: object.visible,
    capabilities: object.capabilities as unknown as JsonValue,
  };
}

function serializeAsset(asset: Asset, compatibility: PersistenceCompatibility): JsonObject {
  return {
    ...(compatibility.assets[asset.id] ?? {}),
    id: asset.id,
    kind: asset.kind,
    fileName: asset.fileName,
    mediaType: asset.mediaType,
    byteLength: asset.byteLength,
    createdAt: asset.createdAt,
  };
}
