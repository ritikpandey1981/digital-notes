# Pre-Phase-16 Correctness Patch

## Scope

This patch corrects four confirmed editor-foundation defects before viewport work begins:

1. Shapes previously received the active Pen drawing style.
2. Context Hints could resolve only a top-level tool and could not distinguish Shape subtypes.
3. The global tooltip layer (`z-index: 1000`) could appear above true dialogs (`z-index: 50`).
4. Eraser deleted the topmost selectable object, including vector shapes.

Phase 16 has **not** begun. Camera, Viewport, CoordinateConverter, persistence, and the static
Page/Zoom status presentation remain unchanged.

## Implemented behavior and ownership

### Independent Shape preset

`useEditorWorkspaceState` now owns a desktop-session Shape tool state beside the existing
Pen/Highlighter preset store. The state contains the active Shape subtype and an independently
owned creation style with explicit defaults:

- stroke color `#111111` (black);
- stroke width `2`;
- opacity `1`;
- pressure disabled.

Canvas creation receives this style only while Shapes is active. Pen and Highlighter continue to
resolve through their existing independent presets. Switching tools does not recreate any preset.

The existing Shape editing toolbar represents both selected-object appearance and the future Shape
creation preset. A toolbar change therefore updates the workspace Shape preset as transient tool UI
state and independently invokes the existing `ShapeEditingActions.updateStyle` path. The selected
object still changes immutably through the existing vector-style History command. The preset itself
does not enter `PageObject`, `ObjectCollection`, serialization, clipboard, or History.

### Context Hint resolution

`ContextHintRegistry.resolve` now accepts `{ tool, shapeKind? }`. Registrations may be general to a
tool or exact to a Shape subtype, with a general-tool fallback. `activeShape` moved from local
`EditorWorkspace` state into the workspace tool-state owner, leaving one source of truth for the
Shapes widget, Canvas host, and StatusBar context.

The registry contains exactly these relevant hints:

- Select: `Tip: Alt + Click → Select object beneath`
- Shapes + Rectangle: `Tip: Hold Shift → Draw a perfect square`
- Shapes + Ellipse: `Tip: Hold Shift → Draw a perfect circle`

Line has no new hint. StatusBar remains a generic presentation consumer and contains no
Rectangle/Ellipse resolution logic.

### Tooltip and dialog stacking

The shared Radix dialog primitive now centrally assigns true dialog overlay and content layers a
modal stacking level of `1100`. The global editor tooltip portal/provider remains unchanged at
`1000`; floating toolbars and widgets remain at `20`. Dropdown stacking was not changed.

The effective hierarchy is now modal dialog/overlay, tooltip, floating toolbar/widget, canvas
interaction overlays, then persistent page content.

### Ink-only Eraser

The eraser now asks a package-internal eligibility selector for the first visible, unlocked,
not-already-erased `InkObject` in the existing topmost-first candidate list. It skips line,
rectangle, and ellipse candidates, so ink beneath a vector remains reachable. General selection
hit-testing, overlap ordering, vector selection/deletion, and z-order behavior are unchanged.

The existing eraser transaction remains intact: one pointer gesture begins one transaction, eligible
whole-stroke deletions execute inside it, and commit/rollback plus undo/redo behavior are unchanged.

## Regression coverage

Focused tests cover:

- explicit black Shape defaults and immutable Shape tool-state successors;
- Shape color/width/opacity and subtype persistence;
- independence from mutated Pen and Highlighter presets;
- exact Select/Rectangle/Ellipse hint resolution and Line/Pen/Highlighter absence;
- immediate context transitions without StatusBar subtype conditionals;
- eraser traversal past line/rectangle/ellipse candidates to eligible ink;
- rejection of hidden, locked, and already-erased ink;
- Electron paths for independent tool styles, successive shapes, selected-shape History depth,
  tooltip-over-widget/toolbar stacking, dialog-over-tooltip stacking, tooltip recovery and pointer
  transparency, overlap erasing, one-gesture History depth, undo/redo, and normal shape deletion.

## Verification

The final task verification runs, in order:

1. `pnpm format:check`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`
6. `pnpm test:e2e`
7. `git diff --check`
8. `pnpm package`

Results on 2026-08-22:

- formatting passed;
- lint passed with zero warnings;
- all workspace typechecks passed (the sandboxed attempt hit Windows `spawn EPERM`; the identical
  permitted rerun passed);
- unit tests passed: 89 files and 633 tests;
- the production build passed with the existing 716.08 kB renderer chunk advisory;
- all 13 Electron scenarios completed successfully under Playwright retry protection: 11 passed on
  their first attempt and 2 existing scenarios passed on retry after transient foreground-pointer
  or rendered-order misses; the new correctness scenario remained first-attempt green, and the
  initially missed unchanged pointer scenarios also passed when rerun in isolation;
- `git diff --check` passed;
- Windows packaging passed and produced `release/win-unpacked/Folio.exe`.

## Explicit non-goals and retained debt

This patch does not address the editor/persistence model split, static Page/Zoom status values,
ContinuousSlider History granularity, resize/pan behavior, zoom-sensitive hit tolerances, or the
renderer bundle-size advisory. It adds no advanced Shapes features and makes no viewport,
serialization, document-model, clipboard, manipulation, or rendering-order redesign.
