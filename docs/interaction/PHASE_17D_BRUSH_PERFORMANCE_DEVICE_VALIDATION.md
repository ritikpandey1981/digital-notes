# Phase 17D — Brush Performance & Device Validation

## Status

Phase 17D validates and locally hardens the accepted Phase 17A–17C professional brush system. It does not add brush features, presets, rendering modes, or persistence behavior.

**PHASE 17 — PROFESSIONAL BRUSH SYSTEM COMPLETE.**

The measured renderer remains the accepted architecture:

```text
PointerEvent
→ coalesced sample batch
→ normalization and page conversion
→ immutable source/process retention
→ render-point construction
→ frame-coalesced active geometry
→ transient canvas presentation
→ one immutable Stroke and one History command on commit
```

## Baseline and profiling methodology

The audit combined source tracing, deterministic unit instrumentation, workload sanity tests, and one Electron scenario. Timings below are local single-run observations from the development machine, not universal budgets and not claims about physical stylus hardware.

- Synthetic input rates: 60, 120, and 240 samples per second, grouped into 60 scheduled frames.
- Geometry loads: 100, 1,000, 5,000, 10,000, and 25,000 points.
- Smoothing loads: 0%, 25%, and 100%.
- Renderer strategies: centerline and outline.
- Committed documents: 100, 500, and 1,000 short outline strokes.
- Zoom: 25%, 50%, 100%, 200%, 400%, and 800%.
- DPR reasoning/tests: 1, 1.5, and 2.
- Electron stress: 240 cursor events, sustained active drawing, 22 committed strokes across all four families, cancellation, rapid settings/color changes, ten Undo/Redo cycles, all zoom presets, and a multi-stroke eraser gesture.

Timing assertions use generous sanity ceilings so slower CI machines are not treated as product regressions.

## Pre-change hot-path findings

### Input and allocations

`PointerInputController` expands `getCoalescedEvents()` and preserves every useful sample. Before correction, each sample independently called `getCanvasBounds()`, which reached `getBoundingClientRect()` in `CanvasSurface`.

An accepted moving sample creates or retains:

- screen, canvas, viewport, world, and page coordinate values;
- a normalized frozen `StrokePointInput`;
- a retained raw/source input reference;
- a frozen delta and derived `StrokePoint` with velocity/acceleration;
- current bounds, center, dirty rectangle, and `StrokeUpdate`;
- renderer dirty-rectangle unions.

Raw and source arrays share the same frozen raw point. `Stroke.points` stores the derived render point separately. A stationary duplicate does not create duplicate render geometry; it is retained only when centralized timing, pressure, tilt, twist, button, or terminal thresholds say the process sample is useful.

### Active geometry

Zero-smoothing centerlines append only the new segment. Smoothed centerlines and outlines rebuild the complete current professional path once per scheduled frame. A full build creates source-reference/progress arrays, optional coordinate-only smoothed points, filtered points/progress, fitted cubics, and either centerline bounds or outline centerline/boundary/join data.

The full build is approximately linear. Very long active outline strokes can exceed one 60 Hz frame near the end, but the measured behavior remained bounded and usable enough to preserve exact live/final semantics. No worker, WebGL, point-model, or renderer rewrite was justified.

### Cursor

The brush cursor is imperative. It has no pointer-position React state. Before correction it read the outer host bounds and wrote cursor style/diagnostics for every native pointer move.

### Committed redraw/cache

The unified document compositor caches a `StrokeVisual` by immutable `Stroke` identity and object scale. The ink renderer separately holds the fitted path in a `WeakMap` and bounds outline geometry to eight scale entries. Viewport zoom is a canvas transform; it does not become an outline-cache scale and does not mutate canonical geometry.

The compositor's outer per-stroke scale map was previously unbounded even though the inner outline cache was bounded.

## Corrections and before/after evidence

### Coalesced event-batch bounds

