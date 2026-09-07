# @folio/manipulation

Model-neutral object manipulation sessions and results.

The package calculates translation, rotation, scale, delete, and duplicate outcomes.
Results form an exhaustive discriminated union and contain the information an adapter
needs to perform a domain mutation; this package does not know `SketchbookDocument`,
PageDocument, Layers, History, React, or rendering.

## Flow

```text
pointer lifecycle
  -> ManipulationController / ManipulationManager
  -> translation, rotation, or scale engine
  -> ManipulationResult
  -> @folio/editor adapter
  -> document command and History
```

The editor builds group manipulation by coordinating several package results inside
one History transaction. That does not make logical multi-selection a responsibility
of this package.

## Rules

- Keep results immutable and exhaustive.
- Keep coordinate mapping outside; inputs must state their coordinate space.
- Cancellation yields no document mutation.
- Add a manipulation family here only when it can remain model-neutral.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#selection-manipulation-and-editing).
