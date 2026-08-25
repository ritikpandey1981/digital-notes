# Phase 18A — Color Model & Workspace State

## Scope

Phase 18A establishes the model, state, ownership, and committed-artwork boundaries for Phase 18. It intentionally adds no Quick Color Rail, shared picker, Favorites controls, palette selector, Eyedropper, theme-color changes, persistence, or selected-Ink editing.

## Canonical artwork color

Artwork colors cross one editor boundary, `normalizeArtworkHex`, which delegates to the Document package's existing `normalizeHexColor` validation. The canonical representation is a lowercase six-digit RGB Hex literal with a leading hash: `#rrggbb`.

- `#fff`, `FFFFFF`, and `#FFFFFF` normalize to `#ffffff`.
- Three- and six-digit RGB Hex are accepted at ingress.
- Alpha-bearing Hex, CSS names, HSL, theme variables, malformed values, and non-finite channel values are rejected.
- Stored artwork representation is unchanged.

## RGB and HSV

The pure editor conversion module supports Hex ↔ RGB, RGB ↔ HSV, and Hex ↔ HSV.

- RGB channels are validated integers in `[0, 255]`.
- Hue is finite and normalized into `[0, 360)`.
- Saturation and value are finite values in `[0, 1]`.
- Grayscale RGB converts with deterministic hue `0`.
- HSV-to-RGB channels use deterministic integer rounding.
- Picker-session hue memory is deliberately not part of this global model.

## Color and opacity

Color and opacity remain separate properties. Recent colors, Favorites, and palettes store RGB Hex only. Highlighter opacity is not encoded in a palette color, and identical Hex values deduplicate regardless of artwork opacity.

## Recent Colors

Recent Colors are global runtime usage memory with these semantics:

- capacity: exactly 10;
- representation: canonical `#rrggbb` strings;
- order: most recently used first;
- identity: Hex only;
- reuse: remove the previous occurrence and move the color to the front;
- immutable snapshots;
- no document History, PageObject ownership, clipboard transfer, or palette reordering.

Current Tool Settings remains visually unchanged and displays only the first five Recent colors.

### Accepted usage triggers

Recent is updated only after:

1. a Stroke is successfully committed, using the stored `InkObject.stroke.style.color`;
2. a Line, Rectangle, or Ellipse is successfully committed, using the stored vector `style.strokeColor.hex`;
3. a selected-vector continuous or direct style command successfully commits a net stroke-color change, using the final stored vector color.

Recent is not updated for previews, intermediate native-input values, width-only edits, opacity-only edits, cancelled edits, net-no-op recolors, Undo, Redo, delete, eraser, hover, or palette selection. Undoing, deleting, or erasing artwork does not remove its color because Recent records usage rather than current document inventory.

## Authoritative committed-object sourcing

`CanvasSurface` now reports color usage from the immutable object stored in its active `ObjectCollection` immediately after a successful execute operation. `CanvasHost` no longer infers artwork color from the currently active drawing tool. The generic History notification remains responsible only for History availability.

## Favorites

Favorites are global runtime editor preferences:

- canonical Hex only;
- stable user-controlled order;
- addition appends;
- duplicate addition is a no-op;
- removal preserves remaining order;
- usage does not reorder Favorites;
- immutable snapshots;
- no History, PageObjects, clipboard, or persistence.

A defensive maximum of 256 colors prevents pathological runtime state. Normal use should not encounter this limit.

## ColorPalette

`ColorPalette` contains only:

- stable non-empty `id`;
- non-empty `name`;
- ordered canonical `colors`;
- `source`: `built-in`, `user`, or `lesson`.

Palette definitions and color arrays are frozen. Empty/malformed palettes, invalid sources, duplicate catalog IDs, and duplicate colors after canonicalization are rejected. Duplicate-color rejection is the deterministic V1 policy. Palette data contains no theme references, opacity, brush IDs, document IDs, tags, folders, sharing metadata, or History metadata.

## Built-in palette catalog

