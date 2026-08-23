# Post-Phase-16 Stabilization Follow-Up

## Scope

This patch corrects four remaining stabilization issues without beginning the Sketchbook Vision/UI phase:

1. Active transform-preview smear.
2. Viewport zoom-menu dismissal.
3. Visible navigation shortcut simplification.
4. Selected-shape toolbar collision avoidance.

PageObject, ObjectCollection, serialization, History, selection/manipulation state machines, viewport ownership, persistent document ordering, persistence, and ink-only Eraser behavior remain unchanged.

## Live transform-preview smear

### Root cause

The manipulation-preview canvas owns a single transient visual. Before this follow-up, every active target change queued the previous and current transformed bounds as dirty page rectangles. On the scheduled frame, those rectangles were mapped into viewport coordinates, padded, cleared, and followed by the latest preview draw.

The bounds did not describe the actual painted footprint during strong scaling:

- Ink supplied an already stroke-inflated source bound.
- Vector previews supplied local geometry bounds.
- The preview transform scaled those bounds.
- Ink and vector visuals divided their stroke width by the final object scale so the displayed stroke footprint remained stable.

During scale-down, the dirty bounds therefore contracted more than the painted stroke. Old and new dirty rectangles were both retained, but neither was a mathematically complete paint bound. Anti-aliased pixels outside those rectangles survived on the manipulation-preview canvas. The same class of defect applied to thick ink, lines, rectangles, and ellipses.

The earlier terminal `setPreview(null)` full clear removed trails after commit/cancel. It could not remove pixels between active frames, which is why smear remained while the pointer was held and disappeared after release or a viewport-driven full redraw.

### Per-frame cleanup policy

`TransformPreviewRenderer` now full-clears its transparent overlay before drawing the latest target on every invalidated renderer frame. `RenderScheduler` still coalesces multiple raw pointer updates into one animation-frame render, so the clear is not executed once per raw pointer event.

This is safer than introducing separate paint-bound calculations for compensated ink and every vector geometry type because:

- the renderer contract contains only one transient target;
- the clear affects only that renderer's transparent overlay;
- the persistent PageObject compositor is not cleared or redrawn;
- React is not remounted;
- caching and History are unaffected.

The cost is one viewport-sized transparent `clearRect` per scheduled active preview frame. This is a bounded, GPU-friendly overlay operation and is acceptable for correctness. Terminal commit/cancel still uses the same full-clear path, leaving the layer transparent after manipulation.

## Viewport zoom-menu dismissal

The StatusBar uses the shared Radix dropdown primitive. Its uncontrolled state, portal, Escape handling, action-selection closing, keyboard navigation, and focus restoration were already correct.

The defect came from editor pointer routes calling `stopImmediatePropagation()` on pointer-down. Radix observes outside pointer-down at the document layer; handled Select, Shape, and Eraser page clicks never reached that listener. The menu therefore remained open. Modal dropdown behavior would also risk consuming the click intended for the editor.

The StatusBar viewport menu is now non-modal, and handled primary editor pointer-downs are allowed to bubble after the editor processes them. Radix performs normal outside dismissal without a canvas-specific document listener. The same pointer-down still begins selection, drawing, shape creation, or Eraser interaction where appropriate. Escape, trigger toggle, presets, Actual Size, Fit Page, and Fit Width use the primitive's native lifecycle.

Viewport pan retains the propagation isolation required to prevent an attached ink input listener from drawing during Space or middle-button pan.

## Navigation shortcut reference

The visible menu now lists only:

- Move canvas — Space + Drag
- Zoom — Ctrl + Wheel
- Scroll — Wheel / Trackpad

The visible `Pan — Middle Drag` row was removed. Middle-button drag remains implemented and covered as an undocumented expert shortcut.

## Selected-shape toolbar collision policy

The old toolbar position used only selection viewport bounds, a fixed 48-pixel toolbar height, and a 12-pixel object-edge gap. Rectangle and ellipse controls extend farther above the object: four pixels of selection padding, a 28-pixel rotation stem/offset, and a 12-pixel clickable handle radius. The old toolbar could therefore intersect the rotation handle and stem.

