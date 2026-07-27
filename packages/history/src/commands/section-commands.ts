import { addSection, deleteSection, renameSection, reorderSections } from "@folio/domain";
import type { Notebook, Section } from "@folio/domain";
import type { Command, CommandFactoryOptions, HistoryChangeTarget } from "../command";
import { createSnapshotCommand, resolveCommandMetadata } from "../internal/snapshot-command";

export function createAddSectionCommand(
  notebook: Notebook,
  section: Section,
  options: CommandFactoryOptions = {},
): Command {
  const metadata = resolveCommandMetadata(options, `Add section "${section.title}"`);
  const after = addSection(notebook, section, domainContext(metadata));
  return createSnapshotCommand({
    before: notebook,
    after,
    category: "section",
    metadata,
    affectedTargets: sectionTargets(section),
  });
}

export function createDeleteSectionCommand(
  notebook: Notebook,
  sectionId: string,
  options: CommandFactoryOptions = {},
): Command {
  const metadata = resolveCommandMetadata(options, `Delete section "${sectionId}"`);
  const section = notebook.sections.find(({ id }) => id === sectionId);
  const after = deleteSection(notebook, sectionId, domainContext(metadata));
  return createSnapshotCommand({
    before: notebook,
    after,
    category: "section",
    metadata,
    affectedTargets: section ? sectionTargets(section) : [{ kind: "metadata" }],
  });
}

export function createRenameSectionCommand(
  notebook: Notebook,
  sectionId: string,
  title: string,
  options: CommandFactoryOptions = {},
): Command {
  const metadata = resolveCommandMetadata(options, `Rename section to "${title}"`);
  const after = renameSection(notebook, sectionId, title, domainContext(metadata));
  return createSnapshotCommand({
    before: notebook,
    after,
    category: "section",
    metadata,
    affectedTargets: [{ kind: "section", sectionId }],
  });
}

export function createReorderSectionsCommand(
  notebook: Notebook,
  fromIndex: number,
  toIndex: number,
  options: CommandFactoryOptions = {},
): Command {
  const metadata = resolveCommandMetadata(options, "Reorder sections");
  const after = reorderSections(notebook, fromIndex, toIndex, domainContext(metadata));
  return createSnapshotCommand({
    before: notebook,
    after,
    category: "section",
    metadata,
    affectedTargets: [{ kind: "metadata" }],
  });
}

function sectionTargets(section: Section): readonly HistoryChangeTarget[] {
  return [
    { kind: "section", sectionId: section.id },
    ...section.pages.map((page): HistoryChangeTarget => ({
      kind: "page",
      pageId: page.id,
      sectionId: section.id,
    })),
  ];
}

function domainContext(metadata: ReturnType<typeof resolveCommandMetadata>) {
  return {
    createId: metadata.context.createId,
    now: () => metadata.timestamp,
  };
}
