# Phase 16.5 — Sketchbook UI Foundation

## Product direction

Folio's editor workspace is a canvas-first digital sketchbook: a calm, professional drawing desk with a warm light sheet of paper and quiet controls around it. Free sketching, drawing practice, and learning remain the primary direction; visual and handwritten notes remain a secondary use. This phase establishes presentation and workspace boundaries only. It does not add editor features.

## Scope

Phase 16.5 changes the active Electron workspace shell, tool presentation, contextual-panel lifecycle, and shared visual tokens. The existing document, renderer, History, selection, manipulation, clipboard, viewport, serialization, and persistence owners remain unchanged.

## Workspace hierarchy

The active layout is:

1. a compact top bar;
2. one full remaining workspace region owned by the existing editor and canvas host;
3. a floating five-tool dock on the left;
4. contextual tool and selected-shape surfaces;
5. a bottom-left Context Hint and bottom-right viewport control.

`CanvasSurface` remains mounted inside `CanvasHost`. `CanvasController` continues to measure the available host through its existing resize path and remains the authoritative viewport owner.

## Removed permanent sidebar

The old permanent sidebar no longer participates in the active sketching workspace layout. It exposed placeholder navigation and notebook/recent data that was not required for the current canvas workflow. Its source and unrelated shell logic were not deleted, but it contributes no width, empty rail, or remount key to the active workspace. The full-width office-style menu and full-width StatusBar presentation were removed from the active composition for the same reason.

## Minimal top bar

The top bar contains restrained real identity (`Folio` and `Sketching workspace`), actual History-backed Undo and Redo controls, and a secondary workspace menu for the existing theme and Appearance dialog. Undo and Redo availability comes from the mounted History controller's immutable state. Existing keyboard shortcuts are unchanged.

The left identity region carries a private future-page-drawer boundary. It is not navigation and exposes no fabricated pages, library, or back destination.

## Tool Dock

The compact vertical dock exposes only working tools, grouped as:

- Select
- Pen, Highlighter, Eraser
- Shapes

Subtle separators preserve these families. Inactive tools use neutral icon color, hover uses the semantic surface-hover token, and the active tool uses the shared muted-violet accent treatment. Hit areas, buttons, accessible names, keyboard focus, and the global tooltip system remain intact.

Pencil, Marker, Layers, Reference, AI, Text, Image, Table, and other future tools are not exposed.

## Tool-settings interaction

An inactive Pen or Highlighter click activates the tool immediately without opening settings; clicking the active tool toggles its registered contextual panel. Shapes keeps category activation separate from subtype arming: activating the category opens its chooser but leaves drawing disabled, choosing Line/Rectangle/Ellipse arms that subtype and closes the chooser, and returning from another tool requires an explicit subtype choice again. Clicking active Shapes toggles the chooser. Outside pointer-down and Escape dismiss contextual panels, and switching tools closes the previous panel.

Pen, Highlighter, and Shape settings retain their independent existing owners and values. Native Pen/Highlighter color input still uses the shared animation-frame coalescer before a normal preset update. Selected-shape color input still uses the same coalescer before the existing document and History update path.

## StatusBar decomposition

The full-width StatusBar is no longer rendered in the active workspace. Real responsibilities moved to independent presentation components:

- the existing Context Hint registry/provider renders in a subtle bottom-left surface;
- the authoritative viewport snapshot and action bridge render in a compact bottom-right `− / percentage / +` control.

The viewport menu retains presets, Actual Size, Fit Page, Fit Width, and the visible Space + Drag, Ctrl + Wheel, and Wheel / Trackpad shortcut reference. Its existing Radix dismissal and focus behavior is preserved.

## Visual tokens and surface language

The existing CSS-variable and Tailwind token system was extended rather than duplicated. Key semantic concepts include:

- `--folio-workspace` and `--folio-paper-surround`;
- `--folio-topbar`;
- `--folio-surface`, `--folio-surface-muted`, `--folio-surface-hover`, and `--folio-surface-active`;
- `--folio-border`;
- `--folio-ink` and `--folio-muted`;
- `--folio-accent`, `--folio-accent-hover`, `--folio-accent-soft`, and `--folio-selection`;
- `--folio-shadow-floating` and `--folio-shadow-quiet`;
- the existing page presentation tokens.