The built-in catalog contains exactly three palettes:

### `basic` — Basic (`built-in`)

`#111111`, `#4b5563`, `#2563eb`, `#4f46e5`, `#9333ea`, `#db2777`, `#dc2626`, `#ea580c`, `#ca8a04`, `#16a34a`

This is the authoritative source for the existing fixed swatches. `EDITOR_PRESET_COLORS` remains only as a compatibility alias to this palette's color array.

### `sketch` — Sketch (`built-in`)

`#343434`, `#6b4f3a`, `#8b5e3c`, `#b08968`, `#d4a373`, `#c9ada7`, `#6b705c`, `#3f4e4f`, `#5f6f94`, `#9a8c98`

### `monochrome` — Monochrome (`built-in`)

`#000000`, `#111111`, `#343434`, `#4b5563`, `#6b7280`, `#9ca3af`, `#d1d5db`, `#f3f4f6`, `#ffffff`

## Active palette and runtime palettes

The explicit default palette ID is `basic`; array position is not used as the default contract. Changing `activePaletteId` changes only the palette preference that Phase 18B may display. It does not change any brush, Shape creation, or selected-object color.

Runtime user palettes support deterministic caller-provided IDs and immutable add, replace, and remove operations. A removed active user palette falls back to `basic`. Runtime lesson-source palettes may be supplied as read-only definitions and explicitly selected. No durable-looking palette UI or random ID generation is present.

## Workspace Color System ownership

The existing `EditorColorSystem` now owns:

- Recent Colors;
- Favorites;
- built-in plus runtime palette definitions;
- `activePaletteId` and the resolved active palette.

It does not own current Pencil, Pen, Marker, Highlighter, Shape creation, selected-vector, selected-Ink, or theme colors.

## Creation-tool ownership

- Pencil, Pen, Marker, and Highlighter retain independent `ActiveToolState` validated through `createEditableColor`.
- Shape creation retains independent `ShapeToolState`.
- Shape color ingress now normalizes immediately through `normalizeArtworkHex`; invalid input throws without changing the previous valid state.
- Creation preference changes remain outside document History.

## Selected-vector and selected-Ink ownership

Selected vectors remain owned by their `VectorPageObject` and edited through `ContinuousVectorStyleEdit`, with immutable previews, at most one final History command, exact Undo/Redo, and zero-command cancellation. Successful net recolors contribute only the final stored color to Recent and never modify `ShapeToolState`.

Selected Ink remains non-editable in Phase 18 and is deferred to Phase 20.

## Color target handoff

`@folio/editor` exposes the lifecycle-oriented `ColorTargetAdapter` contract (`getCurrentColor`, `begin`, `preview`, `commit`, and `cancel`). Concrete active-tool and selected-vector adapters are deferred to Phase 18B because Phase 18A has no shared picker consumer. This avoids an unexercised abstraction while fixing the lifecycle contract before UI work.

## Persistence, History, serialization, and clipboard

Favorites, Recent, palettes, and active-palette selection are runtime editor preferences only. They do not enter document History, artwork serialization, notebook metadata, legacy persistence, or clipboard payloads. PageObject, InkObject, Stroke/brush snapshot, EditableStyle, and canonical object ordering representations remain unchanged.

## Verification coverage

Focused tests cover conversion vectors and invalid values; palette validation/catalog immutability; Recent capacity/MRU/Hex identity; Favorites order/capacity; active/runtime palettes; all creation-tool ownership boundaries; Shape canonical ingress; committed Stroke/vector sourcing; selected-vector commit/cancel/no-op/Undo/Redo Recent semantics; existing native controls; and Electron-level creation/recolor Recent behavior.

## Phase 18B handoff

Phase 18B may consume the active palette, Favorites, Recent, conversion helpers, canonical ingress, and `ColorTargetAdapter` contract to build the Quick Color Rail and shared picker. It must retain creation-target-only rail semantics, selected-vector continuous History, selected-Ink deferral, and theme/artwork separation.
