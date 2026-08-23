# Post-Phase-16 Stabilization

## Scope

This pass corrects five accepted Phase 16 follow-up issues without beginning Phase 17 or the sketchbook UI redesign: tooltip activation behavior, Shapes crosshair initialization, transform-preview cleanup, manual-pan page recovery, and viewport-navigation discoverability.

## Observed problems and root causes

### Tooltip lifecycle and surface

The shared tooltip anchor tracked hover and focus, but activation was not part of its state. Clicking a focused, hovered tool therefore left the tooltip visible. The tooltip also reused `folio-floating-surface`, giving auxiliary text the same opaque glass and strong shadow as interactive widgets.

The shared `ToolTooltip` lifecycle now has independent hover and focus suppression. Pointer activation or click hides the active tooltip immediately. Hover suppression resets on pointer leave; focus suppression resets on focus out. A new hover entry or later focus entry may show the tooltip again. This remains one portal/provider implementation, preserves accessible button names, and keeps the tooltip layer non-interactive. Its dedicated surface uses a softer translucent fill, border, blur, and shadow while retaining readable text.

Stacking remains:

1. dialogs at z-index 1100;
2. the global tooltip portal at z-index 1000;
3. floating editor UI;
4. canvas layers.

### Shape crosshair initialization

Shapes previously supplied only the native CSS `crosshair` keyword. Folio therefore had no owned initial color and Chromium/Windows could initially present a white native cursor before its adaptive presentation settled.

The desktop cursor policy now supplies a hard-coded black SVG crosshair as the initial Shapes fallback. The first canvas pointer movement returns presentation to the existing native `crosshair` path, preserving adaptive platform contrast. Selecting Line, Rectangle, or Ellipse reinitializes the black fallback. Shape stroke color is not consulted.

### Transform rendering smear

The committed document and persistent compositor were already correct. Finalized mixed PageObjects are rendered on the base page canvas, whose renderer clears the full viewport before every requested repaint. Manipulation previews are rendered separately on the transparent `manipulation-preview` overlay.

The preview renderer incrementally cleared transformed dirty bounds. Ink and vector preview visuals compensate line width by dividing it by object scale before the canvas transform, keeping the painted stroke width stable. Dirty-bound calculation instead scaled an already stroke-inflated rectangle. During scale reduction this underestimated the painted footprint, allowing pixels from earlier, larger preview frames to survive. Terminal `setPreview(null)` cleared only the final underestimated rectangle. A viewport change called `redraw()` on every overlay and full-cleared the preview canvas, which is why zoom removed the artifact.

Incremental old/new bounds remain in use during pointer movement. Transitioning from an active preview to no preview now escalates to one full clear of the transparent preview layer. This happens once at commit or cancellation, not on every pointer move. The persistent base canvas still performs its scheduled unified PageObject repaint, preview caches remain scoped as before, and the existing History command executes exactly once.

## Viewport recoverability

`Viewport` owns one centralized page-recovery policy. Manual pan, cursor-anchored zoom, page-rect changes, and resize all enforce it after applying their intended camera change. `CanvasController` remains the authoritative action boundary, so wheel/trackpad, Space + Drag, middle drag, and programmatic `panBy` share the policy.

The minimum visible page extent is **64 CSS pixels per axis**. This sits inside the requested 48–96 pixel range: it is large enough to recognize and grab without materially reducing free canvas positioning. For each axis the effective amount is the minimum of 64 pixels, viewport size, and scaled page size. It is converted to world units by dividing by camera zoom before camera limits are calculated. Repeated pan at a boundary is idempotent. Fit Page and Fit Width still calculate their own positions; a manual resize preserves camera position unless the new size would violate recovery.

## Navigation discoverability

The Context Hint registry now contains a generic `Tip: Hold Space + Drag → Move canvas` fallback. Exact tool and shape hints resolve first, preserving Select, Rectangle, and Ellipse guidance. The fallback is available only while a shell-session teaching flag is unlearned. A real Space + Drag that changes camera position reports successful use once and suppresses the generic hint for the rest of the process session. The flag is React/editor presentation state only; it does not enter PageObject, History, or persistence.

The existing viewport menu adds a non-interactive **Navigation shortcuts** reference for:

- Move canvas — Space + Drag
- Pan — Middle Drag
- Zoom — Ctrl + Wheel
- Scroll — Wheel / Trackpad

The compact reference stays inside the existing menu, leaving the canvas and StatusBar uncluttered. Zoom presets, Actual Size, Fit Page, and Fit Width remain actionable as before.

## Eraser intentional non-change

The Eraser remains ink-only. It erases ink strokes and skips Line, Rectangle, and Ellipse. Stroke Eraser, Object Eraser, partial/brush Eraser, and any broader future erasing architecture remain deferred product design.

## Tests

- Tooltip Electron coverage verifies hover, activation dismissal, continued-hover suppression, leave/re-entry, keyboard recovery, stale-tooltip cleanup, pointer non-interference, the softer surface marker, and dialog/tooltip/widget stacking.
- Cursor policy tests verify the black fallback is independent of Shape color; Electron coverage verifies fallback initialization for shape subtypes and return to the native adaptive path.
- Transform-preview unit coverage deterministically requires a full canvas clear when a strongly reduced preview ends. Electron coverage scales a rendered ink object down to 20%, proves the preview contains pixels while active, and proves the entire overlay is transparent after commit, undo, and redo.
- Viewport tests cover extreme pan in every direction and diagonally at 25%, 100%, 200%, and 800%, resize recovery, and repeated-boundary stability. Existing Electron gestures cover wheel, Space, and middle pan; added assertions cover recovery and navigation learning.
- Context Hint tests verify generic fallback priority and session availability. Viewport-menu Electron coverage verifies all shortcut text and retained fit/actual-size actions.
- Existing ink-only Eraser regressions remain unchanged and green.

## Manual QA

The built Electron application was exercised at 1440×900 and the captured tooltip/Context Hint presentation was visually inspected. The tooltip reads as a smaller, softer auxiliary bubble while remaining legible above the Pen options palette; the generic navigation hint fits the existing StatusBar allocation without moving canvas UI. The Electron interaction passes also inspected the live Shapes fallback/adaptive cursor phases, full manipulation-preview pixel buffer after strong scale reduction and Undo/Redo, page extents after extreme pan, and all viewport-menu shortcut labels. The freshly packaged executable remained alive during a five-second smoke launch.

## Verification

- `pnpm format:check` — passed.
- `pnpm lint` — passed with zero warnings.
- `pnpm typecheck` — passed across all 14 workspace projects with typecheck scripts.
- `pnpm test` — 90 files and 648 tests passed.
- `pnpm build` — passed; the existing bundle-size advisory remains for the approximately 729 kB renderer chunk.
- `pnpm test:e2e` — all 15 Electron scenarios passed in the final normal no-retry run.
- `git diff --check` — passed.
- `pnpm package` — passed and produced `release/win-unpacked/Folio.exe` plus `resources/app.asar`.

One earlier focused tooltip run failed because the test tried to focus an already-focused, intentionally suppressed target. The fixture was corrected to move focus away and back; its isolated rerun and the later full suite passed. This was not retried or classified as environmental flakiness.

## Explicit non-goals

This pass does not change PageObject, ObjectCollection, serialization, canonical document order, History, clipboard, selection or manipulation state machines, viewport ownership, persistence, tool layout, drawing-tool architecture, notebook navigation, Eraser semantics, or the future sketchbook product design.
