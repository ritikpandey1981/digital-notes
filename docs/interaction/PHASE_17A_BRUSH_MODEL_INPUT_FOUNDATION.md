# Phase 17A — Brush Model & Input Foundation

## Current baseline

Phase 17A preserves the existing native pointer pipeline:

```text
CanvasSurface
→ PointerInputController
→ page-space normalization
→ StrokeBuilder
→ existing live StrokeRenderer
→ immutable Stroke
→ InkObject
→ one AddStrokeCommand
→ ObjectCollection
→ unified compositor
```

Pen and Highlighter continue to use the accepted centerline renderer. Coalesced PointerEvents,
mouse fallback pressure, pen/touch pressure, runtime timestamps, tilt, twist, altitude/azimuth,
viewport conversion, History, clipboard, transforms, and Eraser behavior remain in place.

## Preset and state separation

`packages/ink` now defines an immutable, validated, versioned `BrushPreset`. `packages/editor`
owns a static catalog and a separate `ActiveToolState` for each implemented family.

Changing color, size, opacity, or smoothing replaces only the relevant active-state snapshot. It
does not replace or mutate the selected catalog definition. Pen and Highlighter maintain separate
state. Pencil and Marker exist only as semantic `BrushFamily` values and have no runtime editor
state or UI in Phase 17A.

The former `createPenPresetStore` and `DEFAULT_PEN_PRESETS` public names are compatibility aliases
to the same brush catalog/state implementation. There is no second preset system.

## BrushPreset schema

```text
BrushPreset
  id
  version
  name
  family
  defaults
    color
    size
    opacity
    smoothing
  dynamics
    pressureSize
    pressureOpacity
  renderer
    version
    kind: centerline | outline
```

Definitions are cloned, validated, and deeply frozen by `createBrushPreset`. The Phase 17A Pen
and Highlighter definitions all resolve to `centerline`; `outline` is only a strategy identity for
the Phase 17B contract and has no implementation here.

Color remains mutable tool state. A preset's color is only its initial default, so selecting or
editing a tool does not mutate catalog data.

## ActiveToolState

```text
ActiveToolState
  family
  presetId
  color
  size
  opacity
  smoothing
```

The editor store retains one immutable active-state successor for Pen and one for Highlighter.
Shapes remain in their existing independent state architecture. Tool preference changes do not
enter document History.

## Resolved brush snapshot

At pointer-down, the active preset and active overrides resolve into a
`ResolvedBrushSnapshot`:

```text
schemaVersion
presetId
presetVersion
family
color
size
opacity
smoothing
dynamics
renderer
```

The snapshot is validated, deeply frozen, and stored on the immutable `Stroke`. It is independent
of later tool-state or catalog changes. Current `StrokeStyle` remains alongside it as the exact
compatibility projection consumed by the accepted Phase 17A renderer. New production brush
definitions treat the resolved snapshot as the durable brush-behavior source; Phase 17B will make
shared preview/final geometry consume the new dynamics contract directly.

## JSON-safe dynamics

Pressure behavior is declarative:

```text
enabled
minimumFactor
maximumFactor
curve
  kind: linear | power
  exponent
```

The same representation is available separately for pressure-to-size and future
pressure-to-opacity behavior. It contains no callbacks, DOM values, `Map`, `Set`, or class state.
Versions and required values are explicit and finite. `evaluatePressureResponse` provides the
deterministic evaluator.

Current Pen pressure-size dynamics retain factors `0.5` through `1.5` with a linear curve. Current
Highlighter pressure-size dynamics remain disabled. Pressure-opacity is present but disabled and
does not change Phase 17A rendering.

## Legacy pressureCurve boundary

`StrokeStyle.pressureCurve` remains temporarily supported for existing direct ink-package
consumers and tests. No Phase 17A production preset uses it, and it is never copied into a
`BrushPreset` or `ResolvedBrushSnapshot`. Legacy callback strokes continue to render from their
`StrokeStyle`; new production brush metadata uses the JSON-safe dynamics model. Removing the
legacy callback is a later compatibility decision, not a Phase 17A renderer change.

