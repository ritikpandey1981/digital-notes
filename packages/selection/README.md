# @folio/selection

Primary selection and hit testing.

The package exports selection manager/controller contracts, immutable selection
state, coordinate-space types, a configurable `HitTestEngine`, and candidate
strategies for supported object geometry.

It intentionally owns one primary selected identity. Product workflows such as
logical multi-selection, marquee, overlap cycling, clipboard selection, group
bounds, and manipulation coordination live in `@folio/editor`, which projects its
final identity into this package.

## Document dependency

Hit testing depends on `@folio/document`, and does so at runtime rather than only
in types: it distinguishes Ink from vector objects and measures distance against
their real geometry — stroke sample points, and line, rectangle and ellipse
paths. Deciding what the pointer is over cannot be done without knowing the shape
of the thing, so the dependency is the design rather than a leak.

It has no History, rendering, or React dependency, and it holds no document
state: objects are supplied by the caller for the duration of a query.

## Flow

```text
pointer + coordinate mapper + object source
  -> SelectionController
  -> HitTestEngine
  -> SelectionManager
  -> immutable SelectionState
```

## Rules

- Keep History, rendering, and React dependencies out.
- Treat coordinate spaces explicitly.
- Keep hit results deterministic.
- Exclude product workflow from the primary-selection state.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#selection-manipulation-and-editing).
