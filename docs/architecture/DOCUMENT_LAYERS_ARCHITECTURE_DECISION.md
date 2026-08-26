# Document and Layers Architecture Decision

Status: **ACCEPTED / FROZEN BEFORE PHASE 19**  
Decision date: 2026-08-26  
Scope: logical document ownership, Layer V1 invariants, and future persistence implications

## Context

The live editor already uses immutable `@folio/document` `PageObject` values in one ordered `ObjectCollection`. The older persistence implementation remains disconnected and is based on the legacy `@folio/domain` artwork model. Phase 19 needs a layer contract that preserves the editor's one deterministic mixed-object render order without prematurely choosing a physical file container or rebuilding persistence.

This record freezes the logical decisions required by Layers. It does not implement layers, persistence, pages, serialization, or selected-Ink editing.

## Canonical document model

`@folio/document` is the canonical artwork model for the live editor and the future durable artwork schema. Its `PageObject` contract remains the object representation used by Ink and vector artwork.

The legacy `@folio/domain.PageObject`, `Section`, and old Page artwork representation are not the future artwork model. `@folio/domain` is not deleted: it continues to own useful shared primitives such as `DomainId`, `IsoTimestamp`, `JsonObject` / `JsonValue`, and `Position`, and may retain useful future sketchbook concepts. Legacy artwork types can be retired later when persistence is deliberately retargeted.

## Future logical root and page geometry

The future durable root is logically:

```text
Sketchbook / Document
  pages[]
    Page
      width
      height
      layers[]
      objects
```

The current one-page runtime remains unchanged. `pages[]` is not added before the page/document implementation phase.

Page width and height are future Document/Page state. Rendering must eventually receive page geometry rather than remain the only canonical owner of page dimensions. `DEFAULT_PAGE` stays in its current location until Page Experience work. This decision allows later portrait, landscape, blank, grid, ruled, and dotted page configurations without camera or CSS workarounds.

## Layer V1

Layer V1 is a flat ordered collection. A conceptual Layer contains:

- `id`;
- `name`;
- `visible`;
- `locked`;
- `opacity`; and
- an ordered list of `PageObject` IDs.

There are no groups, nested layers, masks, blend modes, or stored layer `zIndex` values in V1. Array order is authoritative and is consistently **bottom to top**.

Paper/templates, references, and lesson/AI guides are separate concerns and are not Layers.

## Membership and canonical ordering invariant

A Layer owns its ordered list of `PageObject` IDs. `PageObject` does not gain `layerId`, `layerOrder`, `localZIndex`, or `layerZIndex`.

The invariant is:

```text
layers in bottom-to-top order
  + ordered object IDs inside each layer
                ↓ flatten
ObjectCollection.objects
                ↓
canonical mixed PageObject render order
```

The Layer structure and `ObjectCollection.objects` must never become independent valid authorities. Every layer-aware mutation must atomically update membership/order and the flattened `ObjectCollection`, or produce both from one owning operation. They must not be allowed to drift.

Phase 19 may introduce a layer-aware document coordinator that owns membership and produces the flattened collection, but this decision does not freeze an implementation class or add it now.

`ObjectCollection` continues to derive `zIndex` from array position. `zIndex` is not independent durable order, and future serialization must not rely on persisting it as a competing authority.

## Visibility, lock, and opacity

Layer and object state remain independent; effective behavior is derived.

- A hidden Layer is not rendered, hit-tested, selectable, erasable, or manipulable.
- A locked Layer remains visible, but contained objects cannot be altered, erased, transformed, or otherwise destructively edited.
- V1 effective object opacity is `layer opacity × object opacity`, applied during each object's normal rendering.

Layer opacity is not Photoshop-style isolated group compositing. V1 does not require an offscreen canvas per Layer, and overlapping translucent objects inside one Layer retain normal per-object compositing. Layer opacity is never baked into object style.

## Active layer and new-object destination

`activeLayerId` is editor state. Changing it creates zero document History. Future persistence may optionally retain it as a restore hint, but it is not artwork semantics.

New Ink, Line, Rectangle, Ellipse, paste, and duplicate operations enter the active Layer unless an operation explicitly defines another destination. Existing `PageObject` representations and clones remain layer-agnostic; membership belongs to the layer model.

## Durable Ink source of truth

The normal editable Folio document preserves:

- the exact retained `sourceSamples`;
- the immutable, versioned, JSON-safe `ResolvedBrushSnapshot`;
- the `InkObject` transform; and
- identity, timestamps, visibility, lock, and required `PageObject` metadata.

It does not normally persist derived or redundant `Stroke.points`, delta, velocity, acceleration, metrics, statistics, bounds, `zIndex`, or legacy duplicate `StrokeStyle` values.

The retained samples are the output of `StrokeBuilder`'s deliberate retention policy, not uncontrolled raw device-event spam. Timing, direction, hesitation, pressure, tilt, twist, and device type are retained because geometry cannot reconstruct them. No additional reduction, quantization, compression, or second process representation is introduced now.

`ResolvedBrushSnapshot`, rather than only `presetId`, is the durable brush record so catalog changes cannot alter an existing stroke. The current overlap between `stroke.style` and `stroke.brush` is technical debt: rendering already uses the resolved brush path, and future durable serialization must not duplicate legacy `StrokeStyle` semantics. Function-valued legacy `pressureCurve` is not part of the intended schema; declarative pressure dynamics already live in the resolved snapshot.

`sourceSamples` describe surviving strokes only. They do not retain erasures, undos, deleted attempts, transforms, or correction history. If faithful learning/replay later requires those events, it may use a separate optional append-only session event log. That log is not PageObjects, History, or Layers.

## State and persistence classification

Future classification is:

- **Document:** committed artwork, pages, page geometry, and layer structure.
- **User/workspace preferences:** Recent Colors, Favorites, active palette, user palettes, tool preferences, and appearance.
- **Session:** open picker, Eyedropper mode, selection, hover, and temporary UI state.

Color preferences and session UI state do not belong in PageObjects or Layers.

## Intentionally deferred decisions

The physical Folio file format is not frozen before Phase 19. Plain JSON, a directory package, a ZIP package, or another container will be evaluated during persistence implementation. Layers depends on the logical model, not that packaging choice.

V1 also does not freeze a dual Ink payload supporting either `sourceSamples` or baked points. Normal editable Folio documents retain `sourceSamples`; image/PDF export naturally removes process data. If an editable process-stripped Folio file becomes a real product requirement, that representation will be designed deliberately rather than creating two canonical Ink forms now.

## Phase 19 constraints

Phase 19 must preserve:

- unchanged `PageObject` representations;
- one canonical flattened `ObjectCollection.objects` order;
- bottom-to-top layer array order;
- layer-owned ordered object IDs;
- atomic layer/flattened-order mutations;
- independent object and layer visibility/lock/opacity;
- editor-owned `activeLayerId`; and
- active-Layer placement for new objects, paste, and duplicate.

Phase 19 does not depend on a persistence implementation, physical file-format decision, multi-page runtime, selected-Ink property editing, isolated group compositing, or an event log.

## Recorded non-blocking editor debt

The accepted Phase 18 picker path was measured at approximately 41 workspace React reconciliations for 40 SV pointer moves, while creation-preview compositor renders remained unchanged. This is not a Phase 19 blocker and is intentionally not optimized in this preparatory pass.
