# Pre-Phase-18 Hardening

## Scope and outcome

This corrective pass addresses the independent review findings that blocked Phase 18 without beginning the Color & Palette System. It adds a continuous vector-style edit boundary, stabilizes `CanvasSurface` lifetime against callback identity churn, replaces a one-off portal exception with explicit floating-widget ownership, centralizes editor-chrome text-selection policy, and moves normal E2E screenshots out of tracked documentation paths.

No selected-Ink editing, color-picker feature work, persistence integration, renderer redesign, Layers work, or dependency cleanup is included.

## Pre-change History reproduction

The defect was reproduced in the real Electron application before code changes:

- Creating one Rectangle produced Undo depth `1`.
- One selected-Rectangle Width drag with 30 intermediate values produced Undo depth `31`.
- The single gesture therefore added exactly 30 commands.

The former path was:

`ShapeEditingToolbar` → `ContinuousSlider.onChange` → `EditorWorkspace` shape-style callback → `ShapeEditingActions.updateStyle` → `CanvasSurface` → `EditorHistoryCoordinator.executeVectorStyleUpdate` → `createUpdateVectorStyleCommand` → History execution → immutable `ObjectCollection.replace`.

Frame coalescing on selected-shape color reduced presentation traffic but did not define a History gesture, so it did not solve this correctness problem.

## Continuous-edit lifecycle

`ContinuousVectorStyleEdit` is a small package-private editor boundary for one selected vector style. It intentionally is not Shape-widget state and is not a generalized editing framework.

The lifecycle contract is:

1. `begin` retains the exact original immutable vector object.
2. `update` creates same-identity immutable replacements and installs them for live presentation without executing History commands.
3. `commit` restores the retained original at the document boundary, then executes one existing original-to-final vector-style command.
4. `cancel` restores the original object and emits no command.

Undo consequently restores the exact pre-gesture style and object revision; redo restores the exact committed final style. Existing History manager, command, notification, and `ObjectCollection` replacement behavior remain in force. Intermediate commands are not hidden inside a transaction.

Selected-vector Width, Opacity, and native Color input now use this lifecycle. Color samples remain latest-value-per-animation-frame for presentation throughput, and the coalescer exposes explicit `flush` and `cancel` operations so the final sample cannot escape the gesture boundary.

Active Pencil, Pen, Marker, and Highlighter properties remain editor/tool preference state and create zero document History entries.

### Input boundaries

- Range pointer down/up forms one gesture.
- Pointer cancellation cancels.
- Arrow and Shift+Arrow keydown/keyup form one deliberate keyboard gesture.
- A wheel event is one explicit adjustment and one command for a selected vector.
- Numeric focus/edit/blur or Enter is one command.
- Accessibility or programmatic range changes without pointer/key lifecycle are treated as one discrete adjustment.

No timer-based merging is used.

### Interruption policy

Escape is an explicit cancel: restore the original and add no History entry. The safest consistent cancel policy is also used for pointer cancellation, window blur, selection change, selected-object deletion, tool switch, palette/section dismissal, and component or canvas unmount. Successful interaction completion alone commits. No live-preview session survives an interruption.

## CanvasSurface lifecycle audit and correction

Before correction, the main setup effect directly depended on these callback props:

- `onControllerReady`
- `onSelectionControllerReady`
- `onManipulationControllerReady`
- `onToolRegistryReady`
- `onHistoryControllerReady`
- `onDiagnostics`
- `onError`

A changed identity therefore ran the full cleanup and setup again. Cleanup disconnects the theme observer; removes pointer, context-menu, keyboard, and blur listeners; cancels viewport/rotation frames; releases pointer captures; clears readiness handshakes; unsubscribes and destroys selection/manipulation controllers; destroys the tool registry and History coordinator; uninstalls shortcuts; clears clipboard, selection, geometry, and document session state; destroys pointer input, renderers, overlay layers, measurement elements, and finally the canvas controller. The risk was confirmed: arbitrary callback identity could erase the mounted document, History, and clipboard session.

These callbacks already used latest-value refs and did not own setup lifetime: selection change, manipulation change, History change, object-lifecycle readiness, shape-edit readiness/change, viewport-actions readiness, viewport change, and navigation-learning callbacks.

The seven remaining callbacks now follow the same latest-ref ownership pattern. The imperative setup effect is mount-owned with an empty dependency list; the large effect was not split or redesigned. An actual-Electron regression supplies a newly created diagnostics callback on host rerenders, creates document/History/clipboard state, rerenders through a viewport change, proves the same DOM/editor session survives, and then proves a theme diagnostic invokes the latest callback generation.

## Floating-widget dismissal audit and ownership

The prior dismissal hook had special handling for:

