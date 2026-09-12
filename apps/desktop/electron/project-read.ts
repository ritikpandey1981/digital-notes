import { lstat, open } from "node:fs/promises";

// Desktop transport ceiling mirrors the canonical codec inputBytes limit; a contract test
// prevents drift without importing the model/codec into the sandbox preload or CJS main.
export const MAXIMUM_PROJECT_BYTES = 256 * 1024 * 1024;
export class ProjectReadLimitError extends Error {}

/** Validate the opened handle, then bound every read too: a file can grow after stat. */
export async function readDesktopProject(filename: string): Promise<string> {
  const entry = await lstat(filename);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Not a regular project file.");
  if (entry.size > MAXIMUM_PROJECT_BYTES) throw new ProjectReadLimitError();
  const handle = await open(filename, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Not a regular project file.");
    if (stat.size > MAXIMUM_PROJECT_BYTES) throw new ProjectReadLimitError();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAXIMUM_PROJECT_BYTES - total + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAXIMUM_PROJECT_BYTES) throw new ProjectReadLimitError();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } finally {
    await handle.close();
  }
}
