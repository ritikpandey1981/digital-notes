import { randomUUID } from "node:crypto";
import path from "node:path";
import { MAXIMUM_PROJECT_BYTES, ProjectReadLimitError, readDesktopProject } from "./project-read";
import {
  isProjectTargetId,
  openFailure,
  type ProjectReadResult,
  type ProjectTargetResult,
  type ProjectReleaseResult,
} from "./project-open-contract";
import {
  ProjectWriteError,
  projectFileSystem,
  platformErrorCode,
  mapFileError,
  writeProjectAtomically,
} from "./project-atomic-write";
import {
  saveFailure,
  type ProjectSaveRequest,
  type ProjectSaveResult,
} from "./project-save-contract";

export interface ProjectFileServiceOptions {
  readonly chooseSource?: () => Promise<readonly string[] | null>;
  readonly read?: typeof readDesktopProject;
  readonly chooseDestination: (suggestedName: string) => Promise<string | null>;
  readonly confirmReplacement: (displayName: string) => Promise<boolean>;
  readonly write?: typeof writeProjectAtomically;
}

/** One window's file authority. Paths never cross the preload bridge. */
export class DesktopProjectFileService {
  private target: Readonly<{ id: string; path: string }> | null = null;
  private provisional: Readonly<{ id: string; path: string }> | null = null;
  private busy = false;
  private generation = 0;
  private openGeneration = 0;
  private disposed = false;

  constructor(private readonly options: ProjectFileServiceOptions) {}

  /**
   * The original location behind an adopted target, for main-owned metadata.
   *
   * Recovery records keep it so a future Open Original can work. It is never
   * returned over the preload bridge, which is why this stays in main.
   */
  sourcePathForTarget(targetId: string): string | null {
    return this.target?.id === targetId ? this.target.path : null;
  }

  /** Navigation drops capabilities belonging to the previous renderer document. */
  revoke(): void {
    this.generation += 1;
    this.target = null;
    this.provisional = null;
  }

  dispose(): void {
    this.disposed = true;
    this.revoke();
  }

  async open(input?: unknown): Promise<ProjectReadResult> {
    if (input !== undefined)
      return openFailure("INVALID_REQUEST", "Open takes no path or payload.");
    if (this.disposed) return openFailure("TARGET_UNAVAILABLE", "The project window is closed.");
    if (this.busy) return openFailure("BUSY", "A project operation is already in progress.");
    this.busy = true;
    // At most one provisional capability. A fresh request retires any orphaned lost reply.
    this.provisional = null;
    const generation = this.generation;
    const openGeneration = ++this.openGeneration;
    const current = () =>
      !this.disposed && generation === this.generation && openGeneration === this.openGeneration;
    try {
      const paths = await this.options.chooseSource?.();
      if (!current()) return openFailure("TARGET_UNAVAILABLE", "The project window changed.");
      if (paths === null) return { status: "cancelled" };
      if (
        !Array.isArray(paths) ||
        paths.length !== 1 ||
        typeof paths[0] !== "string" ||
        !/\.folio$/i.test(paths[0]) ||
        projectDestination(paths[0]) !== paths[0]
      )
        return openFailure("INVALID_REQUEST", "Choose one regular .folio project file.");
      const filename = paths[0];
      const content = await (this.options.read ?? readDesktopProject)(filename);
      if (!current()) return openFailure("TARGET_UNAVAILABLE", "The project window changed.");
      const target = { id: randomUUID(), path: filename };
      this.provisional = target;
      return {
        status: "read",
        content,
        backing: { id: target.id, displayName: path.basename(filename) },
      };
    } catch (error) {
      const errno = platformErrorCode(error);
      return openFailure(
        error instanceof ProjectReadLimitError
          ? "FILE_TOO_LARGE"
          : errno === "EACCES" || errno === "EPERM"
            ? "PERMISSION_DENIED"
            : "READ_FAILED",
        "The selected project could not be read.",
      );
    } finally {
      this.busy = false;
    }
  }

  adopt(input: unknown): ProjectTargetResult {
    if (!isProjectTargetId(input)) return openFailure("INVALID_REQUEST", "Invalid project target.");
    if (this.disposed || this.busy || this.provisional?.id !== input)
      return openFailure("TARGET_UNAVAILABLE", "The opened project target is no longer available.");
    // No filesystem work here; only promote the already-authorized capability.
    this.target = this.provisional;
    this.provisional = null;
    return {
      status: "adopted",
      backing: { id: this.target.id, displayName: path.basename(this.target.path) },
    };
  }

