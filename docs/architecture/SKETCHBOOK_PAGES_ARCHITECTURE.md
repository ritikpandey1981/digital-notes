# Sketchbook Pages Architecture

Status: **IMPLEMENTED IN PHASE 21**
Scope: sketchbook/page hierarchy, page geometry, paper, page History, and page session state

This record documents what Phase 21 built. It extends, and does not replace,
`DOCUMENT_LAYERS_ARCHITECTURE_DECISION.md`.

## Hierarchy

```text
SketchbookDocument            @folio/document
  pages[]                     ordered, first page first
    Page
      id                      stable identity
      name                    optional label
      geometry                width / height in page-space units
      paper                   type, color, spacing
      content: PageDocument   layers[] + ObjectCollection
```

Every page owns one independent `PageDocument`, so Layers, canonical flattened
order, and `PageObject` values are per-page by construction. No artwork is shared
between pages. `PageObject` gained neither `pageId` nor `layerId`.

## Page order

Page order is array position, first page first, matching the order the user sees
in the navigator. There is no separate page index or z-order field, mirroring the
Layer decision.

## Geometry

`PageGeometry` is `{ width, height }` in page-space units and is authoritative
document state. **Orientation is always derived** (`width < height` → portrait,
`width > height` → landscape, equal → square); no second orientation field exists
that could disagree.

Presets are A4, A5, US Letter, Square, and Screen, plus Custom. Rectangular
presets swap dimensions for landscape; Square does not pretend to have an
orientation. Custom extents are validated to a finite range and reject NaN,
Infinity, zero, and negative values.

`DEFAULT_PAGE` in `@folio/rendering` remains only the renderer's construction
fallback. The live page rectangle now always comes from the active `Page` via
`CanvasController.setPage`.

**DPI is deliberately absent.** Page dimensions are the document's own coordinate
system; physical resolution is an export/print concern and is deferred to that
phase rather than stored as unused metadata.

## Page resize semantics

Resizing a page changes the page boundary only. `PageObject` geometry, `Stroke`
`sourceSamples`, transforms, and layer ordering are all untouched, and
`Page.withGeometry` returns the same `content` reference to make that explicit.

Artwork that ends up outside a shrunken page is **never deleted**; it is retained
and clipped by the existing page-clipped compositor. Page Settings shows a
restrained inline notice rather than a blocking dialog.

## Paper

Paper is page state: `{ type, color, spacing? }` with types blank, ruled, grid,
dotted, and isometric. Paper is not a `PageObject`, not a Layer, not a reference,
and not editor theme. It renders below every Layer, is clipped to page bounds,
and never participates in selection, hit testing, or erasing. It does not snap or
constrain strokes — interactive guides remain a later phase.

Pattern coordinates are page-anchored, so zooming magnifies the same physical
paper rather than holding a constant screen-space spacing. Below roughly two
screen pixels of spacing the pattern is skipped rather than drawn as an
imperceptible mass of primitives.

Paper color is page state and is independent of application appearance, the
active brush color, the Quick Color Rail, and Recent artwork colors. It is edited
through a dedicated control, not the artwork `ColorTargetAdapter`.

## History

`TDocument` for editor History is now `SketchbookDocument`. Existing page-scoped
commands were **not rewritten**: `liftPageCommand` wraps one
`EditorCommand<PageDocument>` into the sketchbook document and captures the
target page identity at creation time, so undo and redo always reach the page the
user actually edited even after switching pages.

One coherent History stack covers both levels. Sketchbook-level commands (add,
duplicate, remove, reorder, geometry, paper, rename) act directly on
`SketchbookDocument`.

| Action | History |
|---|---|
| Page resize, orientation, preset | +1 |
| Paper type, paper color commit | +1 |
| Add / Duplicate / Delete / Reorder page | +1 |
| Switch active page | **0** |
| Per-page active layer switch | **0** |
| Per-page viewport change | **0** |
| Selection change | **0** |

Continuous paper-color editing previews outside History and commits once, using
the same lifecycle as Phase 18 vector color and Phase 19 layer opacity.

## Session state

The following are editor/session state owned by `InkDocumentSession`, keyed by
page identity, and never enter History or page serialization:

- `activePageId`
- each page's active layer
- each page's camera (zoom and position)

Deleting the active page falls back to the next page, then the previous, resolved
by identity rather than array index. Page switching cancels any active transform,
style edit, marquee, or contextual edit and clears the selection so nothing leaks
between pages.

## Thumbnails

Page thumbnails are a runtime editor concern, never document state. They are
drawn by `renderPageThumbnail`, which reuses the same per-object draw helpers as
the live compositor so previews cannot drift from the canvas. Redraw is driven by
an explicit revision counter incremented on committed document changes, so a
stroke in progress never repaints the navigator.

## Known limits

The camera's 0.25 minimum zoom means an extreme banner page (roughly wider than
four times the viewport) cannot be fully shown by Fit Page. Ordinary presets and
reasonable custom sizes are unaffected.