The toolbar now measures both width and height with its existing `ResizeObserver` and applies a pure viewport-space placement policy. Collision geometry mirrors the screen-stable interaction system:

- Rectangle/ellipse: padded corner hit regions, rotation stem, and rotation-handle hit region.
- Line: conservative endpoint and midpoint hit regions.
- Safety gap: 12 CSS pixels around protected controls.
- Viewport inset: 12 CSS pixels.

Placement order is deterministic:

1. Above all interaction controls.
2. Below the selection and its bottom controls.
3. Left or right when neither vertical region fits.
4. A collision-tested in-viewport fallback for constrained layouts.

All inputs are viewport pixels supplied by the existing immutable presentation snapshot. Zoom and pan therefore require no page-space offsets or second camera. Moving/scaling causes the existing selection snapshot to reposition the same mounted toolbar; measurement occurs only when toolbar dimensions change.

## Deferred work and explicit non-goals

- Non-uniform rectangle/ellipse stretching was not implemented. It remains future **Advanced Selection & Transform** work.
- Side handles, transform-command changes, new scale cursors, and History changes were not introduced.
- Selected ink/stroke editing UI was not implemented. Future work should use a generalized **Selection Context Toolbar / Inspector** rather than independent per-object toolbar architectures.
- Eraser remains ink-only; vector erasing is still deferred product design.
- The Sketchbook Vision/UI redesign has not begun.

## Tests

Unit/presentation coverage includes:

- Full transparent overlay clearing before each coalesced active preview frame.
- Terminal preview cleanup.
- Normal above placement.
- Tall/narrow selection rotation clearance.
- Top-edge below placement and bottom-edge above placement.
- 25% and 200% viewport-space presentations.
- Panned bounds, move updates, scale/side fallback, and line-handle clearance.

Electron coverage includes:

- Thick ink preview growth followed by strong shrink while pointer-down remains active.
- Active-frame pixel bounds contracting without an old silhouette.
- Terminal commit, undo, and redo cleanup.
- Outside workspace and page dismissal without losing the first drawing gesture.
- Escape, trigger toggle, preset, Actual Size, Fit Page, and Fit Width closing.
- Visible shortcut-row cleanup with functional middle-button pan retained.
- Tall/narrow ellipse toolbar clearance and a usable rotation target.

## Manual QA

The focused Electron visual-QA run passed three real application scenarios. The generated renders were manually inspected:

- `test-results/followup-live-transform-preview.png`: pointer remained held after a very thick ink preview grew and then shrank strongly; only the current preview silhouette remained.
- `test-results/followup-viewport-menu.png`: the open menu showed exactly Move canvas, Zoom, and Scroll; no Middle Drag row was visible.
- `test-results/followup-shape-toolbar.png`: the tall narrow ellipse toolbar was below the selection, while the rotation stem and circular handle remained visible and separate.

The same Electron run exercised the rotation target, active preview pixels, outside/page dismissal, Escape, trigger toggle, all viewport actions, Space pan, and middle-button pan. The renderer unit contract is visual-agnostic, so the per-frame full clear applies identically to thick ink, line, rectangle, and ellipse preview visuals and at every viewport zoom/mode.

## Verification

- `pnpm format:check`: passed.
- `pnpm lint`: passed with zero warnings.
- `pnpm typecheck`: passed across 14 workspace projects.
- `pnpm test`: 91 test files and 661 tests passed.
- `pnpm build`: passed; the existing renderer chunk-size advisory remains (`730.33 kB`, `216.82 kB` gzip).
- `pnpm test:e2e`: 16 Electron scenarios passed.
- `git diff --check`: passed.
- `pnpm package`: passed and produced `release/win-unpacked/Folio.exe` and `resources/app.asar`.
- Packaged smoke launch: the built executable remained alive through the five-second smoke window.