## Stationary input policy

The previous builder discarded every same-position sample. Phase 17A separates process input from
render geometry:

- `Stroke.sourceSamples` retains meaningful immutable source input.
- `Stroke.points` remains the duplicate-free derived geometry used by existing renderers.
- Source timestamps remain runtime-relative numbers.
- The terminal pointer sample is always retained.

A same-position source sample is retained when any of these deterministic conditions holds:

- at least 16 ms has elapsed since the last retained source sample;
- normalized pressure changes by at least 0.01;
- `tiltX`, `tiltY`, or circular twist changes by at least one degree;
- optional altitude/azimuth changes by at least 0.01 radians or appears/disappears;
- pointer type, button, or buttons changes;
- the sample is the terminal pointer lifecycle sample.

The 16 ms dwell interval corresponds approximately to one 60 Hz frame and bounds identical-event
spam to about 63 retained samples per stationary second. Pressure and orientation thresholds
filter device noise while preserving deliberate stationary dynamics. Geometry receives no
zero-length duplicate segments.

Stroke duration now uses the first and last retained source timestamps. Geometry metrics and
statistics remain derived from render points. A ten-thousand-event stationary stress test verifies
one render point and no more than 626 retained process samples.

## Compatibility and visual non-regression

- Current Pen defaults, colors, sizes, opacity, and linear pressure-width behavior are unchanged.
- Current Highlighter defaults, opacity constraints, pressure-disabled behavior, source-over
  compositing, and overlap behavior are unchanged.
- The old inert multiply value was not migrated into rendering and remains inactive.
- Production input smoothing remains `none`; the snapshot records ownership only.
- The professional final-path fitter and the known preview/final pressure mismatch are unchanged.
- The Tool Dock contains no Pencil or Marker.
- Current cursor, Shapes, Eraser, selection, manipulation, viewport, and shell behavior are
  unchanged.

## Architecture preservation

Phase 17A makes no structural change to PageObject identity, InkObject lifecycle,
ObjectCollection, canonical ordering, immutable replacement, History commands, clipboard,
selection, manipulation, viewport ownership, coordinate conversion, unified compositing, or
persistence. Brush metadata follows the immutable Stroke through History, duplication, and
transforms automatically.

No Ink persistence adapter was added. The new brush contracts are JSON-safe preparation for that
future integration only.

## Tests

Coverage includes:

- BrushPreset validation, versioning, deterministic resolution, deep immutability, and JSON safety.
- Linear/power declarative pressure evaluation.
- Active state independence, switching, no-op updates, and preset non-mutation.
- Resolved snapshot stability after tool-state changes.
- Source pressure, timestamp, tilt, twist, terminal timing, coalesced input, spam bounds, and long
  stroke/stationary performance sanity.
- Stroke metadata preservation through History, clipboard duplication, rotation, and scaling.
- Pen/Highlighter style and resolved metadata at the Electron diagnostics boundary.
- Absence of Pencil/Marker UI and preservation of existing Eraser, undo/redo, Shapes, and shell
  coverage.

## Verification

The Phase 17A handoff completed the required verification:

- `pnpm format:check`: passed.
- `pnpm lint`: passed with zero warnings.
- `pnpm typecheck`: passed across all workspace projects.
- `pnpm test`: 93 files and 681 tests passed.
- `pnpm build`: passed; Vite retained its existing non-blocking large-chunk warning.
- `pnpm test:e2e`: 17 Electron tests passed.
- `git diff --check`: passed.
- `pnpm package`: passed and produced the Windows unpacked application.

## Phase 17B handoff

Phase 17B may build on the resolved dynamics and renderer identity to make live and final pressure
geometry agree. Phase 17A does not implement outline geometry, change the final path fitter, add a
renderer strategy implementation, or alter visible stroke behavior.
