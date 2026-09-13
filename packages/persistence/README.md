# @folio/persistence

Two formats, deliberately separate.

## `@folio/persistence/project` — the live format

The versioned `folio-project` v1 codec for the live `SketchbookDocument`. This is
what the desktop app saves and opens as `.folio`, and what its crash-recovery
snapshots carry.

- deterministic encoding and validated, bounded decoding;
- Pages, Layers, vector objects and Ink source samples, round-tripped exactly;
- project metadata, including the logical title a document is known by;
- typed `FolioProjectCodecError` for every refusal.

The codec is pure: it takes and returns a document and a string. Choosing a file,
writing it and holding a handle to it all belong to the desktop app, which keeps
paths in the Electron main process and hands the renderer opaque capability ids.

## `@folio/persistence` — the legacy format, compatibility only

Versioned folder persistence for the older `@folio/domain` Notebook model:
serialization and deserialization, normalized folder paths, atomic writes through
an injected `FileSystemAdapter`, load/save pipelines with typed errors, dirty
tracking, autosave scheduling, recovery metadata, and version checks. Production
exports include the Node adapter.

It is not connected to the mounted editor session and will not be. It is kept so
existing Notebook data stays readable.

## Boundary

`@folio/document` `SketchbookDocument` is the live artwork authority, and
`.folio` is its canonical format. Do not connect the live editor to the folder
format, do not extend both models in parallel, and do not introduce a third
canonical model.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#persistence),
[`D-023`](../../docs/DECISIONS.md#d-023--folio-is-the-canonical-platform-neutral-project-format)
and [`D-014`](../../docs/DECISIONS.md#d-014--legacy-folder-persistence-remains-isolated).
