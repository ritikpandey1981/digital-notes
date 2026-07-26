import { createAsset, createNotebook, createPage, createPageObject, createSection } from "../index";
import type { DomainFactoryContext, Notebook } from "../index";

export const TEST_TIMESTAMP = "2026-07-27T00:00:00.000Z";
export const NEXT_TIMESTAMP = "2026-07-27T01:00:00.000Z";

export function deterministicContext(prefix = "generated"): DomainFactoryContext {
  let nextId = 1;
  return {
    createId: () => `${prefix}-${nextId++}`,
    now: () => TEST_TIMESTAMP,
  };
}

export function buildNotebook(): Notebook {
  const object = createPageObject({
    id: "object-1",
    type: "rectangle",
    position: { x: 12, y: 24 },
    capabilities: {
      selectable: true,
      movable: true,
      resizable: true,
      rotatable: true,
      lockable: true,
    },
  });
  const page = createPage({
    id: "page-1",
    width: 210,
    height: 297,
    background: {
      type: "ruled",
      color: "#fffdf8",
      lineColor: "#d7ddea",
      spacing: 8,
    },
    objects: [object],
    createdAt: TEST_TIMESTAMP,
  });
  const section = createSection({
    id: "section-1",
    title: "Notes",
    pages: [page],
    color: "#4f46e5",
    icon: "book-open",
  });
  const asset = createAsset({
    id: "asset-1",
    kind: "image",
    fileName: "cover.webp",
    mediaType: "image/webp",
    byteLength: 2048,
    createdAt: TEST_TIMESTAMP,
  });
  return createNotebook({
    id: "notebook-1",
    name: "Studio Notes",
    createdAt: TEST_TIMESTAMP,
    cover: { kind: "asset", assetId: asset.id },
    theme: "calm",
    sections: [section],
    assets: [asset],
    settings: { autosaveInterval: 30, flags: ["calm"] },
  });
}
