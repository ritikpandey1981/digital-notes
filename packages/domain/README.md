# @folio/domain

Legacy immutable Notebook domain retained for the existing persistence and
compatibility surfaces.

The package exports older notebook, section, page, and object types plus factories,
validation, capabilities, and immutable operations. `@folio/persistence` serializes
this model, and the compatibility History commands still target it.

This is not the live desktop editor's document authority. The current editor uses
`@folio/document` and `SketchbookDocument`.

## Public boundary

The package exposes legacy capabilities, factories, models, immutable operations,
types, validation, and typed errors. Callers should use those operations rather than
mutating model objects.

Its active adjacent owners are `@folio/persistence` for serialization/recovery and the
legacy compatibility exports in `@folio/history`. New sketchbook objects belong in
`@folio/document`.

## Rules

- Keep validation and immutable-operation behavior stable while compatibility is
  required.
- Do not add new live editor features here merely because persistence depends on it.
- Do not connect this model to React as a second editor document.
- A migration or replacement of the on-disk model requires an explicit architecture
  decision and compatibility fixtures.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#persistence-boundary) and
[`../../docs/ROADMAP.md`](../../docs/ROADMAP.md#now--make-the-live-sketchbook-durable).
