import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { ProjectSaveErrorCode } from "./project-save-contract";

export const projectFileSystem = { access, lstat, open, rename, unlink };
export type ProjectFileSystem = typeof projectFileSystem;

export class ProjectWriteError extends Error {
  constructor(readonly code: ProjectSaveErrorCode) {
    super(code);
  }
}

export function platformErrorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export function mapFileError(error: unknown, stage: "write" | "replace"): ProjectSaveErrorCode {
  if (error instanceof ProjectWriteError) return error.code;
  switch (platformErrorCode(error)) {
    case "EACCES":
    case "EPERM":
      return "PERMISSION_DENIED";
    case "EROFS":
      return "READ_ONLY";
    case "ENOENT":
    case "ENOTDIR":
    case "EISDIR":
    case "ENODEV":
    case "ENXIO":
      return "TARGET_UNAVAILABLE";
    default:
      return stage === "replace" ? "REPLACE_FAILED" : "WRITE_FAILED";
  }
}

/** Never opens the destination for writing or removes it to make rename succeed. */
export async function writeProjectAtomically(
  target: string,
  content: string,
  fs: ProjectFileSystem = projectFileSystem,
  mayCommit: () => boolean = () => true,
): Promise<void> {
  const temporary = path.join(path.dirname(target), `.folio-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let ownsTemporary = false;
  let stage: "write" | "replace" = "write";
  try {
    try {
      const info = await fs.lstat(target);
      if (!info.isFile() || info.isSymbolicLink())
        throw new ProjectWriteError("TARGET_UNAVAILABLE");
      // Windows exposes its read-only attribute through the write mode bits.
      if ((info.mode & 0o222) === 0) throw new ProjectWriteError("READ_ONLY");
      await fs.access(target, constants.W_OK);
    } catch (error) {
      if (platformErrorCode(error) !== "ENOENT") throw error;
    }
    handle = await fs.open(temporary, "wx", 0o600);
    ownsTemporary = true;
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (!mayCommit()) throw new ProjectWriteError("TARGET_UNAVAILABLE");
    stage = "replace";
    // Same-directory rename is the commit point. Node/libuv uses replace-existing
    // semantics on Windows; a failed rename is never followed by delete/retry.
    await fs.rename(temporary, target);
    ownsTemporary = false;
  } catch (error) {
    throw new ProjectWriteError(mapFileError(error, stage));
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    // Only this operation's exclusively created file is eligible for cleanup.
    if (ownsTemporary) await fs.unlink(temporary).catch(() => undefined);
  }
}
