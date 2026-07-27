import path from "node:path";
import {
  ASSETS_DIRECTORY,
  FOLIO_INTERNAL_DIRECTORY,
  NOTEBOOK_METADATA_FILE,
  PAGES_DIRECTORY,
  RECOVERY_BACKUP_DIRECTORY,
  RECOVERY_FILE,
  SECTIONS_DIRECTORY,
  THUMBNAILS_DIRECTORY,
} from "./constants";
import { PersistenceError } from "./errors";

export interface NotebookPaths {
  readonly root: string;
  readonly metadata: string;
  readonly sections: string;
  readonly pages: string;
  readonly assets: string;
  readonly thumbnails: string;
  readonly folio: string;
  readonly recoveryFile: string;
  readonly recoveryBackups: string;
}

export function normalizeNotebookPath(notebookPath: string): string {
  if (typeof notebookPath !== "string" || notebookPath.trim().length === 0) {
    throw new PersistenceError("INVALID_PATH", "Notebook path must not be blank.", {
      path: notebookPath,
    });
  }
  if (notebookPath.includes("\0")) {
    throw new PersistenceError("INVALID_PATH", "Notebook path contains a null byte.", {
      path: notebookPath,
    });
  }
  return path.resolve(notebookPath);
}

export function createNotebookPaths(notebookPath: string): NotebookPaths {
  const root = normalizeNotebookPath(notebookPath);
  return Object.freeze({
    root,
    metadata: path.join(root, NOTEBOOK_METADATA_FILE),
    sections: path.join(root, SECTIONS_DIRECTORY),
    pages: path.join(root, PAGES_DIRECTORY),
    assets: path.join(root, ASSETS_DIRECTORY),
    thumbnails: path.join(root, THUMBNAILS_DIRECTORY),
    folio: path.join(root, FOLIO_INTERNAL_DIRECTORY),
    recoveryFile: fromRelativeNotebookPath(root, RECOVERY_FILE),
    recoveryBackups: fromRelativeNotebookPath(root, RECOVERY_BACKUP_DIRECTORY),
  });
}

export function documentFileName(id: string): string {
  if (typeof id !== "string" || id.trim().length === 0 || id.includes("\0")) {
    throw new PersistenceError("INVALID_PATH", "Document id cannot be converted to a safe path.");
  }
  return `item-${encodeURIComponent(id).replaceAll(".", "%2E")}.json`;
}

export function sectionRelativePath(id: string): string {
  return `${SECTIONS_DIRECTORY}/${documentFileName(id)}`;
}

export function pageRelativePath(id: string): string {
  return `${PAGES_DIRECTORY}/${documentFileName(id)}`;
}

export function fromRelativeNotebookPath(notebookPath: string, relativePath: string): string {
  const root = normalizeNotebookPath(notebookPath);
  if (
    typeof relativePath !== "string" ||
    relativePath.trim().length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\0")
  ) {
    throw new PersistenceError("INVALID_PATH", "Expected a safe notebook-relative path.", {
      path: relativePath,
    });
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new PersistenceError("INVALID_PATH", "Notebook-relative path contains unsafe segments.", {
      path: relativePath,
    });
  }
  const resolved = path.resolve(root, ...segments);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (resolved !== root && !resolved.startsWith(rootPrefix)) {
    throw new PersistenceError("INVALID_PATH", "Path escapes the notebook folder.", {
      path: relativePath,
    });
  }
  return resolved;
}