- Problem: one layout read per coalesced sample.
- Reproduction: pointer down, one 240-sample coalesced move, and one following move.
- Change: resolve canvas bounds once for the synchronous native event batch and pass that immutable value to every sample normalization.
- Before/after: 242 bounds resolutions → 3. The next native event resolves fresh bounds, so no geometry survives a layout change.

### Frame-coalesced cursor work

- Problem: sustained cursor movement performed host bounds reads and style writes at raw event rate.
- Reproduction: 240 synchronous Electron mouse pointer moves.
- Change: retain only the latest primitive screen position and present it imperatively on the next animation frame.
- Before/after: 240 host bounds reads → at most 2 in the Electron assertion (one presentation frame in the observed run). No React state was introduced.

### Frame-coalesced renderer diagnostics

- Problem: renderer `data-*` diagnostics were rewritten on every accepted sample even though pixels were frame-coalesced.
- Reproduction: 241 accepted live points before flushing the scheduled frame.
- Change: keep in-memory counters synchronous and publish DOM diagnostics from the rendered frame/lifecycle checkpoints.
- Before/after: 3,615 dataset assignments (241 × 15 fields) → 0 before the frame and 15 after it.

### Bounded compositor scale ownership

- Problem: the outer `StrokeVisual` scale map could retain every historical object scale.
- Reproduction: render one stroke at scales 1 through 9 and revisit scale 1.
- Change: use the same eight-entry FIFO bound as the renderer outline cache.
- Before/after: unbounded scale ownership → at most 8 visuals per live `Stroke`; revisiting the evicted scale produces the expected tenth outline build.

### Window-blur cancellation

- Problem: pointer cancel/lost capture were handled, but the input controller did not independently observe its owning window losing focus.
- Reproduction: start a pen stroke and dispatch blur on the target window.
- Change: attach/remove one window blur listener with the canvas lifecycle and cancel active buffers through the existing lost-capture path.
- Before/after: active builder could depend on a later platform capture event → immediate transient cleanup with no commit.

No professional path, smoothing, outline, brush preset, pressure curve, or historical rendering policy was changed.

## Input-rate observations

| Synthetic rate | Samples processed | Scheduled frames | Geometry builds | Final render points |
| ---: | ---: | ---: | ---: | ---: |
| 60 Hz | 60 | 60 | 60 | 60 |
| 120 Hz | 120 | 60 | 60 | 120 |
| 240 Hz | 240 | 60 | 60 | 240 |

All useful samples survive. Rendering remains latest-state-on-frame rather than one render per sample. Synthetic batches are not a physical stylus-rate claim.

## Long-stroke, centerline, outline, and smoothing observations

Local preparation time in milliseconds:

| Points | Smoothing | Centerline | Outline |
| ---: | ---: | ---: | ---: |
| 100 | 0% | 0.50 | 4.46 |
| 100 | 25% | 9.01 | 4.94 |
| 100 | 100% | 2.86 | 3.22 |
| 1,000 | 0% | 8.67 | 20.09 |
| 1,000 | 25% | 5.52 | 11.23 |
| 1,000 | 100% | 3.42 | 9.80 |
| 5,000 | 0% | 19.09 | 34.28 |
| 5,000 | 25% | 18.47 | 34.83 |
| 5,000 | 100% | 17.49 | 37.09 |
| 10,000 | 0% | 32.48 | 60.17 |
| 10,000 | 25% | 42.57 | 67.99 |
| 10,000 | 100% | 40.14 | 86.76 |
| 25,000 | 0% | 81.74 | 174.36 |
| 25,000 | 25% | 97.96 | 174.83 |
| 25,000 | 100% | 96.29 | 209.16 |

At 25,000 inputs the adaptive filter retained 12,501 render points and 319 fitted segments. Outline geometry retained about 65,977 boundary vertices. Growth remained approximately linear; smoothing uses a fixed maximum local radius and did not introduce superlinear retained structures.

