# @folio/history

Command-based undo/redo for Folio, with a generic live-editor surface and a retained
legacy Notebook surface.

## Generic editor History

`EditorCommand<TDocument>` applies and reverts immutable document state through a
`HistoryDocumentSession<TDocument>`. The manager owns bounded undo/redo command stacks,
execution state, notifications, and non-nested transactions. A controller provides the
UI-facing boundary.

Commands validate document meaning; History remains model-neutral. A transaction
commits as one grouped entry or rolls back to its starting document. Failed execution
must not corrupt either stack.

Preview state is not stored as a History snapshot. Editors retain the original,
preview immutable successors, and execute one original-to-final command at commit.

## Legacy compatibility

`HistoryManager`, snapshot commands, Notebook/Page/Section commands, and the dirty-sink
adapter serve `@folio/domain` and `@folio/persistence`. They remain exported for
compatibility but are not the live `SketchbookDocument` editor path.

## Rules

- One logical user operation yields one logical entry.
- Undo/redo uses exact immutable states captured by commands.
- Session state and UI preferences do not enter document History.
- Never specialize the generic subtree with editor or document imports.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#history).
