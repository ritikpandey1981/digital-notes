# Phase 18C — Favorites & Palette Experience

## Product semantics

Folio keeps three deliberately separate color collections:

- **Active palette** is an intentionally ordered set of working colors. The Quick Color Rail shows this collection.
- **Recent** is a ten-color MRU sourced only from colors committed to artwork.
- **Favorites** is an explicitly saved, stable-order list. Adding appends, selecting does not reorder, and removing preserves the relative order of the remaining colors.

The same canonical `#rrggbb` value may appear in all three collections. Deduplication occurs only within each collection according to its own rules.

## Ownership and target interaction

`EditorColorSystem` remains the workspace owner of Favorites, Recent, available palettes, and `activePaletteId`. `FullColorPicker` consumes immutable snapshots and invokes workspace actions; it does not own preference data.

The Current card exposes a restrained star action. Its accessible label includes the canonical color and whether the action adds or removes it. Favorite changes are immediate workspace-preference operations with zero document History and zero Recent mutation.

Selecting a Favorite previews it through the picker’s existing `ColorTargetAdapter`. Creation targets remain History-free. Line, Rectangle, and Ellipse continue through `ContinuousVectorStyleEdit` and produce at most one History command on commit. Shape defaults and brush-family preferences remain isolated from selected vectors.

Favorites are not part of the picker target transaction. If a user previews a color, favorites it, and presses Escape, the target returns to its original color while the explicit Favorite remains.

## Picker composition

Favorites appears after Recent and before Palette. Empty Favorites uses a small subdued “No favorites yet” state. Up to 20 Favorites use the normal compact grid. Larger lists retain every item and stable order in a two-row, internally scrollable region, preventing picker growth beyond the viewport.

Selecting a Favorite synchronizes Current, SV, Hue, Hex, and RGB. Removal stays intentionally simple: select the Favorite and toggle Current’s star. No delete control or context menu is added to every swatch.

## Palette experience

The compact selector continues to expose the built-in Basic, Sketch, and Monochrome palettes as keyboard-accessible radio menu items. Each item has a restrained inline swatch preview, and the active palette retains its semantic checked state.

Switching palettes updates the Quick Color Rail immediately. It does not change Current, Previous, Favorites, Recent, creation-tool state, Shape state, or History. Built-in canonical colors remain unchanged. User-palette CRUD is not exposed.

## Quick Color Rail

The Rail remains the fast creation-color surface: Current, active-palette swatches, and More Colors. Favorites and Recent are intentionally absent so the Rail retains stable spatial muscle memory.

## Accessibility and focus

The Current star is a real button with `aria-pressed`, a canonical add/remove label, visible focus, and keyboard activation. Favorite and palette swatches remain buttons with canonical Hex labels. The palette selector preserves Up/Down, Enter, Escape, checked-state semantics, and focus restoration through the existing floating-owner hierarchy.

The picker’s existing trigger focus restoration, target invalidation, owned dropdown dismissal, and canvas-first-click ordering are unchanged.

## History, Recent, and performance

Favorite add/remove is not document History. Selecting a Favorite is only a target preview. It enters Recent only after drawing commits that color or a selected-vector recolor commits it. Palette switching and Favorite management do not request compositor redraws; only a target preview may change artwork presentation.

## Persistence limitation

Favorites, `activePaletteId`, and runtime user palettes are currently session/editor preference state and are **not durable across application restarts**. This is a known product limitation and must be resolved by workspace/user preference persistence before user-palette CRUD is exposed. No localStorage, notebook metadata, PageObject data, or filesystem shortcut is used.

Future preference persistence must support:

- ordered Favorite Hex values;
- `activePaletteId`;
- ordered user `ColorPalette` definitions;
- optional last-picker state only if a later product decision justifies it.

Recent should likely persist eventually as a workspace/user preference because it represents useful working continuity, but persistence is not required for Phase 18 correctness and is not implemented here.

## Tests and handoff

Unit coverage verifies canonical Favorite state, append/remove stability, duplicate handling, the bounded large-list policy, palette isolation, zero Recent mutation, and cancel-plus-Favorite semantics for creation and selected-vector targets. Electron coverage verifies the complete Pencil, Rectangle, cancel, History, Recent, keyboard palette, focus, responsive, and visual workflows.

Phase 18D may add the Eyedropper. Phase 18C adds no pixel sampling, shortcut, selected-Ink editing, user-palette CRUD, or persistence.