## Cursor and React render audit

Electron instrumentation covered `EditorWorkspace`, `CanvasHost`, `CanvasSurface`, `ToolDock`, and an open `ToolOptionsWidget`.

- 240 sustained cursor moves: zero render-count change in all five components.
- 40 active-drawing pointer steps before commit: zero render-count change in `EditorWorkspace`, `CanvasHost`, `CanvasSurface`, and `ToolDock`.
- Cursor presentation: frame-coalesced imperative transform/opacity updates.
- Normal tool, preset, size, opacity, smoothing, color, viewport-presentation, and History availability state changes may render React normally.

## Geometry/cache and full-document redraw behavior

The 1,000-stroke immutable-cache workload completed in about 207 ms, with 1,000 initial path builds and 1,000 identity cache hits. Every cache snapshot remained one path build and one outline build at the requested object scale.

Unified compositor observations:

| Objects | First draw | Cached redraw |
| ---: | ---: | ---: |
| 100 | 6.06 ms | 9.68 ms |
| 500 | 48.46 ms | 45.98 ms |
| 1,000 | 105.40 ms | 168.62 ms |

The cached redraw still performs expected canvas draw calls for every visible object, so it remains O(visible objects). It did not rebuild any fitted or outline geometry. The timing difference is normal single-run/mock noise and is not used as an assertion.

Pan, zoom, Fit Page, Fit Width, selection overlays, and settings changes redraw presentation through existing paths. They do not replace immutable `Stroke` identities. Active-tool changes therefore do not invalidate historical brush geometry.

## Memory observations

Memory remains object/array based as frozen in Phase 17A:

- Active builder: raw references, source references, and derived render-point references.
- Finalization: immutable `Stroke.points` and `Stroke.sourceSamples` arrays are copied once; active raw buffers are cleared.
- Fitted path: source references, normalized progress, filtered points/progress, and fitted segments.
- Smoothing: coordinate-only derived objects exist for the build and leave source metadata untouched.
- Outline: centerline samples, final boundary, joins, and bounds remain cached; temporary offsets/left/right arrays are build-local.
- Cache ownership: `WeakMap<Stroke, ...>` permits release when the document and History no longer own the stroke; each outline/visual scale cache is capped at eight entries.
- Renderer destruction clears active and finalized retained arrays. Document removal drops compositor object ownership; History may intentionally retain immutable snapshots until its lifecycle releases them.

The measurements did not justify typed arrays or a binary stroke model.

## Zoom and DPR validation

The 25%/50%/100%/200%/400%/800% matrix reused the same committed geometry identity and the same canonical `Stroke.points` reference. Viewport zoom changed only the canvas transform. Outline resampling is keyed to object transform scale, not viewport zoom, so zoom alone does not mutate a pressure silhouette.

At DPR 1, 1.5, and 2:

- screen-to-page conversion returned the same page coordinate;
- the 12 px CSS cursor diameter remained 12 px at 100% zoom;
- canonical geometry and logical brush width stayed unchanged;
- the existing canvas controller continued to apply DPR only to backing-raster dimensions/transforms.

The Electron scenario ran at the host's default DPR. Multiple physical displays were not available for manual visual sharpness comparison.

## Device and input validation

| Device/input | Available? | Tested? | Pointer type | Pressure | Tilt/twist | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Playwright Electron mouse | Yes | Yes | `mouse` | fixed 0.5 fallback | none | Straight/curved/stress paths; expressive presets remained centerline fallback. |
| Synthetic Electron pen events | Yes | Yes | `pen` | variable | captured synthetically | Existing pressure parity plus cancellation coverage; not a hardware claim. |
| Physical mouse | Not controlled by automation | No | — | — | — | Manual feel check remains operator QA. |
| Physical laptop trackpad | Not available to automation | No | — | — | — | Required manual QA remains. |
| Physical stylus | Not available | No | — | — | — | See explicit statement below. |

