# Phase 16 — Viewport

## Scope

Phase 16 adds zoom, pointer-anchored zoom, wheel and drag panning, Fit Page, Fit Width,
Actual Size, live StatusBar controls, mode-aware resize, and synchronized editor overlays. It is
an integration phase over the existing rendering viewport primitives.

## Architecture and ownership

`CanvasController.viewport` is the only authoritative viewport. That `Viewport` owns the only
`Camera`; the renderer, `CoordinateConverter`, selection/manipulation coordinate mappers, and all
overlay renderers retain references to it.

The editor publishes an immutable `EditorViewportSnapshot` containing only `zoom`, `mode`, and the
authoritative camera limits. React retains the latest snapshot for presentation. React does not own
camera position, viewport dimensions, page transforms, or mutable rendering objects.

```text
StatusBar or canvas input
  -> ViewportActions
  -> CanvasController
  -> CanvasController.viewport / Camera
  -> base invalidation + editor overlay synchronization
  -> immutable EditorViewportSnapshot
  -> React presentation
```

## Viewport action boundary

`ViewportActions` is editor-owned and session-bound. It exposes zoom in/out, direct zoom, Actual
Size, anchored zoom, viewport-pixel pan, Fit Page, and Fit Width. Desktop controls request actions
through this interface and never mutate `Camera` directly. Actions are released when
`CanvasSurface` unmounts.

## View modes

- `manual`: entered by direct zoom, Actual Size, pointer zoom, controls, wheel pan, Space-drag, or
  middle drag. Resize preserves the camera position, which preserves the world point at the
  viewport center.
- `fit-page`: centers the page in both axes and applies the existing fit padding. Resize recomputes
  the fit without changing mode.
- `fit-width`: uses the existing 56-pixel horizontal gutters, centers the page horizontally, and
  places its top at the existing 88-pixel workspace margin. Resize recomputes both the horizontal
  scale and that top policy without changing mode. Vertical wheel/drag panning leaves fit mode and
  remains available.

All zoom paths clamp through the rendering camera's 25%–800% limits. Actual Size sets zoom to 1 at
the viewport-center anchor and enters manual mode. The shared editor preset policy is 25%, 50%,
75%, 100%, 125%, 150%, 200%, 300%, 400%, and 800%; continuous wheel input may produce intermediate
values.

## Coordinate spaces and zoom semantics

Pointer input continues through the canonical chain:

```text
client CSS -> logical canvas -> viewport -> world -> page
```

`CoordinateConverter` accounts for CSS/logical scaling. Backing-store DPR is never applied in
editor interaction code. `Viewport.zoomAt` records the world point beneath the viewport anchor,
changes zoom, and corrects the camera so that point remains beneath the anchor. Document geometry
is always committed in page coordinates and is independent of zoom.

The editor selection adapter converts its existing 2-pixel ink and 6-pixel vector tolerances to
page units using the live zoom. This keeps practical selection targets screen-stable without
changing the selection engine, state machine, or document geometry. Manipulation and line handles
already use live zoom for screen-stable targets.

## Pan and modifier policy

- `Ctrl+wheel` (including Chromium pinch events represented this way) performs anchored zoom and
  prevents browser page zoom.
- Wheel/trackpad input without Ctrl pans using both `deltaX` and `deltaY` and prevents browser page
  scroll. Delta modes are normalized to logical viewport pixels.
- Space temporarily shows `grab`; Space plus left drag shows `grabbing`, captures the pointer, and
  pans before active-tool dispatch.
- Middle drag always captures and pans before active-tool dispatch.
- Pointer up, cancellation, lost capture, window blur, and unmount clear transient pan state. If
  Space is pressed during an existing editor gesture, that gesture keeps ownership until it ends.
- Alt remains reserved for overlap selection. Shift remains available to shape constraints. Space
  on editable controls is not intercepted.

Transient pan cursor state preserves and restores the current desktop/tool/manipulation cursor. It
does not create or persist a Hand tool.

## Fit and resize calculations

Fit calculations use `Viewport.size`, never window dimensions. Fit Page uses the minimum of usable
width and height ratios, clamps through `Camera`, and centers the page. Fit Width uses usable width
only, clamps through `Camera`, centers page width, and solves camera Y so page viewport Y equals the
top padding.

The controller starts in `fit-page`; its first non-zero resize preserves the established initial
fit. Later resize behavior is mode-specific: preserve camera position in manual mode, recompute Fit
Page, or recompute Fit Width. DPR changes use the same policy.

## Rendering and invalidation

Every controller viewport change invalidates the persistent renderer and enters one
`CanvasSurface` synchronization path. That path redraws or recalculates:

- persistent page and unified ordered ink/vector compositor
- live ink
- manipulation preview
- shape-creation preview
- selection overlay and handles
- vector hover, line handles, and endpoint preview
- selected-shape toolbar anchor
- drawing preview scale
- serialized page/camera diagnostics
- StatusBar snapshot

React snapshot publication is coalesced to one animation frame. `CanvasSurface` and the document
collection are not remounted or rebuilt during viewport interaction.

## History and document invariance

Viewport operations call only rendering/controller APIs. They do not create commands,
transactions, `PageObject` replacements, or `ObjectCollection` changes. Undo/Redo depth therefore
does not change for zoom, pan, fit, Actual Size, resize, wheel input, or transient drag panning.

The unified persistent compositor and canonical document ordering are unchanged.

## UI

The StatusBar's former literal zoom placeholder is now a compact minus/percentage/plus group. The
percentage is formatted from the published snapshot. Its menu uses the existing dropdown primitive
and exposes shared presets, 100% Actual Size, Fit Page, and Fit Width with a lightweight current-mode
indicator. The existing Saved and page-count placeholders are unchanged.

## Tests and manual QA

Rendering tests cover camera/viewport fit math, zoom clamping, anchored zoom, pan, inverse
conversions, and all resize modes. Editor tests cover transformed selection/manipulation mapping,
shared zoom policy, and screen-stable hit tolerance. Electron scenarios cover live controls,
anchored Ctrl+wheel, all pan inputs, cursor/pointer state, resize policy, History invariance,
drawing and constrained shapes after transforms, overlap selection, overlay state, line handles,
object invariance, and ink-only erasing.

Manual QA follows the same matrix in both the built development artifact and packaged Electron app,
including floating-widget dismissal, Tool Dock, tooltips, Context Hints, and shape-toolbar placement.

## Explicit non-goals

This phase does not change document contracts, serialization, History, clipboard, persistence,
selection/manipulation state machines, page count/Saved placeholders, slider History granularity,
or bundle splitting. It does not add snapping, smart guides, advanced shape styling, text, images,
or any Phase 17 work.
