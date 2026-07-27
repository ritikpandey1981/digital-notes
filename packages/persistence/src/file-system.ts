import { open, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";

export interface FileSystemDirectoryEntry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
}

export interface FileSystemAdapter {
  readonly createDirectory: (path: string) => Promise<void>;
  readonly exists: (path: string) => Promise<boolean>;
  readonly readDirectory: (path: string) => Promise<readonly FileSystemDirectoryEntry[]>;
  readonly readTextFile: (path: string) => Promise<string>;
  readonly removeFile: (path: string) => Promise<void>;
  readonly rename: (sourcePath: string, targetPath: string) => Promise<void>;
  readonly syncFile: (path: string) => Promise<void>;
  readonly writeTextFile: (path: string, content: string) => Promise<void>;
}

export const nodeFileSystem: FileSystemAdapter = Object.freeze({
  createDirectory: async (path: string) => {
    await mkdir(path, { recursive: true });
  },
  exists: async (path: string) => {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    }
  },
  readDirectory: async (path: string) => {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  },
  readTextFile: async (path: string) => readFile(path, "utf8"),
  removeFile: async (path: string) => {
    await rm(path, { force: true });
  },
  rename: async (sourcePath: string, targetPath: string) => {
    await rename(sourcePath, targetPath);
  },
  syncFile: async (path: string) => {
    const handle = await open(path, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  writeTextFile: async (path: string, content: string) => {
    await writeFile(path, content, { encoding: "utf8" });
  },
});

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