  release(input?: unknown): ProjectReleaseResult {
    if (input === undefined) {
      // A lost read reply has no ID at the renderer. Cancel only the pending Open grant,
      // never A's adopted Save capability, including a read still finishing in main.
      this.openGeneration += 1;
      this.provisional = null;
      return { status: "released" };
    }
    if (!isProjectTargetId(input)) return openFailure("INVALID_REQUEST", "Invalid project target.");
    if (this.provisional?.id === input) this.provisional = null;
    // Also handles a successful adoption whose IPC acknowledgement was lost.
    if (this.target?.id === input) this.target = null;
    return { status: "released" };
  }

  async save(input: unknown): Promise<ProjectSaveResult> {
    if (this.disposed) return saveFailure("TARGET_UNAVAILABLE", "The project window is closed.");
    if (this.busy || this.provisional !== null)
      return saveFailure("BUSY", "A project operation is already in progress.");
    if (!isProjectSaveRequest(input))
      return saveFailure("INVALID_REQUEST", "Invalid project save request.");
    this.busy = true;
    const generation = this.generation;
    const current = () => !this.disposed && this.generation === generation;
    try {
      let target = this.target;
      if (input.kind === "saveAs") {
        const chosen = await this.options.chooseDestination(suggestProjectFilename(input.title));
        if (!current()) return saveFailure("TARGET_UNAVAILABLE", "The project window changed.");
        if (chosen === null) return { status: "cancelled" };
        const destination = projectDestination(chosen);
        if (destination === null)
          return saveFailure("TARGET_UNAVAILABLE", "Choose an absolute .folio file destination.");
        // The native dialog confirmed the typed path, not an appended extension.
        if (destination !== chosen && (await destinationExists(destination))) {
          if (!(await this.options.confirmReplacement(path.basename(destination))))
            return { status: "cancelled" };
        }
        if (!current()) return saveFailure("TARGET_UNAVAILABLE", "The project window changed.");
        target = { id: randomUUID(), path: destination };
      } else if (target === null || target.id !== input.targetId) {
        return saveFailure("TARGET_UNAVAILABLE", "The project save target is no longer available.");
      }
      if (target === null)
        return saveFailure("TARGET_UNAVAILABLE", "No project save target is available.");
      await (this.options.write ?? writeProjectAtomically)(
        target.path,
        input.content,
        projectFileSystem,
        current,
      );
      // A close/navigation during rename cannot undo a successful commit. Report
      // that write truthfully, but never grant the next renderer its capability.
      if (current()) this.target = target;
      return {
        status: "saved",
        backing: { id: target.id, displayName: path.basename(target.path) },
      };
    } catch (error) {
      const code =
        error instanceof ProjectWriteError || platformErrorCode(error) !== undefined
          ? mapFileError(error, "write")
          : "UNKNOWN";
      return saveFailure(
        code,
        "The project could not be saved. The backing target was not changed.",
      );
    } finally {
      this.busy = false;
    }
  }
}

export function isProjectSaveRequest(value: unknown): value is ProjectSaveRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys =
    record.kind === "saveAs" ? ["kind", "title", "content"] : ["kind", "targetId", "content"];
  if (
    Object.keys(record).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(record, key))
  )
    return false;
  if (
    typeof record.content !== "string" ||
    record.content.length === 0 ||
    record.content.length > MAXIMUM_PROJECT_BYTES
  )
    return false;
  if (Buffer.byteLength(record.content, "utf8") > MAXIMUM_PROJECT_BYTES) return false;
  return record.kind === "saveAs"
    ? typeof record.title === "string" &&
        record.title.trim().length > 0 &&
        record.title.length <= 1024
    : record.kind === "save" &&
        typeof record.targetId === "string" &&
        /^[0-9a-f-]{36}$/i.test(record.targetId);
}

export function suggestProjectFilename(title: string): string {
  let name = title
    // Windows filenames prohibit control characters as well as these punctuation marks.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .replace(/[. ]+$/g, "");
  if (!name) name = "Untitled Sketch";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  name = name.slice(0, 180).replace(/[. ]+$/g, "");
  return /\.folio$/i.test(name) ? name : `${name}.folio`;
}

export function projectDestination(chosen: string): string | null {
  if (!path.isAbsolute(chosen) || chosen.includes("\0")) return null;
  const extension = path.extname(chosen);
  if (extension !== "" && extension.toLowerCase() !== ".folio") return null;
  const result = extension === "" ? `${chosen}.folio` : chosen;
  // Reject Windows device paths and alternate streams even when returned by a dialog.
  if (
    process.platform === "win32" &&
    (result.startsWith("\\\\?\\") ||
      result.startsWith("\\\\.\\") ||
      path.basename(result).includes(":"))
  )
    return null;
  return result;
}

async function destinationExists(destination: string): Promise<boolean> {
  try {
    await projectFileSystem.lstat(destination);
    return true;
  } catch (error) {
    if (platformErrorCode(error) === "ENOENT") return false;
    throw error;
  }
}