**PHYSICAL STYLUS VALIDATION NOT PERFORMED.**

Synthetic pen coverage confirms device-aware outline selection, changing pressure capture, live/final parity, no release jump in the accepted Electron pressure suite, and retention of synthetic tilt/twist metadata. Tilt and twist remain data-capture-only and do not affect rendering.

## Stationary input, cancellation, History, eraser, and settings

- 10,000 stationary events produced one render point and no more than 627 source samples; a final pressure/tilt/twist change was retained.
- `pointercancel`, `lostpointercapture`, uncaptured pointer leave, missing mouse release, tool detach/switch, and window blur clear transient state through existing cancellation paths.
- Escape does not own an active-stroke policy; Space-pan and viewport cancellation remain the accepted viewport boundary and regression coverage.
- A 100-stroke unit stress restored the same immutable `Stroke` and brush snapshot references after 100 Undo operations and 100 Redo operations; History remained one command per stroke.
- The Electron scenario committed 22 strokes across Pencil, Pen, Marker, and Highlighter; cancelled a synthetic pen stroke without a half-commit; then proved the next stroke worked.
- Ten Electron Undo/Redo cycles restored identical serialized brush diagnostics.
- A continuous eraser gesture removed multiple whole strokes as one current-architecture transaction, and Undo restored the exact pre-erase brush diagnostics.
- 120 rapid native color input events retained rAF coalescing and applied only the final color. Size, opacity, smoothing, and color preference changes added no History entry and did not mutate old stroke snapshots.

## Files changed for Phase 17D

- `packages/ink/src/pointer-input-controller.ts`
- `packages/ink/src/stroke-renderer.ts`
- `packages/ink/src/__tests__/pointer-input-controller.test.ts`
- `packages/ink/src/__tests__/stroke-renderer.test.ts`
- `packages/ink/src/__tests__/brush-performance-device-validation.test.ts`
- `packages/editor/src/VectorShapeRendering.ts`
- `packages/editor/src/CanvasSurface.tsx`
- `packages/editor/src/__tests__/vector-shape-rendering.test.ts`
- `packages/editor/src/__tests__/editor-history-coordinator.test.ts`
- `apps/desktop/src/components/editor/CanvasHost.tsx`
- `apps/desktop/src/components/editor/EditorWorkspace.tsx`
- `apps/desktop/src/components/editor/ToolDock.tsx`
- `apps/desktop/src/components/editor/ToolOptionsWidget.tsx`
- `tests/e2e/electron-brush-performance-device-validation.spec.ts`
- `docs/interaction/PHASE_17D_BRUSH_PERFORMANCE_DEVICE_VALIDATION.md`

These are in addition to the already-uncommitted accepted Phase 17A–17C work in the repository.

## Verification and remaining limitations

Final repository gates:

- `pnpm format:check` — passed.
- `pnpm lint` — passed with zero warnings.
- `pnpm typecheck` — passed.
- `pnpm test` — passed: 96 files, 755 tests.
- `pnpm build` — passed; Vite emitted only its existing informational large-chunk warning.
- `pnpm test:e2e` — final full run passed: 20/20 scenarios. Earlier full runs exposed transient foreground desktop-input misses; each failed area passed unchanged in isolation before the final clean run.
- `pnpm package` — passed; unpacked Windows application produced at `release/win-unpacked/Folio.exe`.
- `git diff --check` — passed.

No commit or push was performed.

Remaining limitations:

- Physical trackpad and stylus behavior still require operator hardware QA.
- Synthetic timing does not establish a maximum supported stylus Hz.
- A 25,000-point full active outline build is intentionally not a 60 Hz operation; exact live/final semantics were preferred over a speculative engine rewrite.
- Full-document redraw remains proportional to visible object count even though brush geometry is cached.
- No persistence integration or Phase 18 work was started.
