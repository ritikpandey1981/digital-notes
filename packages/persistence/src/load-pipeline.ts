import type { JsonObject } from "@folio/domain";
import {
  ASSETS_DIRECTORY,
  FOLIO_INTERNAL_DIRECTORY,
  PAGES_DIRECTORY,
  SECTIONS_DIRECTORY,
  THUMBNAILS_DIRECTORY,
} from "./constants";
import { deserializeNotebook } from "./deserializer";
import { PersistenceError, toPersistenceError } from "./errors";
import type { FileSystemAdapter } from "./file-system";
import { nodeFileSystem } from "./file-system";
import { parseJsonObject } from "./json";
import {
  createNotebookPaths,
  fromRelativeNotebookPath,
  pageRelativePath,
  sectionRelativePath,
} from "./paths";
import type { LoadedNotebook, NotebookDocumentSet } from "./types";

export interface LoadNotebookOptions {
  readonly fileSystem?: FileSystemAdapter;
}

export async function loadNotebook(
  notebookPath: string,
  options: LoadNotebookOptions = {},
): Promise<LoadedNotebook> {
  const fileSystem = options.fileSystem ?? nodeFileSystem;
  const paths = createNotebookPaths(notebookPath);
  try {
    await assertRequiredFolders(paths.root, fileSystem);
    const metadata = await readRequiredJson(paths.metadata, fileSystem);
    const sectionIds = referencedIds(metadata.sectionIds, paths.metadata, "sectionIds");
    const sections: Record<string, JsonObject> = {};
    const pages: Record<string, JsonObject> = {};

    await Promise.all(
      sectionIds.map(async (sectionId) => {
        const relativePath = sectionRelativePath(sectionId);
        const absolutePath = fromRelativeNotebookPath(paths.root, relativePath);
        const document = await readRequiredJson(absolutePath, fileSystem);
        sections[sectionId] = document;
      }),
    );

    const pageReferences = new Map<string, string>();
    sectionIds.forEach((sectionId) => {
      const document = sections[sectionId];
      if (!document) return;
      referencedIds(document.pageIds, sectionRelativePath(sectionId), "pageIds").forEach(
        (pageId) => {
          if (!pageReferences.has(pageId)) pageReferences.set(pageId, sectionId);
        },
      );
    });

    await Promise.all(
      [...pageReferences.keys()].map(async (pageId) => {
        const relativePath = pageRelativePath(pageId);
        const absolutePath = fromRelativeNotebookPath(paths.root, relativePath);
        pages[pageId] = await readRequiredJson(absolutePath, fileSystem);
      }),
    );

    const documents: NotebookDocumentSet = {
      metadata,
      sections: Object.freeze(sections),
      pages: Object.freeze(pages),
    };
    const deserialized = deserializeNotebook(documents);
    return Object.freeze({
      notebook: deserialized.notebook,
      compatibility: deserialized.compatibility,
      notebookPath: paths.root,
    });
  } catch (error) {
    throw toPersistenceError(error, "IO_ERROR", "Notebook load failed.", paths.root);
  }
}

export async function readRequiredJson(
  filePath: string,
  fileSystem: FileSystemAdapter = nodeFileSystem,
): Promise<JsonObject> {
  if (!(await fileSystem.exists(filePath))) {
    throw new PersistenceError("MISSING_FILE", "Required notebook file is missing.", {
      path: filePath,
    });
  }
  try {
    return parseJsonObject(await fileSystem.readTextFile(filePath), filePath);
  } catch (error) {
    throw toPersistenceError(error, "IO_ERROR", "Unable to read notebook file.", filePath);
  }
}

async function assertRequiredFolders(root: string, fileSystem: FileSystemAdapter): Promise<void> {
  const required = [
    SECTIONS_DIRECTORY,
    PAGES_DIRECTORY,
    ASSETS_DIRECTORY,
    THUMBNAILS_DIRECTORY,
    FOLIO_INTERNAL_DIRECTORY,
  ];
  await Promise.all(
    required.map(async (relativePath) => {
      const absolutePath = fromRelativeNotebookPath(root, relativePath);
      if (!(await fileSystem.exists(absolutePath))) {
        throw new PersistenceError("MISSING_FILE", "Required notebook folder is missing.", {
          path: absolutePath,
        });
      }
    }),
  );
}

function referencedIds(input: unknown, filePath: string, field: string): string[] {
  if (!Array.isArray(input) || input.some((entry) => typeof entry !== "string")) {
    throw new PersistenceError("INVALID_DATA", `Expected ${field} to contain document ids.`, {
      path: filePath,
    });
  }
  if (input.some((entry) => entry.trim().length === 0)) {
    throw new PersistenceError("INVALID_DATA", `${field} contains an invalid document id.`, {
      path: filePath,
    });
  }
  return [...input] as string[];
}
