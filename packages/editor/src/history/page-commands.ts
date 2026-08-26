import {
  Page,
  PageDocument,
  SketchbookDocument,
  type PageGeometry,
  type PagePaper,
} from "@folio/document";
import type { EditorCommand } from "@folio/history";

function requireSketchbook(document: SketchbookDocument, commandName: string): SketchbookDocument {
  if (!(document instanceof SketchbookDocument)) {
    throw new TypeError(`${commandName} requires a SketchbookDocument.`);
  }
  return document;
}

function isIsoTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function assertTimestamp(timestamp: string): string {
  if (!isIsoTimestamp(timestamp)) {
    throw new TypeError("Page commands require a valid ISO-8601 timestamp.");
  }
  return timestamp;
}

/**
 * Lifts one page-scoped command into the sketchbook document.
 *
 * The target page identity is captured when the command is created, so undo and
 * redo always reach the page the user actually edited even after switching
 * pages. Existing artwork commands are reused unchanged.
 */
export function liftPageCommand(
  command: EditorCommand<PageDocument>,
  pageId: string,
): EditorCommand<SketchbookDocument> {
  const apply = (
    document: SketchbookDocument,
    operation: (content: PageDocument) => PageDocument,
  ): SketchbookDocument => {
    const current = requireSketchbook(document, "Page-scoped command");
    const page = current.requirePage(pageId);
    return current.replacePage(page.withContent(operation(page.content)));
  };
  return Object.freeze({
    id: command.id,
    timestamp: command.timestamp,
    description: command.description,
    execute: (document: SketchbookDocument) =>
      apply(document, (content) => command.execute(content)),
    undo: (document: SketchbookDocument) => apply(document, (content) => command.undo(content)),
    redo: (document: SketchbookDocument) => apply(document, (content) => command.redo(content)),
  });
}

interface PageCommandMetadata {
  readonly id: string;
  readonly timestamp: string;
  readonly description: string;
}

function pageStateCommand(
  metadata: PageCommandMetadata,
  pageId: string,
  toFinal: (page: Page) => Page,
  toInitial: (page: Page) => Page,
): EditorCommand<SketchbookDocument> {
  const apply = (
    document: SketchbookDocument,
    transform: (page: Page) => Page,
  ): SketchbookDocument => {
    const current = requireSketchbook(document, "Page state command");
    return current.replacePage(transform(current.requirePage(pageId)));
  };
  return Object.freeze({
    id: metadata.id,
    timestamp: assertTimestamp(metadata.timestamp),
    description: metadata.description,
    execute: (document: SketchbookDocument) => apply(document, toFinal),
    undo: (document: SketchbookDocument) => apply(document, toInitial),
    redo: (document: SketchbookDocument) => apply(document, toFinal),
  });
}

export function createPageGeometryCommand(input: {
  readonly pageId: string;
  readonly initialGeometry: PageGeometry;
  readonly finalGeometry: PageGeometry;
  readonly timestamp: string;
  readonly description?: string;
}): EditorCommand<SketchbookDocument> {
  return pageStateCommand(
    {
      id: `page-geometry-${input.pageId}-${input.timestamp}`,
      timestamp: input.timestamp,
      description: input.description ?? "Resize page",
    },
    input.pageId,
    (page) => page.withGeometry(input.finalGeometry),
    (page) => page.withGeometry(input.initialGeometry),
  );
}

export function createPagePaperCommand(input: {
  readonly pageId: string;
  readonly initialPaper: PagePaper;
  readonly finalPaper: PagePaper;
  readonly timestamp: string;
  readonly description?: string;
}): EditorCommand<SketchbookDocument> {
  return pageStateCommand(
    {
      id: `page-paper-${input.pageId}-${input.timestamp}`,
      timestamp: input.timestamp,
      description: input.description ?? "Change paper",
    },
    input.pageId,
    (page) => page.withPaper(input.finalPaper),
    (page) => page.withPaper(input.initialPaper),
  );
}

export function createPageRenameCommand(input: {
  readonly pageId: string;
  readonly initialName: string;
  readonly finalName: string;
  readonly timestamp: string;
}): EditorCommand<SketchbookDocument> {
  return pageStateCommand(
    {
      id: `page-rename-${input.pageId}-${input.timestamp}`,
      timestamp: input.timestamp,
      description: "Rename page",
    },
    input.pageId,
    (page) => page.withName(input.finalName),
    (page) => page.withName(input.initialName),
  );
}

export function createAddPageCommand(input: {
  readonly page: Page;
  readonly index: number;
  readonly timestamp: string;
  readonly description?: string;
}): EditorCommand<SketchbookDocument> {
  const insert = (document: SketchbookDocument): SketchbookDocument =>
    requireSketchbook(document, "AddPageCommand").insertPage(
      input.page,
      Math.min(input.index, document.pageCount),
    );
  return Object.freeze({
    id: `add-page-${input.page.id}`,
    timestamp: assertTimestamp(input.timestamp),
    description: input.description ?? "Add page",
    execute: insert,
    undo: (document: SketchbookDocument) =>
      requireSketchbook(document, "AddPageCommand").removePage(input.page.id),
    redo: insert,
  });
}

export function createRemovePageCommand(input: {
  readonly page: Page;
  readonly index: number;
  readonly timestamp: string;
  readonly description?: string;
}): EditorCommand<SketchbookDocument> {
  const remove = (document: SketchbookDocument): SketchbookDocument =>
    requireSketchbook(document, "RemovePageCommand").removePage(input.page.id);
  return Object.freeze({
    id: `remove-page-${input.page.id}`,
    timestamp: assertTimestamp(input.timestamp),
    description: input.description ?? "Delete page",
    execute: remove,
    // The removed page is restored at its exact original index with its exact
    // artwork, layers, geometry, and paper.
    undo: (document: SketchbookDocument) =>
      requireSketchbook(document, "RemovePageCommand").insertPage(
        input.page,
        Math.min(input.index, document.pageCount),
      ),
    redo: remove,
  });
}

export function createReorderPagesCommand(input: {
  readonly pageId: string;
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly timestamp: string;
}): EditorCommand<SketchbookDocument> {
  const move = (document: SketchbookDocument, index: number): SketchbookDocument =>
    requireSketchbook(document, "ReorderPagesCommand").reorderPages(input.pageId, index);
  return Object.freeze({
    id: `reorder-page-${input.pageId}-${input.timestamp}`,
    timestamp: assertTimestamp(input.timestamp),
    description: "Reorder pages",
    execute: (document: SketchbookDocument) => move(document, input.toIndex),
    undo: (document: SketchbookDocument) => move(document, input.fromIndex),
    redo: (document: SketchbookDocument) => move(document, input.toIndex),
  });
}
