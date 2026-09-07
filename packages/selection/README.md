# @folio/selection

Low-level, model-neutral primary selection and hit testing.

The package exports selection manager/controller contracts, immutable selection state,
coordinate-space types, a configurable HitTestEngine, and candidate strategies for
supported object geometry.

It intentionally owns one primary selected identity. Product workflows such as
logical multi-selection, marquee, overlap cycling, clipboard selection, group bounds,
and manipulation coordination live in `@folio/editor`, which projects its final
identity into this package.

## Flow

```text
pointer + coordinate mapper + object source
  -> SelectionController
  -> HitTestEngine
  -> SelectionManager
  -> immutable SelectionState
```

## Rules

- Keep document, History, rendering, and React dependencies out.
- Treat coordinate spaces explicitly.
- Keep hit results deterministic.
- Exclude product workflow from the primary-selection state.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#selection-manipulation-and-editing).
