# @folio/persistence

Versioned folder persistence for the older `@folio/domain` Notebook model.

## Implemented capabilities

- deterministic Notebook serialization and validated deserialization;
- normalized folder paths and file layout;
- atomic writes through a file-system adapter;
- load/save pipelines with typed errors;
- dirty tracking and autosave scheduling;
- recovery metadata, detection, and recovery;
- compatibility/version checks.

The package is testable through an injected `FileSystemAdapter`; production exports
include the Node adapter.

## Important boundary

The live desktop editor uses `@folio/document` `SketchbookDocument`. This package
serializes the older `@folio/domain` Notebook and is not connected to the mounted
editor session. It does not yet provide durable round trips for live Pages, Layers,
vectors, or Ink source samples.

Do not describe placeholder desktop file dialogs as working persistence. Do not extend
both models in parallel. A versioned live format and migration/replacement decision are
required first.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#persistence-boundary),
[`../../docs/DECISIONS.md`](../../docs/DECISIONS.md#d-014--legacy-persistence-remains-isolated-pending-migration),
and [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md#now--make-the-live-sketchbook-durable).
