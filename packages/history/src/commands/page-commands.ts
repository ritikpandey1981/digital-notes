import { addPage, deletePage, duplicatePageInSection, reorderPages } from "@folio/domain";
import type { Notebook, Page } from "@folio/domain";
import type { Command, CommandFactoryOptions } from "../command";
import { createSnapshotCommand, resolveCommandMetadata } from "../internal/snapshot-command";

export function createAddPageCommand(
  notebook: Notebook,
  sectionId: string,
  page: Page,
  options: CommandFactoryOptions = {},
): Command {
  const metadata = resolveCommandMetadata(options, `Add page "${page.id}"`);
  const after = addPage(notebook, sectionId, page, domainContext(metadata));
  return createSnapshotCommand({
    before: notebook,
    after,
    category: "page",
    metadata,
    affectedTargets: [{ kind: "page", pageId: page.id, sectionId }],
  });
}

export function createDeletePageCommand(
  notebook: Notebook,
  sectionId: string,
  pageId: string,
  options: CommandFactoryOptions = {},
): Command {
  const metadata = resolveCommandMetadata(options, `Delete page "${pageId}"`);
  const after = deletePage(notebook, sectionId, pageId, domainContext(metadata));
  return createSnapshotCommand({
    before: notebook,
    after,
    category: "page",
    metadata,
    affectedTargets: [{ kind: "page", pageId, sectionId }],
  });
}

export interface DuplicatePageCommand extends Command {
  readonly duplicatedPage: Page;
}

export function createDuplicatePageCommand(
  notebook: Notebook,
  sectionId: string,
  pageId: string,
  options: CommandFactoryOptions = {},
): DuplicatePageCommand {
  const metadata = resolveCommandMetadata(options, `Duplicate page "${pageId}"`);
  const result = duplicatePageInSection(notebook, sectionId, pageId, domainContext(metadata));
  const command = createSnapshotCommand({
    before: notebook,
    after: result.notebook,
    category: "page",
    metadata,
    affectedTargets: [{ kind: "page", pageId: result.page.id, sectionId }],
  });
  return Object.freeze({ ...command, duplicatedPage: result.page });
}

export function createReorderPagesCommand(
  notebook: Notebook,
  sectionId: string,
  fromIndex: number,
  toIndex: number,
  options: CommandFactoryOptions = {},
): Command {
  const metadata = resolveCommandMetadata(options, "Reorder pages");
  const after = reorderPages(notebook, sectionId, fromIndex, toIndex, domainContext(metadata));
  return createSnapshotCommand({
    before: notebook,
    after,
    category: "page",
    metadata,
    affectedTargets: [{ kind: "section", sectionId }],
  });
}

function domainContext(metadata: ReturnType<typeof resolveCommandMetadata>) {
  return {
    createId: metadata.context.createId,
    now: () => metadata.timestamp,
  };
}
