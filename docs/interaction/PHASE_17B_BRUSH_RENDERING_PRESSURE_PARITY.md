# Phase 17B — Brush Rendering & Pressure Parity

## Pre-change defect

The active Pen renderer varied `StrokeStyle` line width per incremental segment. The committed renderer adaptively filtered and fitted the centerline, then stroked the complete path at one arithmetic average width. Releasing a pressure-sensitive stroke could therefore replace the visible pressure profile with a uniform silhouette.

Phase 17A brush dynamics were present on `Stroke.brush`, but the rendering and bounds paths still evaluated legacy `StrokeStyle` pressure behavior.

## Strategy architecture

`ResolvedBrushSnapshot.renderer.kind` now dispatches inside `packages/ink`:

- `centerline` retains the fitted Canvas2D stroke strategy for fixed-width and compatibility brushes.
- `outline` builds a variable-width, filled Canvas2D silhouette for expressive brushes.

The geometry strategies, fitted-pressure representation, outline vertices, join calculations, and cache records remain internal. The only cross-package additions are brush-aware rendered-bounds helpers required by `@folio/document`.

Committed rendering never consults mutable `ActiveToolState` or the current preset catalog. The immutable snapshot stored on each `Stroke` remains authoritative.

## Centerline strategy

The centerline strategy preserves adaptive filtering, corner boundaries, error-tolerance cubic fitting, round caps and joins, `source-over` compositing, page clipping, and single-path final presentation. It now derives color, opacity, pressure enablement, and size from the resolved brush snapshot.

Highlighter remains fixed-width centerline with its existing widths and opacity. Legacy strokes whose snapshot says `centerline` remain on this strategy even if pressure data is present.

## Fitted pressure association

The professional path now retains the immutable render-point references and a normalized cumulative source progression. Each fitted cubic stores monotonic start and end progression.

Outline generation samples each fitted cubic using spatial subdivisions plus every source progression that falls inside that cubic. Pressure is interpolated between adjacent render points by monotonic cumulative progression. It never performs nearest-point lookup, so a self-crossing stroke cannot jump backward in pressure history. Segment boundaries share the same progression and evaluator, preventing width discontinuities while retaining intermediate peaks and valleys filtered out of the fitted centerline control set.

## Pressure dynamics

Effective diameter is:

`resolved size × evaluatePressureResponse(resolved pressure-size dynamics, pressure)`

The current Pen definition remains linear from `0.5×` at pressure 0 through `1×` at mouse pressure 0.5 to `1.5×` at pressure 1. Pressure-opacity remains disabled for every production preset.

## Outline geometry

The outline builder flattens the fitted cubics at bounded spatial intervals while also retaining pressure stops. Each center sample receives one effective radius. Consecutive duplicate geometry is removed locally without touching `sourceSamples`.

Left and right boundaries use bounded averaged incoming/outgoing normals without miter amplification. A reversal has no stable average direction, so it retains the incoming side orientation and receives an explicit circular join. Corners above the local turn threshold also receive circular join subpaths. Explicit sampled semicircles form round start and end caps. The closed boundary and round joins are submitted in one Canvas path and one `fill()` operation using the default nonzero fill rule. This is robust for ordinary handwriting loops and self-crossings without introducing a polygon-union subsystem.

The fitted centerline is deterministically resampled after cubic evaluation so adjacent outline center samples are no more than 3 rendered pixels apart (and may be closer for smaller brushes). This renderer-only subdivision leaves `sourceSamples` and their pressure history untouched. It makes sparse stylus samples safe at transformed scales without fabricating process or AI input.

A one-point stroke uses one circular path whose diameter comes from that point's resolved pressure. Two-point and short strokes use the same fitted/outlined path and guarded normals.

## Opacity

An outline stroke is filled once with `globalAlpha × resolved opacity`, so internal segment and join overlap cannot accumulate alpha within one stroke. Separate strokes still composite independently with normal `source-over` behavior. Highlighter continues using its accepted centerline compositing and separate-stroke accumulation.

## Live preview and final rendering

Centerline live drawing retains the accepted incremental scheduled path. Outline live drawing uses the same professional-path and outline builders as committed rendering. The existing `RenderScheduler` coalesces input; each scheduled outline frame clears the conservative active-stroke region and redraws only the complete transient outline. It does not update React or the document collection per sample and never redraws the whole document.

At pointer-up, the immutable `Stroke` resolves through the same strategy and geometry semantics. The active renderer and unified compositor share the immutable Stroke geometry cache, removing duplicate final geometry preparation while keeping transient and persistent presentation ownership separate.

## Cache policy

The cache is keyed by immutable `Stroke` identity. Every stroke has one fitted path. Centerline transforms reuse that path and compensate line width at draw time. Outline radius compensation changes local vertices when uniform scale changes, so outline geometry is cached by scale. Translation and rotation reuse the same scale entry. Scale entries are bounded to eight per Stroke to avoid unbounded growth during manipulation previews.

Changing active tool state cannot invalidate or rebuild historical stroke geometry.

## Transform width semantics

Folio's accepted Ink semantics remain:

- centerline geometry follows the object scale;
- visible brush width remains in page space.

For an object scale `S`, centerline `lineWidth` and outline radii are divided by `S` before the existing Canvas transform applies `S`. Translation and rotation are then ordinary Canvas transforms around the stable raw-stroke center. Manipulation preview and committed rendering both create visuals with the final scale and therefore use identical compensation.

## Bounds correction

Previously, `InkObject` transformed an already pressure-inflated metrics rectangle. That scaled brush padding even though painted width was compensated.

