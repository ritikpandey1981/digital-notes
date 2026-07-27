import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAsset,
  createNotebook,
  createPage,
  createPageObject,
  createSection,
} from "@folio/domain";
import type { Notebook, Page } from "@folio/domain";
import { deserializeNotebook } from "../deserializer";
import { parseJsonObject } from "../json";
import { serializeNotebook } from "../serializer";
import type { NotebookDocumentSet } from "../types";

const CREATED_AT = "2026-01-02T03:04:05.000Z";
const UPDATED_AT = "2026-01-03T03:04:05.000Z";

export async function createTemporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "folio-persistence-"));
}

export async function removeTemporaryDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export function buildNotebook(
  options: {
    readonly sections?: number;
    readonly pagesPerSection?: number;
    readonly unicode?: boolean;
  } = {},
): Notebook {
  const sectionCount = options.sections ?? 2;
  const pagesPerSection = options.pagesPerSection ?? 2;
  const sections = Array.from({ length: sectionCount }, (_, sectionIndex) =>
    createSection({
      id: `section-${sectionIndex + 1}`,
      title: options.unicode ? `章 ${sectionIndex + 1} — नमस्ते` : `Section ${sectionIndex + 1}`,
      color: sectionIndex % 2 === 0 ? "#7c3aed" : null,
      icon: sectionIndex === 0 ? "book" : null,
      pages: Array.from({ length: pagesPerSection }, (_, pageIndex) =>
        createPage({
          id: `page-${sectionIndex + 1}-${pageIndex + 1}`,
          width: 1440,
          height: 1024,
          background: {
            type: "grid",
            color: "#ffffff",
            lineColor: "#e5e7eb",
            spacing: 24,
          },
          objects: [
            createPageObject({
              id: `object-${sectionIndex + 1}-${pageIndex + 1}`,
              type: "rich-text",
              position: { x: 24 + pageIndex, y: 36 + sectionIndex },
            }),
          ],
          createdAt: CREATED_AT,
          updatedAt: UPDATED_AT,
        }),
      ),
    }),
  );

  return createNotebook({
    id: "notebook-1",
    name: options.unicode ? "研究 📚 — Café" : "Project Atlas",
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    cover: { kind: "color", value: "#7c3aed" },
    theme: "violet",
    sections,
    assets: [
      createAsset({
        id: "asset-1",
        kind: "image",
        fileName: options.unicode ? "diagram-你好.png" : "diagram.png",
        mediaType: "image/png",
        byteLength: 42,
        createdAt: CREATED_AT,
      }),
    ],
    settings: { pageGap: 24, snapToGrid: true },
  });
}

export function updateFirstPage(notebook: Notebook, page: Page): Notebook {
  const sections = notebook.sections.map((section, sectionIndex) =>
    createSection({
      ...section,
      pages:
        sectionIndex === 0
          ? section.pages.map((candidate, pageIndex) => (pageIndex === 0 ? page : candidate))
          : section.pages,
    }),
  );
  return createNotebook({ ...notebook, sections });
}

export function documentsFor(notebook: Notebook): NotebookDocumentSet {
  const serialized = serializeNotebook(notebook);
  const metadataFile = serialized.files.find((file) => file.kind === "metadata");
  if (!metadataFile) throw new Error("Missing serialized metadata.");
  const sections: Record<string, ReturnType<typeof parseJsonObject>> = {};
  const pages: Record<string, ReturnType<typeof parseJsonObject>> = {};
  for (const file of serialized.files) {
    if (file.kind === "section" && file.id) sections[file.id] = parseJsonObject(file.content);
    if (file.kind === "page" && file.id) pages[file.id] = parseJsonObject(file.content);
  }
  return {
    metadata: parseJsonObject(metadataFile.content),
    sections,
    pages,
  };
}

export function roundTripInMemory(notebook: Notebook): Notebook {
  return deserializeNotebook(documentsFor(notebook)).notebook;
}
