import {
  createAsset,
  createNotebook,
  createPage,
  createPageObject,
  createSection,
} from "@folio/domain";
import type { Notebook } from "@folio/domain";
import type { CommandFactoryOptions } from "../command";

export const INITIAL_TIMESTAMP = "2026-01-02T03:04:05.000Z";
export const COMMAND_TIMESTAMP = "2026-02-02T03:04:05.000Z";

export function buildNotebook(): Notebook {
  return createNotebook({
    id: "notebook-1",
    name: "Project Atlas",
    createdAt: INITIAL_TIMESTAMP,
    updatedAt: INITIAL_TIMESTAMP,
    cover: null,
    theme: "default",
    settings: { snapToGrid: true },
    assets: [
      createAsset({
        id: "asset-1",
        kind: "image",
        fileName: "map.png",
        mediaType: "image/png",
        byteLength: 128,
        createdAt: INITIAL_TIMESTAMP,
      }),
    ],
    sections: [
      createSection({
        id: "section-1",
        title: "Research",
        pages: [createFixturePage("page-1", "object-1"), createFixturePage("page-2", "object-2")],
      }),
      createSection({
        id: "section-2",
        title: "Drafts",
        pages: [createFixturePage("page-3", "object-3")],
      }),
      createSection({
        id: "section-3",
        title: "Archive",
        pages: [],
      }),
    ],
  });
}

export function createFixturePage(id: string, objectId = `${id}-object`) {
  return createPage({
    id,
    width: 1440,
    height: 1024,
    createdAt: INITIAL_TIMESTAMP,
    updatedAt: INITIAL_TIMESTAMP,
    objects: [
      createPageObject({
        id: objectId,
        type: "rich-text",
        position: { x: 24, y: 36 },
      }),
    ],
  });
}

export function commandOptions(id: string, timestamp = COMMAND_TIMESTAMP): CommandFactoryOptions {
  return { id, timestamp };
}
