import { DomainValidationError } from "./errors";
import type { ValidationIssue } from "./errors";
import { duplicatePage } from "./factories";
import { resolveFactoryContext } from "./factory-context";
import type { DomainFactoryContextOverrides } from "./factory-context";
import { cloneAndFreeze } from "./internal";
import type { Notebook, NotebookCover, NotebookSettings, Page, Section } from "./models";
import type { DomainId } from "./types";
import { assertValidNotebook, assertValidPage, assertValidSection } from "./validation";

function fail(path: string, code: ValidationIssue["code"], message: string): never {
  throw new DomainValidationError([{ path, code, message }]);
}

function finalizeNotebook(notebook: Notebook): Notebook {
  assertValidNotebook(notebook);
  return cloneAndFreeze(notebook);
}

function updatedAt(contextOverrides: DomainFactoryContextOverrides): string {
  return resolveFactoryContext(contextOverrides).now();
}

function sectionIndex(notebook: Notebook, sectionId: DomainId): number {
  const index = notebook.sections.findIndex((section) => section.id === sectionId);
  if (index < 0) fail("$.sections", "not_found", `Section '${sectionId}' does not exist.`);
  return index;
}

function pageIndex(section: Section, pageId: DomainId): number {
  const index = section.pages.findIndex((page) => page.id === pageId);
  if (index < 0) fail("$.sections[].pages", "not_found", `Page '${pageId}' does not exist.`);
  return index;
}

function reorder<T>(
  items: readonly T[],
  fromIndex: number,
  toIndex: number,
  path: string,
): readonly T[] {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= items.length) {
    fail(path, "out_of_range", `Source index ${fromIndex} is out of range.`);
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= items.length) {
    fail(path, "out_of_range", `Destination index ${toIndex} is out of range.`);
  }
  if (fromIndex === toIndex) return items;
  const reordered = [...items];
  const [item] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, item as T);
  return reordered;
}

export function renameNotebook(
  notebook: Notebook,
  name: string,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  assertValidNotebook(notebook);
  return finalizeNotebook({ ...notebook, name, updatedAt: updatedAt(contextOverrides) });
}

export interface NotebookMetadataPatch {
  readonly cover?: NotebookCover;
  readonly theme?: string;
  readonly settings?: NotebookSettings;
}

export function updateNotebookMetadata(
  notebook: Notebook,
  patch: NotebookMetadataPatch,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  assertValidNotebook(notebook);
  return finalizeNotebook({
    ...notebook,
    cover: patch.cover === undefined ? notebook.cover : patch.cover,
    theme: patch.theme === undefined ? notebook.theme : patch.theme,
    settings: patch.settings === undefined ? notebook.settings : patch.settings,
    updatedAt: updatedAt(contextOverrides),
  });
}

export function addSection(
  notebook: Notebook,
  section: Section,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  assertValidNotebook(notebook);
  assertValidSection(section);
  return finalizeNotebook({
    ...notebook,
    sections: [...notebook.sections, section],
    updatedAt: updatedAt(contextOverrides),
  });
}

export function deleteSection(
  notebook: Notebook,
  sectionId: DomainId,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  assertValidNotebook(notebook);
  const index = sectionIndex(notebook, sectionId);
  return finalizeNotebook({
    ...notebook,
    sections: notebook.sections.filter((_, candidateIndex) => candidateIndex !== index),
    updatedAt: updatedAt(contextOverrides),
  });
}

export function renameSection(
  notebook: Notebook,
  sectionId: DomainId,
  title: string,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  assertValidNotebook(notebook);
  const index = sectionIndex(notebook, sectionId);
  const sections = notebook.sections.map((section, candidateIndex) =>
    candidateIndex === index ? { ...section, title } : section,
  );
  return finalizeNotebook({
    ...notebook,
    sections,
    updatedAt: updatedAt(contextOverrides),
  });
}

export function reorderSections(
  notebook: Notebook,
  fromIndex: number,
  toIndex: number,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  assertValidNotebook(notebook);
  const sections = reorder(notebook.sections, fromIndex, toIndex, "$.sections");
  if (sections === notebook.sections) return notebook;
  return finalizeNotebook({
    ...notebook,
    sections,
    updatedAt: updatedAt(contextOverrides),
  });
}

export function addPage(
  notebook: Notebook,
  sectionId: DomainId,
  page: Page,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  assertValidNotebook(notebook);
  assertValidPage(page);
  const index = sectionIndex(notebook, sectionId);
  const sections = notebook.sections.map((section, candidateIndex) =>
    candidateIndex === index ? { ...section, pages: [...section.pages, page] } : section,
  );
  return finalizeNotebook({
    ...notebook,
    sections,
    updatedAt: updatedAt(contextOverrides),
  });
}

export function deletePage(
  notebook: Notebook,
  sectionId: DomainId,
  pageId: DomainId,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  assertValidNotebook(notebook);
  const targetSectionIndex = sectionIndex(notebook, sectionId);
  const targetSection = notebook.sections[targetSectionIndex] as Section;
  const targetPageIndex = pageIndex(targetSection, pageId);
  const sections = notebook.sections.map((section, candidateIndex) =>
    candidateIndex === targetSectionIndex
      ? {
          ...section,
          pages: section.pages.filter(
            (_, candidatePageIndex) => candidatePageIndex !== targetPageIndex,
          ),
        }
      : section,
  );
  return finalizeNotebook({
    ...notebook,
    sections,
    updatedAt: updatedAt(contextOverrides),
  });
}

export interface DuplicatePageResult {
  readonly notebook: Notebook;
  readonly page: Page;
}

export function duplicatePageInSection(
  notebook: Notebook,
  sectionId: DomainId,
  pageId: DomainId,
  contextOverrides: DomainFactoryContextOverrides = {},
): DuplicatePageResult {
  assertValidNotebook(notebook);
  const targetSectionIndex = sectionIndex(notebook, sectionId);
  const targetSection = notebook.sections[targetSectionIndex] as Section;
  const targetPageIndex = pageIndex(targetSection, pageId);
  const source = targetSection.pages[targetPageIndex] as Page;
  const duplicatedPage = duplicatePage(source, {}, contextOverrides);
  const pages = [...targetSection.pages];
  pages.splice(targetPageIndex + 1, 0, duplicatedPage);
  const sections = notebook.sections.map((section, candidateIndex) =>
    candidateIndex === targetSectionIndex ? { ...section, pages } : section,
  );
  const nextNotebook = finalizeNotebook({
    ...notebook,
    sections,
    updatedAt: updatedAt(contextOverrides),
  });
  const page = nextNotebook.sections[targetSectionIndex]?.pages[targetPageIndex + 1];
  if (!page) fail("$.sections[].pages", "not_found", "Duplicated page was not inserted.");
  return Object.freeze({ notebook: nextNotebook, page });
}

export function reorderPages(
  notebook: Notebook,
  sectionId: DomainId,
  fromIndex: number,
  toIndex: number,
  contextOverrides: DomainFactoryContextOverrides = {},
): Notebook {
  assertValidNotebook(notebook);
  const targetSectionIndex = sectionIndex(notebook, sectionId);
  const targetSection = notebook.sections[targetSectionIndex] as Section;
  const pages = reorder(targetSection.pages, fromIndex, toIndex, "$.sections[].pages");
  if (pages === targetSection.pages) return notebook;
  const sections = notebook.sections.map((section, candidateIndex) =>
    candidateIndex === targetSectionIndex ? { ...section, pages } : section,
  );
  return finalizeNotebook({
    ...notebook,
    sections,
    updatedAt: updatedAt(contextOverrides),
  });
}
