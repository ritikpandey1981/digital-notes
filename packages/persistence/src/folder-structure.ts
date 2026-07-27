import type { FileSystemAdapter } from "./file-system";
import { nodeFileSystem } from "./file-system";
import { createNotebookPaths } from "./paths";
import type { NotebookPaths } from "./paths";

export async function ensureNotebookFolder(
  notebookPath: string,
  fileSystem: FileSystemAdapter = nodeFileSystem,
): Promise<NotebookPaths> {
  const paths = createNotebookPaths(notebookPath);
  await Promise.all([
    fileSystem.createDirectory(paths.root),
    fileSystem.createDirectory(paths.sections),
    fileSystem.createDirectory(paths.pages),
    fileSystem.createDirectory(paths.assets),
    fileSystem.createDirectory(paths.thumbnails),
    fileSystem.createDirectory(paths.folio),
  ]);
  return paths;
}