- events inside the widget boundary;
- the tool dock, whose button interactions own tool switching/toggling;
- one hard-coded `[data-floating-widget-owned-portal="true"]` preset-menu exception;
- page clicks, which continue to the canvas and dismiss in a microtask;
- workspace-surround clicks, which dismiss and are deliberately swallowed;
- unrelated outside UI;
- Escape when a nested surface has not already handled it.

The hard-coded preset exception is replaced by a per-widget scope:

- the parent publishes `data-floating-widget-scope`;
- any portaled descendant publishes the matching `data-floating-widget-owner`;
- ownership is found through nested owned ancestors, so future picker/popover/menu surfaces reuse the same contract.

The preset menu now carries its parent palette's ownership scope. Owned interaction keeps the palette open, unrelated interaction dismisses it, the nested Radix menu consumes the first Escape and restores trigger focus, a subsequent Escape dismisses the palette, page gestures remain available to drawing, and workspace-surround gestures remain explicitly non-page interaction. Tooltip/dialog stacking is unchanged.

## Chrome text-selection policy

The application shell now provides one semantic `folio-editor-chrome-selection` policy:

- editor chrome inherits `user-select: none`;
- the actual `canvas-surface` returns to `user-select: auto`, preserving future artwork/text PageObject behavior;
- floating surfaces and menus remain chrome;
- `input`, `textarea`, and `[contenteditable="true"]` explicitly use `user-select: text`;
- the global tooltip layer is non-selectable.

This prevents label highlighting during drags without disabling intentional text entry.

## E2E screenshot output

Every screenshot writer was audited. The Phase 17C and post-Phase-17 specs previously wrote normal-run images directly into tracked `docs/interaction/screenshots`. They, the sketchbook capture spec, and the existing shell visual pattern now resolve output as:

`FOLIO_SCREENSHOT_DIR` when explicitly supplied, otherwise Playwright `testInfo.outputPath(...)`.

Conditional follow-up screenshots already target ignored `test-results` paths. Normal `pnpm test:e2e` therefore does not regenerate tracked documentation; an intentional documentation run may set `FOLIO_SCREENSHOT_DIR` to the desired docs directory.

## Shapes verification

The alleged active-Shape-without-subtype state is not reachable in the current implementation. The initial subtype is Rectangle, selecting Ellipse updates the remembered subtype, and switching away/back automatically rearms Ellipse. Actual Electron coverage verifies both the Rectangle default and remembered Ellipse behavior. No Shapes state change was made.

## Explicit deferrals and technical debt

Selected Ink color, width, opacity, and a generalized Selection Context Toolbar remain Phase 20 work. The current generic selection fill may tint selected Ink and the legacy selection outline uses a blue independent of Folio violet; those remain deliberate Phase 18/color-polish decisions. The oriented vector selection frame is unchanged.

Renderer performance findings are recorded without code changes:

- finalized strokes do not have dirty-rectangle culling;
- outline drawing allocates an avoidable `boundary.slice(1)`;
- live smoothed/outline rendering rebuilds full geometry.

These belong to a measured renderer-performance pass after Phase 18 or when profiling justifies it.

The persistence split is also confirmed and deferred:

- the live editor uses `@folio/document` PageObjects;
- `@folio/persistence` still serializes the older `@folio/domain` Notebook/PageObject model;
- durable Ink serialization across that persistence path is absent/incomplete;
- persistence is not connected to the Electron editor session.

A **Document / Persistence Architecture Decision** is required after Phase 18 and before Phase 19 — Layers.

Unused Zustand, dead pre-sketchbook shell code, Framer Motion usage, and the production bundle-size warning are separately recorded cleanup concerns. No dependencies or dead shell components were removed here.

## Architecture preservation

There is no architectural redesign of `PageObject`, `InkObject`, `ObjectCollection`, the History manager/command model, canonical ordering, unified compositor, selection, manipulation, viewport ownership, brush renderer, or persistence. The vector style command exposes its existing immutable replacement helper for preview reuse; final commits still execute that same command architecture.

## Verification

Focused verification completed during implementation:

- continuous vector-style unit tests: width, opacity, color, exact Undo/Redo, cancellation;
- affected vector, post-Phase-17, and professional-brush Electron regressions;
- dedicated hardening Electron regression covering History boundaries, numeric/keyboard/wheel input, active-brush zero-History, callback identity, floating ownership/Escape/focus/page semantics, chrome selection, and Shapes memory;
- production build.

Final verification:

- `pnpm format:check`: passed.
- `pnpm lint`: passed with zero warnings.
- `pnpm typecheck`: passed across all 14 participating workspace projects.
- `pnpm test`: 99 files passed, 779 tests passed.
- `pnpm build`: passed; the previously recorded bundle-size warning remains informational.
- `pnpm test:e2e`: 22 Electron/visual tests passed in the final full run.
- tracked `docs/interaction/screenshots` status: empty before and after the full E2E run.
- `git diff --check`: passed.
- `pnpm package`: passed and produced the unpacked Windows application.