Brush-aware bounds now begin with the actual strategy geometry at the requested compensated scale, add 2 px of conservative antialias/dirty padding in final page-space terms, symmetrize the local rectangle around the stable raw-stroke pivot, and transform around that same pivot. The symmetric conservative form preserves existing manipulation-center semantics even when pressure makes the painted silhouette asymmetric. Bounds remain finite for centerline, outline, pressure extremes, dots, rotation, translation, and uniform scales. Slight overestimation is intentional; under-clearing is avoided.

The selection and whole-stroke Eraser continue consuming the existing `InkObject` path. No selection, manipulation, or Eraser architecture changed.

## Pen and Highlighter migration

New current Pen presets advertise `renderer.kind = "outline"` as their expressive renderer capability. At stroke start, the pointer controller freezes the actual strategy into the same immutable `ResolvedBrushSnapshot`: mouse Pen becomes `centerline`, while pen/stylus retains `outline`. Touch conservatively retains the preset strategy already used before stabilization. Their colors, sizes, opacity, independent tool state, and linear `0.5×–1.5×` pressure response are unchanged.

Highlighter presets remain `renderer.kind = "centerline"`, pressure disabled, with unchanged width, opacity, and `source-over` behavior. Compatibility snapshots created from legacy `StrokeStyle` remain centerline.

## Performance

Only the active outline is rebuilt per scheduled frame. Final strokes reuse cached immutable geometry on full-document redraws.

An indicative Windows development run measured outline generation at approximately:

| Render points | Generation time |
| ---: | ---: |
| 100 | 3.3 ms |
| 1,000 | 19.6 ms |
| 5,000 | 88.8 ms |
| 10,000 | 79.8 ms |

These are sanity observations, not cross-machine benchmark promises. The test enforces a broad ceiling and linear-size vertex allocation rather than brittle millisecond thresholds.

## Verification coverage

Unit coverage includes:

- constant, increasing, decreasing, and wave pressure profiles;
- exact live/committed outline equality;
- minimum, nominal mouse, and maximum width semantics;
- low-pressure, mouse, and high-pressure dots;
- two-point strokes, curves, corners, loops, and self-crossings;
- closed finite outlines without extreme spikes;
- one-fill opacity behavior;
- legacy centerline and Highlighter snapshot authority;
- immutable cache reuse and bounded scale caching;
- scale `0.25`, `0.5`, `2`, and `4`, plus rotation and translation bounds;
- 100, 1,000, 5,000, and 10,000-point stress cases.

Electron coverage measures active and committed pressure-width profiles from pixels, mouse live/final width, undo/redo restoration, Highlighter live/final width and separate-stroke accumulation, outline renderer identity, transform preview/commit behavior, and whole-stroke erasing.

## Final stabilization — mouse/trackpad quality and outline robustness

Manual trackpad QA after the initial Phase 17B implementation exposed ragged, locally thick, and spike-like Pen turns. The root cause was semantic: the Pen preset's outline renderer was copied into `StrokeBuilder` before the normalized first point's `pointerType` influenced renderer choice. Mouse input is deliberately normalized to constant pressure `0.5`, yet its relatively sparse samples were still converted into a variable-width polygon. At tight turns, the outline's averaged miter direction could become unstable or reverse side; the old absolute-alignment calculation and `1.5×` cap bounded vertex distance but did not prevent boundary folding.

The preset and Stroke now have precise roles without adding a second snapshot model:

- `BrushPreset.renderer` is the renderer capability/preference resolved by active tool state.
- `Stroke.brush.renderer` is the actual immutable renderer selected once at pointer-down.
- current mouse Pen resolves to `centerline` because its synthetic `0.5` pressure means the effective width is constant;
- current pen/stylus Pen retains the expressive `outline` strategy;
- Highlighter remains fixed-width `centerline`;
- historical snapshots remain authoritative and are never reinterpreted.

The mouse live renderer and committed renderer therefore both use the existing fitted centerline plus Canvas2D round caps and joins. No renderer switch occurs at release. The centerline has no outline construction cost and retains scale-compensated width and brush-aware bounds.

Stylus outline live rendering remains frame-coalesced and shares geometry semantics with committed rendering. The stabilization replaces miter extension with radius-bounded normal offsets, explicitly fills round corner/reversal joins, and enforces deterministic rendered-space subdivision for sparse cubics. Geometry tests cover a 90-degree corner, acute corner, near-180-degree reversal, zig-zag, sparse large-distance samples, tight loop, and repeated alternating directions. They assert closed finite boundaries, bounded extents, exact local diameter, and maximum spatial step at scales `0.5`, `1`, `2`, and `4`.

The realistic Electron regression uses ordinary mouse events for a long curve, zig-zag, loop, and sharp turn. It checks mouse diagnostic identity, committed `centerline` identity, nominal pixel widths at multiple locations, live/final pixel parity, and undo/redo presentation identity. The synthetic `pointerType = "pen"` regression continues checking increasing pressure before release, matching committed widths, outline identity, and undo/redo. Highlighter compositing and Eraser coverage remain in the same scenario.

Final physical mouse/trackpad QA should repeat straight, slow/fast curve, zig-zag, loop, scribble, and intersection cases and visually confirm constant width, smooth edges, and no pointer-up jump. A real pressure stylus should additionally confirm pressure variation and tight-turn behavior; the automated pen scenario cannot validate a specific device driver's pressure curve.

## Limitations and Phase 17C handoff

Phase 17B does not add texture, grain, tilt/twist rendering, stamps, scatter, angled marker behavior, pressure-opacity product behavior, partial erasing, Pencil UI, Marker UI, smoothing UI, or WebGL. `sourceSamples` retain tilt, twist, timing, and stationary process data unchanged.

Real stylus validation remains required in Phase 17D for device pressure curves, high sampling rates, hover, tilt, and driver variation.

Phase 17C may build professional brush product UX on the renderer identity, dynamics, parity, caching, and bounds foundation established here.
