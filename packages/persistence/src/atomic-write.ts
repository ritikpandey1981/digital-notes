import path from "node:path";
import { PersistenceError } from "./errors";
import type { FileSystemAdapter } from "./file-system";
import { nodeFileSystem } from "./file-system";

export async function atomicWriteText(
  targetPath: string,
  content: string,
  fileSystem: FileSystemAdapter = nodeFileSystem,
): Promise<void> {
  const temporaryPath = `${targetPath}.tmp`;
  try {
    await fileSystem.createDirectory(path.dirname(targetPath));
    await fileSystem.writeTextFile(temporaryPath, content);
    await fileSystem.syncFile(temporaryPath);
    await fileSystem.rename(temporaryPath, targetPath);
  } catch (error) {
    throw new PersistenceError("ATOMIC_WRITE_FAILED", "Atomic file write failed.", {
      path: targetPath,
      cause: error,
      details: { temporaryPath },
    });
  }
}
