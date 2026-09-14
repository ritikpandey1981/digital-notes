# @folio/ink

Immutable stroke capture, brush resolution, ink geometry, and Canvas 2D stroke
rendering.

## Data model

A versioned immutable `BrushPreset` resolves with session overrides into a
`ResolvedBrushSnapshot`. Each committed `Stroke` retains that exact snapshot and exact
useful source/process samples, including page position, timing, pressure, available
tilt/twist, buttons, and pointer type.

Derived render points, smoothing, fitted cubics, centerlines, outlines, and bounds do
not replace source data. Old strokes therefore do not change when tool settings or
preset definitions change.

## Input

`PointerInputController` accepts the primary mouse, pen, or touch pointer, uses pointer
capture, expands coalesced events, and normalizes coordinates through the supplied
boundary. Mouse pressure defaults to `0.5`.

Cancellation clears transient state without a commit. Covered paths include
`pointercancel`, lost capture, uncaptured leave, tool detach/switch, and window blur.

## Rendering

A stroke names its render strategy durably as `(kind, version)` on its resolved snapshot,
and a static registry resolves that identity to the code that draws it. Three are
implemented:

- `centerline@1` — constant width from one stroke-wide average; frozen;
- `outline@1` — pressure-aware filled silhouette; frozen;
- `technical-pen@1` — deterministic constant-width stroked path.

The two legacy strategies are frozen because saved artwork names them. A strategy whose
appearance must change ships as its next version; an identity this build cannot draw is
refused by name rather than substituted.

Mouse can resolve an expressive preset to centerline behavior because it has fixed
pressure. Technical Pen has no pressure response to downgrade. Tilt and twist are retained
but do not currently influence rendering.

Technical Pen evaluates incrementally: geometry behind a settled watermark is computed once
and reused, so a live frame costs the open tail rather than the stroke, and a stroke looks
the same while it is drawn as it does once committed. The frozen strategies still rebuild
per frame.

Active rendering is frame-coalesced while useful source samples are preserved.
Committed geometry is cached by immutable Stroke identity and object scale with bounded
scale variants. Viewport zoom is not an object scale and does not rewrite the pressure
silhouette.

Very long strokes on the frozen strategies can exceed a 60 Hz frame near completion.
Optimize only from profiling evidence and preserve live/final parity and source data.

## Public surface

The package exports brush creation/resolution, Stroke and StrokeBuilder,
PointerInputController, smoothing and rendering, visual/bounds helpers, and shared
types.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#input-and-ink).