The primary light appearance maps those semantics to a very light neutral-gray workspace, white mostly-solid surfaces, soft neutral borders, and the muted indigo/violet accent. A future/alternate dark appearance can map the same semantic concepts without changing components. Floating interactive UI has a thin border, restrained shadow, moderate 10–14 px radii, and no heavy glass blur. Tooltips remain the softer auxiliary layer; dialogs remain the strongest layer.

Inter and Lucide remain the sole general UI font and icon system. Changed controls follow a compact 4/8/12/16-oriented rhythm. Existing 100–180 ms interaction motion remains limited to hover, tooltips, contextual content, and panels; canvas drawing, manipulation, pan, and zoom receive no decorative delay.

## Page and selection presentation

The very light neutral-gray workspace and restrained page border/shadow distinguish the existing warm light paper while preserving more breathing room around it. Page dimensions, document coordinates, viewport coordinates, renderer ordering, and export/document semantics were not changed. The paper presentation remains `#fffdf8`; no paper color was added to `PageObject` or persistence.

`ShapeEditingToolbar` retains its existing controls, document/History update path, live real stroke-color presentation, collision-aware placement, and edge fallback. The shared surface language refines its presentation without changing selection geometry or hiding rotation/resize handles.

## Accessibility

Controls remain semantic buttons with accessible names independent of tooltip content. Focus-visible rings use the Folio accent. Tooltip accessibility and activation suppression remain global. Radix menus retain arrow-key navigation, Escape dismissal, focus restoration, and selection behavior. Tool-panel and viewport-menu Escape handling remain available. Undo/Redo, drawing, editing, viewport, and Space-drag keyboard shortcuts are unchanged.

## Preserved architectures

Phase 16.5 does not change:

- `PageObject`, `ObjectCollection`, object factories, immutable replacement, ordering, or z-index semantics;
- the unified compositor, page canvas, transient overlays, or render ordering;
- History commands, transactions, manipulation commits, or selected-shape style History;
- selection, manipulation, transform-preview, collision, or hit-testing systems;
- authoritative `CanvasController.viewport` ownership or coordinate semantics;
- clipboard, serialization, persistence, or ink-only Eraser semantics;
- frame-coalesced native color inputs.

## Future architectural slots

The shell marks a zero-width internal right utility-rail boundary and a top-bar page-drawer boundary so later work does not need to replace the workspace root. These are nonvisual architecture markers only. Layers, Reference, AI Coach, Library, page thumbnails, and page navigation are not implemented.

## Non-goals

No professional brushes, Pencil, Marker, new color system, layers, references, guides, lasso, multi-select, non-uniform transforms, selected-Ink inspector, lessons, Library, Text, Images, persistence integration, or AI system was added.

## Regression coverage

Automated coverage verifies the five-tool shell and absence of future tools; one-time canvas mounting and resize; live History-backed top-bar controls; active-tool panel activation/toggle/outside/Escape/switch behavior; independent tool settings and frame-coalesced color input; Context Hint priority; compact viewport menu and navigation; shape creation/editing/color/selection/rotation/collision; tooltip/modal stacking; and existing editor, document-order, clipboard, History, viewport, and manipulation behavior.

The real Electron screenshot scenario captures:

- default sketchbook workspace;
- Pen active with settings open;
- Shapes active before subtype choice;
- Rectangle selected, drawn, and showing its Context Hint;
- the viewport menu and navigation shortcuts.

## Manual QA

The actual packaged-layout Electron renderer was exercised at 1440×900 and practical smaller sizes through the regression suite. The workspace, dock, settings lifecycle, rapid color input paths, drawing tools, vector selection and toolbar, viewport controls/menu/pan/zoom/resize modes, context hints, menu dismissal, and Undo/Redo were checked. The generated screenshots were visually inspected for layout, hierarchy, collisions, page dominance, and control reachability.

## Verification results

Final Phase 16.5 results:

- `pnpm format:check`: passed;
- `pnpm lint`: passed with zero warnings;
- `pnpm typecheck`: passed across all workspace packages;
- `pnpm test`: 91 files and 666 tests passed;
- `pnpm build`: passed; the pre-existing renderer chunk-size advisory remains;
- `pnpm test:e2e`: 17 Electron scenarios passed without retries;
- `git diff --check`: passed;
- `pnpm package`: passed and produced the Windows unpacked application at `release/win-unpacked`.
