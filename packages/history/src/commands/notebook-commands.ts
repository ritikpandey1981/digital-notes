import { renameNotebook, updateNotebookMetadata } from "@folio/domain";
import type { Notebook, NotebookMetadataPatch } from "@folio/domain";
import type { Command, CommandFactoryOptions } from "../command";
import { createSnapshotCommand, resolveCommandMetadata } from "../internal/snapshot-command";

export function createRenameNotebookCommand(
  notebook: Notebook,
  name: string,
  options: CommandFactoryOptions = {},
): Command {
  const metadata = resolveCommandMetadata(options, `Rename notebook to "${name}"`);
  const after = renameNotebook(notebook, name, {
    createId: metadata.context.createId,
    now: () => metadata.timestamp,
  });
  return createSnapshotCommand({
    before: notebook,
    after,
    category: "notebook",
    metadata,
    affectedTargets: [{ kind: "metadata" }],
  });
}

export function createUpdateNotebookMetadataCommand(
  notebook: Notebook,
  patch: NotebookMetadataPatch,
  options: CommandFactoryOptions = {},
): Command {
  const metadata = resolveCommandMetadata(options, "Update notebook metadata");
  const after = updateNotebookMetadata(notebook, patch, {
    createId: metadata.context.createId,
    now: () => metadata.timestamp,
  });
  return createSnapshotCommand({
    before: notebook,
    after,
    category: "notebook",
    metadata,
    affectedTargets: [{ kind: "metadata" }],
  });
}
