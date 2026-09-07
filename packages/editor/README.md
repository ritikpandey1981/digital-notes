# @folio/editor

Application orchestration for Folio's live sketchbook editor.

## Responsibilities

- Mount `CanvasSurface` and connect document, History, rendering, input, selection, and
  manipulation controllers.
- Implement `InkDocumentSession` for `SketchbookDocument` plus active-page,
  active-layer, and per-page viewport session state.
- Adapt manipulation and editing outcomes into immutable document commands.
- Coordinate page, layer, stroke, vector-style, transform, and lifecycle History.
- Own editor-local multi-selection, marquee, overlap cycling, clipboard, shortcuts,
  context menu, measurements, and creation drafts.
- Provide tool registry, drawing-slot state, brush presets, property descriptors, color
  conversion, palettes, color targets, and sampling helpers.

## Mutation boundary

```text
UI/input -> editor action -> command/coordinator -> History -> document successor
```

The editor may install immutable preview state during an active gesture. Commit must
produce one logical command; cancel restores the retained original. Creation-tool
preference changes remain History-free. Selected vector and Ink style edits use the
continuous-edit boundary.

## Selection and clipboard

`@folio/selection` remains the low-level primary-selection authority. This package adds
an ordered logical identity set for multi-selection and projects its final identity to
the primary controller.

The clipboard is session-only and stores ordered immutable PageObject references. Copy
does not enter History. Cut, paste, duplicate, and delete group object commands in one
transaction. Paste creates fresh identities and uses a common 20-page-unit offset per
paste ordinal. There is no operating-system clipboard integration.

## Color

Artwork color is canonical lowercase RGB hex. Current color belongs to the active
creation or selection target. `EditorColorSystem` owns only recents, favorites, palette
definitions, and active-palette selection. Picker and eyedropper behavior goes through
`ColorTargetAdapter` begin/preview/commit/cancel.

## Public surface

The package exports `CanvasSurface`, editor viewport/page/layer actions, color and
palette models, drawing slots and presets, property/tool registries, selected-Ink style
helpers, marquee/selection helpers, and selected rendering/History utilities.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) and
[`../../docs/design/drawing-tool-system.md`](../../docs/design/drawing-tool-system.md).
