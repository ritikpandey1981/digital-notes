# Brush engine architecture

This is the durable contract for Folio's brush engine. It describes the pipeline that
exists today, the target the engine is being built toward, and the boundaries that work
must not cross. It authorizes no implementation on its own; scope comes from
[`../ROADMAP.md`](../ROADMAP.md).

Companion documents: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the implemented
system, [`../DECISIONS.md`](../DECISIONS.md) for durable choices,
[`drawing-tool-system.md`](drawing-tool-system.md) for the product tool contract, and
[`../performance/desktop-baseline.md`](../performance/desktop-baseline.md) for the
measured constraints this design is bounded by.

## 1. The stroke pipeline as it exists

One real stroke, from device to disk and back. Every stage names its owning package and
its exact entry point.

| # | Stage | Owner | In | Out | Durable | Deterministic | Platform |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `PointerEvent` capture, coalesced expansion | `@folio/ink` `PointerInputController` | DOM events | events | no | no | DOM |
| 2 | Normalization | `PointerInputController.normalizeEvent` | `PointerEvent` | `StrokePointInput` | no | yes | DOM boundary only |
| 3 | Stationary-sample policy | `@folio/ink` `StrokeBuilder.addPoint` / `shouldRetainStationarySample` | `StrokePointInput` | retained sample or drop | no | yes | neutral |
| 4 | Input smoothing | `StrokeSmoother.smoothNext` | raw positions | smoothed position | no | yes | neutral |
| 5 | Derived per-point data | `StrokeBuilder.addPoint` | position + timestamp | `StrokePoint` (`delta`, `velocity`, `acceleration`) | **yes** | yes | neutral |
| 6 | Live geometry | `@folio/ink` `internal/brush-render-strategy.createBrushRenderGeometry` or `internal/draw-stroke.drawStrokePoints` | `StrokePoint[]`, snapshot | `BrushRenderGeometry` or direct draw calls | no | yes | Canvas 2D |
| 7 | Live paint | `StrokeRenderer.renderIncrementalFrame` | geometry | pixels | no | yes | Canvas 2D |
| 8 | Finalize | `StrokeBuilder.finalize` | builder state | immutable `Stroke` | **yes** | yes | neutral |
| 9 | Brush resolution | `@folio/ink` `resolveBrushPreset` then `resolveBrushForPointerType` | `BrushPreset` + slot overrides + pointer type | `ResolvedBrushSnapshot` | **yes** | yes | neutral |
| 10 | Document object | `@folio/editor` `InkDocumentSession.createStrokeObject` then `@folio/document` `ObjectFactory.createInkObject` | `Stroke` | `InkObject` | **yes** | yes | neutral |
| 11 | Command | `@folio/editor` `createAddStrokeCommand` | `InkObject` | `PageDocument` successor | **yes** | yes | neutral |
| 12 | Committed geometry | `resolveStrokeRenderGeometry` | `Stroke`, `renderedScale` | cached `BrushRenderGeometry` | no | yes | Canvas 2D |
| 13 | Committed paint | `@folio/editor` `VectorShapeRendering.drawInkObject` via `createStrokeVisual`; `StrokeRenderer.drawFinalizedStroke` | geometry | pixels | no | yes | Canvas 2D |
| 14 | Encode | `@folio/persistence` `project/ink-codec.encodeStroke` | `Stroke` | `SerializedStroke` | **yes** | yes | neutral |
| 15 | Decode | `project/ink-codec.decodeStroke` | JSON | `Stroke` | **yes** | yes | neutral |
| 16 | Bounds | `@folio/ink` `getStrokeRenderedBounds` / `getStrokeLocalRenderBounds` / `getStrokeVisualLocalBounds` | `Stroke`, transform | `Rect` | no | yes | neutral |
| 17 | Hit test | `@folio/editor` `EditorSelectionHitTestEngine` | page point | `HitTestResult[]` | no | yes | neutral |
| 18 | Transform | `@folio/document` `ObjectFactory.replaceObjectTransform` | `InkObject`, `Transform` | same-identity `InkObject` | **yes** | yes | neutral |
| 19 | Eraser | `@folio/editor` `CanvasSurface` + `EraserEligibility` | page point, radius | delete commands in one transaction | **yes** | yes | neutral |

Two facts in that table carry most of the weight of this document.

**Stage 5 is durable derived data.** `velocity`, `acceleration` and `delta` are computed
from smoothed positions and written into `points[]`, which the codec round-trips. They
are the only place where a *derived* quantity became durable. Nothing reads them at
render time today.

**Stage 6 has two different implementations.** `StrokeRenderer.requiresFullGeometry`
sends a stroke down the incremental `drawStrokePoints` path when its strategy is
centerline *and* its smoothing amount is zero, and down a full-geometry rebuild
otherwise. The full-geometry path re-runs `createProfessionalInkPath` over every point
on every frame, which is the whole of the measured long-outline cost. The incremental
path is a different algorithm from the committed one, which is the whole of the measured
live/committed divergence.

## 2. The brush model as it exists

### Catalogue

There are three layers of "brush" today, and they live in two packages.

| Layer | Where | Count | Durable |
| --- | --- | --- | --- |
| Library identity | `apps/desktop` `brush-library-catalogue.ts` | 45 | no |
| Engine preset | `@folio/editor` `foundation/pen-presets.ts` `DEFAULT_BRUSH_PRESETS` | 10 | no |
| Resolved snapshot | `@folio/ink` `ResolvedBrushSnapshot` | one per stroke | **yes** |

The 45 identities map onto 9 of the 10 presets through `fallbackPresetId`; the tenth,
`highlighter-default`, has no library identity. The presets in turn resolve onto exactly
two render behaviours, `centerline` and `outline`. So the honest count of materially
distinct brush behaviours the engine has today is **two**, and everything above that is
configuration.

The library identity a slot holds (`DrawingSlotState.brushId`) is **session state and is
not captured in the snapshot**. A stroke drawn with "Micro Liner" records
`presetId: "pen-technical"`. That is the correct choice and should not change: when an
identity later becomes its own preset, old strokes keep rendering as the preset they were
actually drawn with, which is precisely the no-silent-visual-change rule.

### Field classification

Every field currently in or adjacent to the brush model, classified by what it actually
is rather than by where it currently lives.

**A — durable stroke reproduction state** (`ResolvedBrushSnapshot`, all of it serialized)

`schemaVersion`, `presetId`, `presetVersion`, `family`, `color`, `size`, `opacity`,
`smoothing.{mode,amount}`,
`dynamics.pressureSize.{enabled,minimumFactor,maximumFactor,curve}`,
`dynamics.pressureOpacity.{...}`, `renderer.{version,kind}`.

Correctly placed. `renderer` is the strategy selector and is the one field this document
proposes to extend.

**B — editor/tool preference** (session only, no History, no document)

`DrawingSlotState.{slotId,brushId,presetId,family,color,size,opacity,smoothing}`,
`ActiveToolState.*`, the eraser's own radius, the active slot, the rail and tool-options
values.

Correctly placed.

**C — catalogue/preset metadata** (static configuration)

`BrushPreset.{id,version,name,family,defaults,dynamics,renderer}`,
`BrushLibraryEntry.{id,name,family,fallbackPresetId}`, `DEFAULT_SLOT_BRUSH_IDS`.

Correctly placed, except that the 45-entry catalogue lives in `apps/desktop`. That is
right while it is a UI list and wrong once identities carry behaviour.

**D — rendering-derived state** (recomputable, cached, never durable)

`ProfessionalInkPath`, `ProfessionalInkSegment`, `OutlineStrokeGeometry`,
`OutlineCenterSample`, `CenterlineRenderGeometry`, `BrushRenderGeometry`, `StrokeVisual`,
the `WeakMap` geometry caches, all three bounds helpers.

Correctly placed, and correctly keyed by immutable `Stroke` identity plus scale.

**E — runtime-only state**

`StrokeBuilder` accumulators, `LiveStrokeState`, `pendingDirtyRect`,
`renderedLivePointCount`, pointer capture, canvas diagnostics datasets.

Correctly placed.

**Misplaced, and named honestly:**

- `StrokePoint.{velocity, acceleration, delta}` — category D data stored durably.
- `Stroke.style` (`StrokeStyle`) — a second appearance authority. `color`, `width`,
  `opacity` and `pressureEnabled` duplicate the snapshot, and
  `InkStyleEdit.applyInkStyle` has to write both to keep them agreeing. It is durable in
  `.folio` v1 and therefore frozen, not removable.
- `StrokeStyle.brushTextureId` — an optional durable string with no writer, no reader and
  no validation beyond "is a string". It is exactly the external-resource-reference shape
  that durability hardening forbids. It must not become the texture mechanism.
- `BrushDynamics.pressureOpacity` — fully modelled, fully validated, fully serialized,
  and **never evaluated**. Every preset sets `enabled: false`. It is a durable promise
  with no renderer behind it.
- `StrokeSmoothingMode` `"catmull-rom"` and `"bezier"` — decodable enum values that
  require an injected `SmoothingHook` nothing supplies. A hand-written file can select
  them; `StrokeSmoother` will throw.

## 3. Strengths to preserve

These are load-bearing, and the brush engine must be built on them rather than around
them.

- **The normalized sample boundary.** `StrokePointInput` already carries position,
  timestamp, pressure, `tiltX`/`tiltY`, `twist`, optional `altitudeAngle`/`azimuthAngle`,
  `pointerType`, `button` and `buttons`. That is the complete portable stylus vocabulary.
- **Exact source retention.** `Stroke.sourceSamples` keeps what the device said, and no
  derived view replaces it. Every future strategy can be a pure function of it.
- **The snapshot is data.** No callbacks, no closures, no handles, no paths. The whole
  model is JSON, and the codec proves it on every save.
- **Preset edits do not reach old artwork.** Resolution happens once, at stroke start.
- **Geometry is cached by immutable identity.** `WeakMap<Stroke, …>` keyed by scale with a
  bounded variant count.
- **Rendering is request-driven.** No continuous loop; invalidation coalesces to a frame.
- **Preview primitives are pure.** `renderPageThumbnail`, `renderPagePaperPreview` and
  `renderPageLayerPreview` take a context and a page and nothing else.
- **History knows nothing about brushes.** Commands carry whole immutable `InkObject`s.

## 4. Limitations to solve

1. **Live and committed centerline are different algorithms.** `drawStrokePoints` draws
   per-segment cubics with per-segment width; `drawSmoothStrokeSegments` draws the fitted
   path at one stroke-wide *average* width. A pressure-enabled centerline stroke varies in
   width while being drawn and flattens to a constant width when it commits.
2. **Centerline discards pressure.** `averageStrokeWidth` is the only width the committed
   centerline path knows. `createLegacyBrushSnapshot` mints centerline snapshots with
   pressure-size *enabled*, so the model claims a dynamic the renderer ignores.
3. **Live full-geometry rebuild is O(n) per frame.** Every outline stroke, and every
   smoothed centerline stroke, rebuilds its entire path each frame. Over a stroke this is
   quadratic work, and it is the measured 254 ms p95 at 20 000 samples.
4. **The fit is not prefix-stable.** `fittingTolerance` and `filterAdaptiveStrokePoints`
   both read whole-stroke properties (`strokeDiagonal`, mean spacing), so appending a
   sample can change segments already drawn. Incremental live drawing cannot converge on a
   whole-stroke adaptive fit without this being fixed.
5. **Strategy dispatch is a conditional, not a registry.** `createGeometry` branches on
   `brush.renderer.kind`. There is nowhere to add a strategy without editing the branch,
   and nothing pins a shipped strategy's appearance.
6. **`renderer.version` is decoration.** It is validated as `=== 1` and never read.
7. **Ink hit testing is bounds-only.** `EditorSelectionHitTestEngine` measures distance to
   the object's axis-aligned bounds for Ink. `@folio/selection`'s `distanceToInkGeometry`
   exists and is unreachable from the editor.
8. **Bounds conflate two questions.** `getStrokeLocalRenderBounds` pads and squares around
   the pivot for repaint safety; `getStrokeVisualLocalBounds` does not. Neither is a
   "logical ink extent", and the centerline variant derives its radius from the *average*
   width, which understates a high-pressure end.
9. **A catalogue hides in a component.** `CanvasSurface.tsx`'s `resolveBrush` fallback
   mints `editor-default-pen` / `editor-default-highlighter` snapshots inline.
10. **`.folio` v1 is closed.** `assertExactKeys` rejects unknown fields and `formatVersion`
    must equal `1` exactly. There is no forward-compatible slack anywhere in the stroke or
    brush records.

## 5. Target pipeline

```text
PointerEvent
  -> normalized StrokePointInput            (unchanged, already correct)
  -> retained source samples                (unchanged, already correct)
  -> path resampling / fitting              (prefix-stable; settled + tail)
  -> brush evaluation                       (pure: snapshot + samples -> dynamics)
       pressure response -> size, opacity
       velocity response
       tilt / azimuth response  (later)
       taper
       spacing -> stamp stream  (stamp strategies only)
       deterministic variation
  -> BrushGeometry primitives               (stroked-path | filled-path | stamps)
  -> BrushPainter                           (Canvas 2D today; backend-neutral)
```

**This is compatible with the current architecture.** The document model, `Stroke`,
`ResolvedBrushSnapshot`, History, the codec's structure, the compositor and the preview
primitives all survive unchanged. Three things are genuinely missing, and they are the
whole of the required change:

1. a strategy **vocabulary** with a version, so a new strategy can exist without
   redefining an old one;
2. a strategy **registry** instead of a conditional;
3. a split between **producing geometry** and **painting geometry**, so live drawing can
   be incremental and so a future backend is possible.

## 6. Preset, snapshot, strategy

Three concepts, one direction of flow, no shortcuts between them.

**A — `BrushPreset` is configuration.** Named, versioned, immutable, JSON. It declares
defaults and dynamics and *names* a strategy. It is never executed and never contains
code. A preset edit changes what the next stroke will look like, and nothing else.

**B — `ResolvedBrushSnapshot` is the durable record.** Created once, at stroke start, from
a preset plus the slot's overrides plus the pointer type. It is the *sole* authority for
reproducing a finished stroke. Everything a strategy needs to redraw that stroke in five
years is in it, or is derivable from `sourceSamples`, or the stroke is not reproducible.

**C — the strategy is code.** It interprets a snapshot and a sample sequence and emits
geometry. It is selected by `(strategyId, strategyVersion)` and is otherwise anonymous:
nothing in the document names a function, a module or a file.

The rule that keeps these apart: **a preset may not become a rendering algorithm, and a
strategy may not read a preset.** A strategy sees only the snapshot it was handed. This is
what makes old artwork stable when the catalogue changes, and it is already true today —
the change is to make it structural rather than incidental.

## 7. Strategy versioning

### The smallest mechanism that works

`ResolvedBrushSnapshot.renderer` already is the strategy slot. It is durable, serialized,
validated, and already the field the dispatcher reads. Use it.

```ts
type BrushStrategyId =
  | "centerline"      // frozen legacy
  | "outline"         // frozen legacy
  | "technical-pen";  // pressure-pen and pencil have since shipped; marker joins next

interface BrushRendererDefinition {
  readonly version: number;        // widened from the literal 1
  readonly kind: BrushStrategyId;  // widened from "centerline" | "outline"
}
```

**As implemented.** One set of `"kind@version"` strings in `@folio/ink` is the whole
vocabulary, and `isSupportedBrushStrategy` is exported so the codec validates through it
rather than repeating literals. A second list, `registeredBrushStrategies`, reports what
the renderer can actually draw, and a test asserts the two are equal — two tables that can
disagree is the failure mode this arrangement exists to remove. An identity is added to
both or to neither.

Do **not** add `strategyId` and `strategyVersion` beside `renderer.kind`. Two fields
answering one question is two things that can disagree, and the codec would have to decide
which wins.

### The rule

> A shipped `(kind, version)` pair draws the same pixels for ever. To change how a strategy
> looks, ship the next version and point new strokes at it. Changing what a shipped pair
> draws is a defect, not a refinement.

`centerline@1` and `outline@1` are frozen as of today's behaviour, average-width flattening
and all. Their code paths stay exactly as they are.

### Existing strokes

Nothing migrates. Every stroke ever written carries `{version: 1, kind: "centerline"}` or
`{version: 1, kind: "outline"}` and continues to render through those frozen strategies.
There is no rewrite, no upgrade-on-open, and no visual change to any existing artwork.

### Format impact

`.folio` `formatVersion` stays at **1**. The document *shape* does not change: no field is
added, removed or renamed, so every byte sequence that decodes today still decodes and
still means the same thing. What grows is the set of legal *values* inside two existing
fields.

Two consequences must be stated rather than hidden:

- **Decode must widen.** `parseBrush` currently rejects any `kind` outside two literals and
  any `version` other than `1`. E2 must widen both and refuse an unrecognised
  `(kind, version)` with a typed error naming it, consistent with the codec's existing
  strictness. Substituting a nearby strategy would be a silent visual change and is
  forbidden.
- **New files will not open in older builds.** A v1 file written by a Folio that knows
  `technical-pen@1` is refused by a Folio that does not. That is ordinary
  forward-incompatibility within a version, and it is the correct trade against bumping the
  format for every strategy. Record it in `DECISIONS.md` when E2 lands.

### Future migrations

A migration is only ever "these old strokes should now use a newer strategy version", and
it is only ever performed **explicitly by the artist**, per project, never on open. The
mechanism is an ordinary command producing an ordinary History entry: read the snapshot,
write a successor with a different `renderer`, keep everything else. No migration code
belongs in the codec.

## 8. Pressure representation

Keep the current shape — a named curve family plus parameters, remapped into a factor
range:

```text
factor(p) = minimumFactor + (maximumFactor - minimumFactor) * curve(clamp(p, 0, 1))
```

| Criterion | Enum + params (current) | Piecewise points | Cubic control points | Raw coefficients |
| --- | --- | --- | --- | --- |
| Determinism | good (`Math.pow` differs sub-ULP across engines) | exact (only `+ - * /`) | good | good |
| Serialization | 3 numbers and a tag | bounded array | 8 numbers | opaque |
| Validation | trivial and total | ordering, monotonicity, count | convexity is hard | not checkable |
| Interpolation | closed form, O(1) | O(log n), or O(1) with a cursor | O(1) | O(1) |
| Performance | fine per sample | fine | fine | fine |
| Future fit | needs a new tag per shape | expresses anything | expresses most things | unreadable |

**Recommendation: keep enum + params, with a closed vocabulary versioned alongside the
strategy that reads it.** Bit-exactness across engines is not achievable end to end anyway
— Canvas 2D rasterization differs by platform and version — so the requirement is *visual*
determinism, which `Math.pow` satisfies comfortably.

Add `{ kind: "piecewise", points: readonly [number, number][] }` **only when an
artist-facing curve editor exists**, with at most 16 points, strictly increasing `x`,
endpoints pinned at 0 and 1, and every value in `[0, 1]`. Until then it is a speculative
field.

One distinction the current model gets wrong by omission: **taper is not a pressure
response.** Taper is a function of normalized position along the stroke, and it needs its
own durable field. Do not express it by bending a pressure curve.

**As implemented for `pressure-pen@1`.** The existing enum plus parameters was sufficient
for both width and opacity, and nothing was added to it: no `piecewise` kind, no curve
editor, no second model. The shipped preset uses `linear` for width and `power` with an
exponent below one for opacity, which is exactly the shape the existing vocabulary is for.
Pressure is read once per kept sample through `evaluatePressureResponse`, so bounds, the
strategy, and the codec all agree by construction rather than by review.

Two rules the implementation had to add, neither of which the representation implies:

- **Pressure is smoothed by the same window as position, and pinned at both ends.** A
  width that steps between samples is as visible as a position that does, and the same
  fixed-radius window is what lets both settle. Pinning the terminal sample means a stroke
  ends at exactly the pressure the pen lifted on.
- **Device-edge input is normalized at the strategy boundary, not trusted.** `StrokeBuilder`
  already refuses a pressure outside `[0, 1]` or a non-finite one, but the strategy is
  reachable directly; a NaN radius would poison every bound derived from it, so it clamps
  and substitutes 0.5 for a non-finite value.

Taper stayed out, for the reason above and one more: it has no durable field, and adding
one to serve a single strategy would be speculative. It is a focused follow-up.

## 9. Velocity

Today `StrokePoint.velocity` is computed in `StrokeBuilder` from smoothed positions and raw
timestamps, with `dt` floored at one microsecond, and it is persisted. Two duplicate
timestamps therefore produce a velocity up to a million page units per second, and any
future velocity-driven dynamic would spike on it.

**Derive velocity; do not persist it.** `sourceSamples` carry position and timestamp, which
is everything needed, and a derived value that is also durable is a second authority
waiting to disagree with the first.

The contract for one shared `deriveVelocity` in `@folio/ink`:

- **Source:** `sourceSamples`, not resampled points. Resampling changes spacing, and
  velocity must describe the hand, not the fit.
- **Units:** page units per second. Page space is already zoom-invariant because
  `screenToPage` divides out the camera, so no further compensation is needed.
- **Window:** measured over a fixed *time* window (about 12 ms) rather than over one sample
  pair. A 240 Hz device and a 60 Hz device then report the same speed for the same motion;
  a per-pair estimate reports the same mean with far more noise at high rates.
- **Degenerate timestamps:** if the window's span is below one timer tick (1 ms), carry the
  previous velocity forward. Never divide by a synthetic floor.
- **Smoothing:** one-pole low-pass with a time constant in milliseconds, not in samples, so
  the filter is also sample-rate independent.
- **Determinism:** a pure function of the persisted samples, so Save/Open reproduces it
  exactly.

The existing persisted `velocity`, `acceleration` and `delta` fields stay in `.folio` v1
because removing them is a format change. They are frozen legacy. **No new strategy may
read them.**

## 10. Tilt, azimuth and twist

Already captured, already normalized, already durable:

| Field | Range | Source | Notes |
| --- | --- | --- | --- |
| `pressure` | 0–1 | all | mouse fixed at `0.5` |
| `tiltX`, `tiltY` | ±90 degrees | Windows Ink, most stylus stacks | clamped |
| `twist` | 0–360 degrees | barrel-rotation pens | normalized modulo 360 |
| `altitudeAngle` | 0 to π/2 radians | Apple Pencil / Safari | optional |
| `azimuthAngle` | 0 to 2π radians | Apple Pencil / Safari | optional |
| `pointerType` | mouse / pen / touch | all | |
| `button`, `buttons` | integers | all | carries barrel-button and eraser-end state |

**Nothing portable is missing.** Both the Windows tilt pair and the Apple altitude/azimuth
pair flow through the same boundary, and `buttons` already records the eraser-end bit, so a
future eraser-end gesture is recoverable from existing data.

One derivation is missing and should be added when a strategy first needs orientation: a
pure `resolvePenOrientation(sample): { altitude, azimuth } | null` in `@folio/ink` that
returns one normalized pair whichever form the device supplied. It is derived, never
stored, and it keeps every strategy from carrying its own trigonometry.

No device-specific adapter is required or permitted. The brush engine sees
`StrokePointInput` and never a `PointerEvent`.

## 11. Spacing

Stamp-based strategies advance by distance, not by pointer sample.

**Ownership: brush evaluation.** Not input sampling — that must stay device-truthful, and
resampling there would destroy source fidelity. Not the strategy — four strategies would
carry four copies. One shared evaluator emits an ordered stamp stream; stamp strategies
consume it and path strategies ignore it.

Contract:

- **Unit:** a fraction of the current stamp diameter (`0.05` to `2.0`). Expressing spacing
  relative to diameter is what makes it behave correctly under variable width: the advance
  recomputes from the diameter at the current position.
- **Parameterization:** arc length along the *fitted path*, in page/world coordinates. This
  makes spacing independent of device sample rate and of zoom by construction, and it makes
  gaps at high velocity impossible — the stamps follow the path, not the events.
- **Terminal stamp:** always emit one stamp exactly at the final centerline position, even
  when it falls short of a full advance. Without it, strokes end early and the commit
  boundary stops matching the live image.
- **Index:** stamps are numbered monotonically from zero, and the index is the input to
  deterministic variation. It must never be renumbered.
- **Incrementality:** the evaluator keeps an arc-length cursor and emits only new stamps.
  Re-deriving the whole stream per frame reproduces exactly the quadratic cost that makes
  today's outline path slow.

## 12. Randomness

Deterministic, reproducible after Save/Open, identical across engines, and never stored.

- **Seed: derive it from `stroke.id`.** `seed = fnv1a32(stroke.id)`. No new durable field,
  no codec change, and already unique and already round-tripping. It also gives the right
  behaviour for duplication: `ObjectFactory.cloneObject` gives a copy a fresh *object* id
  while reusing the same `Stroke`, so a duplicated stroke keeps its grain instead of
  shimmering into a different one.
- **PRNG:** `splitmix32` over `Math.imul` and `>>>`. Both are exactly specified in
  ECMAScript, so output is bit-identical on every engine; `(x >>> 0) / 2**32` converts
  exactly into `[0, 1)`.
- **Derive per stamp, never stream.** `rand(seed, stampIndex, channel)` — a hash of the
  three, not the *n*-th draw from a sequence. This is the decision that makes incremental
  live evaluation identical to a full rebuild: a sequential generator would produce
  different values the moment the stamp stream is rebuilt from a different starting point,
  and live and committed would diverge visibly.
- **Channels are named constants** (`size-jitter`, `angle-jitter`, `scatter-x`,
  `scatter-y`, `flow-jitter`). Adding a channel must not perturb existing ones — another
  reason the generator cannot be a stream.
- **Grain phase is spatial, not random.** Paper grain is sampled from a function of the
  stamp's position in the *stroke's own local space*, offset once per stroke by the seed.
  Local space rather than page space, so that moving or rotating a stroke moves its texture
  with it; a mark is a physical thing that was made once, and grain that slid under a
  stroke as it moved would read as a bug.
- **Nothing generated is ever persisted.**

**As implemented for `pencil@1`.** `internal/brush-random.ts` is the whole of it: `fnv1a32`
over the stroke id for the seed, a splitmix32 finalizer for mixing, and
`brushHash(seed, first, second, channel)` addressing a three-coordinate grid through
`Math.imul`, `^` and `>>>` and nothing else. No new durable field was needed, and the
duplication behaviour above holds in practice: `cloneObject` reuses the same `Stroke`, so a
copied pencil mark keeps its grain.

Two things the design sketched and the implementation had to settle differently:

- **The seed is an argument, not something read off a `Stroke`.** Live drawing has no
  finalized stroke, so `createBrushRenderGeometry` and `createLiveBrushEvaluator` take the
  stroke id, and `StrokeRenderer.beginStroke` supplies the one `StrokeBuilder` fixed before
  the first sample. Without that the live grain and the committed grain would be different
  grain, and the convergence contract in the next section would be false for every stamped
  strategy.
- **Variation is addressed by *place*, not by stamp index.** This section proposed
  `rand(seed, stampIndex, channel)`; Pencil hashes the grain cell a mark would land in
  instead. Two reasons, both load-bearing. A pencil's stamps overlap heavily, so
  index-addressed thresholds would let one stamp ink exactly where its neighbour declined,
  and the tooth would fill in solid at precisely the coverage where texture matters most.
  And the stamp *count* depends on the rendered scale, so index-addressed grain would
  reshuffle an entire mark the moment its object was scaled, which section 16 forbids. The
  index stays the ordering authority and is never renumbered; it is simply not an input to
  appearance.

**Added in E4.1: some variation has to be *smooth*, and that is still addressed.** A hash
per cell gives white noise, which is the right shape for "does this patch of paper catch
graphite" and the wrong shape for everything that varies over a distance -- how graphite
clumps, and where the tip's own internal divisions sit. Those read a value-noise field
instead: the four lattice corners around the sample, blended by a smoothstep. It is still a
pure function of `(seed, painted position)` with no state and no sequence, so every
guarantee above survives; it costs four hashes a sample rather than one, which is why the
fields that can be sampled once per stamp are, and only the clump field is sampled per
mark. Anything that varies smoothly in space belongs in this form; anything that varies
independently per patch belongs in the other.

## 13. Live and committed convergence

### The contract

> Given one `ResolvedBrushSnapshot` and one ordered sample sequence, live rendering and
> committed rendering produce the same image. The only permitted difference during drawing
> is that the live renderer has seen a *prefix* of the samples. When the last sample
> arrives, the live image already is the committed image, and committing replaces nothing.

Incremental preview differences are acceptable only in the sense that a prefix is not the
whole; they are not a licence for a cheaper algorithm that is corrected at commit.

### Why today's code cannot satisfy it

Two independent obstacles, and both must be named:

1. **Two algorithms.** `drawStrokePoints` and `drawSmoothStrokeSegments` are different code
   producing different pictures, and only one of them varies width with pressure.
2. **The fit is not prefix-stable.** `fittingTolerance` reads the whole stroke's mean
   spacing and diagonal; `filterAdaptiveStrokePoints` reads the whole stroke's diagonal.
   Appending a sample can therefore alter segments already committed to the screen, so no
   amount of care in the renderer makes an incremental path converge on this fit.

### The settled-prefix design

Split the live stroke at a watermark:

- **Settled prefix** — samples behind the watermark. Evaluated once, by exactly the
  function the committed render will use, and never revisited. Painted once.
- **Live tail** — a bounded window of recent samples. Re-evaluated each frame.

The watermark advances when a sample can no longer influence the geometry behind it, which
requires the new strategy's fitting tolerance to depend on `brush.size` rather than on
stroke extent. With that fixed, per-frame work is O(tail) rather than O(n), and the settled
part is *identical* to the committed result because it was produced by the same call.

**As implemented for `technical-pen@1`.** The window is counted in samples rather than arc
length, because what a sample waits for is a fixed number of successors: smoothing reads a
fixed radius, and a Catmull-Rom span reads one point back and two forward. The lookahead is
therefore `max(smoothingRadius, 1)` samples, at most five, and per-frame evaluation is
bounded by it.

Three details the design did not anticipate, each of which the implementation had to settle:

- **The newest sample is treated as terminal whether or not the stroke has ended.** It keeps
  the drawn tip exactly under the pen rather than lagging behind it, and it is what makes
  lifting the pen move nothing — the endpoint was already being evaluated by the rule the
  committed path will use. Without this, live and committed differed by one point.
- **At least one sample is always held back from settling.** The terminal sample is admitted
  under a rule of its own, and it cannot reach that rule if it has already settled under the
  ordinary one.
- **Painting is not incremental, and does not need to be.** The whole path is one
  `beginPath`/`stroke` under a single alpha, which is what stops opacity accumulating at
  joins. Evaluation is what was expensive; a draw loop over cached cubics is not.

This is the single most important architectural output of this document. It replaces the
current choice between "cheap but divergent" and "convergent but quadratic" with a design
that is both.

`centerline@1` and `outline@1` keep their current behaviour, divergence and all. The
contract binds new strategies.

## 14. Geometry model

Do not force every strategy through outline geometry, and do not build four unrelated
renderers. The shared boundary is **strategies emit geometry primitives; a painter paints
primitives.** Three primitives cover every planned strategy:

| Primitive | Shape | Canvas 2D | Used by |
| --- | --- | --- | --- |
| `stroked-path` | fitted path plus one width | `stroke()` | Technical Pen |
| `filled-path` | closed boundary plus round joins | `fill()` | Pressure Pen, and `outline@1` |
| `stamps` | ordered `{x, y, width, height, rotation, alpha, grainPhase}` | batched tip draws | Pencil, Marker |

Three consequences are worth stating:

- Technical Pen is a `stroked-path`, which is *cheaper* than today's outline and no more
  expensive than today's centerline. Making it a filled outline "for uniformity" would hand
  it the measured 1.8x per-sample outline constant for nothing.
- The `stamps` primitive already carries per-stamp width, height and rotation, so an
  oriented chisel tip needs no new primitive and a future anisotropic transform does not
  invalidate the model.
- The painter is the only place that knows about Canvas 2D.

**As implemented.** `stroked-path` and `filled-path` both exist, and both live in
`internal/brush-geometry.ts` rather than inside whichever strategy happened to need one
first. A `filled-path` carries left and right boundaries, round-cap markers at the two real
ends, a variable-radius centerline that doubles as `hitGeometry`, and one or more **alpha
bands**.

Bands are the part the design did not anticipate, and they follow from a plain fact about
the backend: Canvas has no alpha that varies along a path, and painting each span
separately composites overlaps twice — the stroke darkens at its own joins, which is the
failure `outline@1`'s single fill exists to avoid. So a run of samples at a similar alpha
becomes one closed shape filled once:

- a band is cut at the **midpoint of the span** between two samples, taken from that span's
  own direction so it is unambiguous, and **both** bands are given the same two points.
  They tile along a shared edge rather than overlapping across one;
- corners are tessellated into the boundary on the outside of a turn and take the bisector
  on the inside, so a join is always interior to a band and never straddles a cut;
- a deadband of one part in sixty-four, plus a minimum band length of sixteen spans, bound
  how many fills a stroke costs *relative to the boundary they ride on*. Measured on the
  performance fixture, whose pressure is an adversarial sawtooth, that holds at one fill
  per forty-six boundary vertices from a thousand samples to twenty thousand — 867 fills
  for a 20 000-sample stroke, which still leaves every frame inside its budget. A brush
  with `pressureOpacity` disabled resolves to one band and one fill, which is the same
  opacity guarantee `outline@1` gives.

The boundary is straight between samples, so unlike a stroked path a filled one must sample
closer together when zoomed. That is why the rendered scale is fixed when an evaluator is
created rather than asked for per frame: a scale supplied per frame would mean discarding
everything settled the moment the canvas zoomed.

**As implemented for `pencil@1`.** `stamps` carries an ordered `BrushStamp[]` -- position,
radius, coverage, and how many marks the stamp emitted -- plus the painted geometry as
*streaks*: for each, two flat number arrays of `x, y` pairs, one down each side, closed by
the painter into a shape that is pointed at both ends. A long stroke holds thousands of
streaks and tens of thousands of vertices, so they are coordinates in a flat sequence
rather than objects in a graph.

The row in the table above proposed `{x, y, width, height, rotation, alpha, grainPhase}`
per stamp. Three of those turned out to belong somewhere else:

- **There is one `alpha` for the whole geometry, not one per stamp.** This follows directly
  from D-030's consequence: tone varies by *which marks exist* rather than by how dark each
  one is, which is also what coverage physically means. What the marks are is then
  constrained by the rasterizer rather than by the medium — see below.
- **`grainPhase` is not a stamp field.** Grain is a field that marks are sampled against,
  so a phase stored per stamp would be a cached answer rather than the question.
- **Rotation is implied rather than stored.** A mark is already a quadrilateral built from
  the local tangent, so its orientation is in its corners. A chisel tip that needs an
  independent angle can still carry one; nothing here prevents it.

Marks are straight-sided rather than discs because a pencil at Folio's sizes is one to
three page units across, where a sub-pixel disc costs four cubics and a quad costs four
line segments. That difference is paid on every repaint of the stroke, not once.

E4.1 changed the *ends*. A streak used to be squared off, and a squared end at this scale
is a rectangle the eye can see -- across a broad tip the result read as brickwork. Each
streak now converges to a point at both ends, derived from its own last two cross-sections
so that nothing outside the arrays has to be remembered and a rewind stays a truncation.
Two extra vertices per contour, and the mark stops looking built.

### Contours are the cost, and they are quadratic

The single most expensive thing a stamped strategy can do in Canvas 2D is hand one
`fill()` a great many disjoint contours. Measured on the 20 000-sample live workload, where
the whole live stroke is repainted every frame:

| Contours | Vertices | Fills | Frame |
| ---: | ---: | ---: | ---: |
| 1 013 (`pressure-pen@1`) | 50 775 | 1 013 | 2.9 ms |
| 6 375 (Pencil, one fill) | 107 876 | 1 | 155.6 ms |
| 8 439 (Pencil, batches of 48) | 143 768 | 176 | 8.4 ms |

The third row has more contours and more vertices than the second and is eighteen times
faster; the only difference is that its path reaches the rasterizer in batches. Contour
count is the term that matters, the cost is quadratic in it *within one fill*, and it is
linear across fills. An early Pencil that emitted a contour per mark rather than per run
measured 195 ms a frame at a *quarter* of that length, and killed the renderer at full
length.

Two rules follow, and Marker will need both:

1. **Merge before you emit.** Marks that overlap along the stroke are one contour, not
   many. This is a property of the geometry, not an optimization of the painter: the
   evaluator must produce runs.
2. **Then batch, which requires disjointness.** Splitting the path is only safe if no two
   contours overlap, so the geometry has to guarantee that — Pencil divides its tip into
   filaments that *tile* it exactly and drift as one set rather than independently, so no
   filament can reach into the one beside it, and stops a streak short of the next streak
   in the same filament. Earn disjointness and the painter can bound contours per fill;
   skip it and the only safe arrangement is the quadratic one.

   E4.1 replaced the first half of that mechanism and the reason is worth keeping. The
   original earned disjointness by narrowing each mark before moving it, which left a
   sliver of paper between every pair of filaments — and a sliver that is present at every
   stamp is a continuous line down the whole stroke. The tiling form gives up the sliver
   and earns the same guarantee from monotonicity instead: an affine map of the lateral
   axis, shared by every filament of a stamp, moves the divisions without reordering them.

A stroke that crosses *itself* still darkens where it crosses, as `pressure-pen@1` already
does between bands. That is the one overlap the layout cannot remove, and for graphite it
is also the right answer.

## 15. Bounds and hit geometry

Every strategy supplies three pure, Canvas-free outputs:

| Output | Meaning | Consumers | Invariant |
| --- | --- | --- | --- |
| `logicalBounds` | the nominal ink extent: centerline inflated by half the nominal width | selection frames; "what did the artist draw" | tightest of the three |
| `visualBounds` | everything a repaint can touch: grain spill, scatter, cap and join overshoot | dirty rects, culling, thumbnails | contains `logicalBounds` |
| `hitGeometry` | a polyline with a radius per vertex | hit testing, eraser, future partial erase | independent of any renderer |

`OutlineCenterSample` is already exactly the `hitGeometry` shape and should become the
shared type rather than an outline-private one.

Per strategy: Technical Pen's three outputs are near-identical, differing only by cap and
join overshoot. Pressure Pen's `hitGeometry` is its variable-radius centerline. Pencil's
`visualBounds` must exceed its logical bounds by the grain and edge-roughness allowance.
Marker's oriented tip expands `visualBounds` by the tip's half-diagonal rather than its
half-width.

Two existing gaps this contract gives a home to, neither of which blocks Technical Pen: Ink
hit testing is currently bounds-only in the editor, and the centerline bounds helper
derives its radius from the stroke's *average* width, which understates a high-pressure
end.

**As implemented for `pressure-pen@1`.** `hitGeometry` exists and is the variable-radius
centerline, carried by the same geometry the painter reads, so there is no second pass and
nothing to keep in step. Editor hit testing stays bounds-only and stays strategy-independent;
supplying the radii is what this phase owed it, and consuming them is a separate change to
the editor rather than a strategy-shaped one.

Bounds are folded from each kept sample's own disc plus each cut's, which contains every
boundary point, corner arc and cap by construction — so they cannot under-report and leave
a trail on the canvas. Settled discs are folded once; the open tail is folded per frame, so
a bound costs the tail rather than the stroke, exactly as its geometry does.

## 16. Transforms

Established behaviour, verified in code:

- `Transform` is translation, rotation and **uniform** scale. Anisotropy does not exist.
- **Width does not scale with the object.** Geometry is rebuilt at `renderedScale` with
  radii divided by that scale, then the canvas scales back, so the painted width is
  constant in page units. Scaling a stroke lengthens it without thickening it.
- Geometry **is** regenerated per scale, cached per `(Stroke, scale)` with at most eight
  scale variants per stroke.
- Rotation is a canvas transform; geometry is not regenerated for it.

Brush-engine requirements:

- **Keep scale-compensated width as the default.** It is shipped behaviour, and changing it
  would silently alter existing artwork. If a strategy ever needs width to scale, that
  becomes an explicit durable per-strategy field — not a global change.
- **Strategies must be rotation-equivariant.** A rotated stroke is painted by rotating the
  canvas, so an oriented tip rotates with the object. That is the correct physical reading:
  rotating the paper rotates the mark.
- **Grain is anchored in the stroke's local space** (see §12), so texture travels with the
  mark under both translation and rotation, neither of which rebuilds geometry. A uniform
  *scale* does rebuild it, because the mark gets longer while its painted width does not
  and therefore needs proportionally more stamps. The grain field is addressed in painted
  page units, so the tooth keeps its physical size and its character across that rebuild;
  the particular cells a scaled mark lands on are not the ones it landed on before, and
  cannot be, because it is a different length of mark.
- **Do not assume isotropy in the model.** The `stamps` primitive carries independent
  width, height and rotation so that a future non-uniform transform has somewhere to land.

## 17. Eraser

Today: whole-object deletion, driven by `queryNearby` against the editor's bounds-based
engine, batching a continuous gesture into one History transaction.

The requirement that keeps the eraser strategy-independent is a single sentence: **the
eraser consumes `hitGeometry` and nothing else.** With that, whole-object erasing works for
every present and future strategy with zero per-strategy code.

Partial erasing, when it is eventually scoped, is the model-level operation "split one Ink
object into N by removing a range of `sourceSamples`". It is also strategy-independent —
**provided every strategy remains a pure function of samples plus snapshot.** That is the
strongest practical argument for the rule below, which is therefore stated as a hard
boundary rather than a preference:

> No strategy may store derived geometry in the document. The moment geometry is durable,
> partial erase, transform and every future edit become per-strategy problems.

## 18. Export and offscreen rendering

The preview primitives already prove this is achievable: `renderPageThumbnail`,
`renderPagePaperPreview` and `renderPageLayerPreview` are pure functions of a context and a
page, and they already reuse the compositor's own per-object helpers.

Requirements on the brush engine:

- **No dependence on the mounted canvas.** Not the viewport, not the DPR, not the render
  scheduler, not the DOM.
- **`renderedScale` stays an explicit parameter.** It is never read from a global.
- **No strategy reads `devicePixelRatio`.**
- **Texture resources are resolvable without a filesystem.** Procedurally generated, or
  decoded from data embedded in the project. Never an absolute path, and never
  `StrokeStyle.brushTextureId` as it stands.

The interface to define is `BrushPainter`, with one method per geometry primitive. One
renderer interface then serves the live editor, the committed compositor, thumbnails, layer
previews, export and any future client.

## 19. Canvas 2D and the backend boundary

No WebGL or WebGPU in this phase, and Canvas 2D remains the first backend.

The architecture is backend-neutral if and only if a strategy's output is **data** rather
than draw calls. Today `drawBrushRenderGeometry` and `StrokeVisual.draw(context)` are draw
calls, which is the only thing standing between the current design and a future GPU
backend. Splitting "produce geometry" from "paint geometry" costs one refactor of two
functions.

With that split, a GPU backend requires **no change** to the document model, `Stroke`,
`ResolvedBrushSnapshot`, the preset catalogue, brush evaluation, the codec, History,
selection or the eraser. Only a second `BrushPainter`.

## 20. Proposed core types

Minimal, non-speculative, and deliberately incomplete where a decision has not been earned
yet.

```ts
// --- identity and versioning -------------------------------------------------
type BrushStrategyId =                   // grows per phase
  | "centerline" | "outline" | "technical-pen" | "pressure-pen" | "pencil";
interface BrushRendererDefinition {      // the existing durable field, widened
  readonly version: number;
  readonly kind: BrushStrategyId;
}

// --- dynamics ----------------------------------------------------------------
interface BrushPressureResponse {        // unchanged
  readonly enabled: boolean;
  readonly minimumFactor: number;
  readonly maximumFactor: number;
  readonly curve: BrushPressureCurve;
}
interface BrushTaper {                   // new, and not a pressure curve
  readonly startLength: number;          // page units
  readonly endLength: number;
  readonly minimumFactor: number;
}

// --- evaluation --------------------------------------------------------------
interface BrushEvaluationContext {
  readonly snapshot: ResolvedBrushSnapshot;
  readonly renderedScale: number;        // explicit; never read from a viewport
  readonly seed: number;                 // derived from stroke id, not stored
}
interface BrushSample {                  // one evaluated point along the path
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
  readonly progress: number;             // 0..1 along the stroke
}

// --- geometry ----------------------------------------------------------------
type BrushGeometry =
  | { readonly kind: "stroked-path"; readonly path: InkPath; readonly width: number }
  | { readonly kind: "filled-path"; readonly boundary: readonly Point[];
      readonly roundJoins: readonly Disc[]; readonly dot: Disc | null }
  | { readonly kind: "stamps"; readonly stamps: readonly BrushStamp[] };

interface BrushStamp {                   // as shipped; §14 records what moved and why
  readonly x: number; readonly y: number;
  readonly radius: number; readonly coverage: number;
  readonly markCount: number; readonly index: number;
}

// --- strategy ----------------------------------------------------------------
interface BrushRenderStrategy {
  readonly id: BrushStrategyId;
  readonly version: number;
  evaluate(points: readonly StrokePoint[], context: BrushEvaluationContext): BrushGeometry;
  logicalBounds(geometry: BrushGeometry): Rect;
  visualBounds(geometry: BrushGeometry): Rect;
  hitGeometry(geometry: BrushGeometry): readonly BrushSample[];
}

// --- backend -----------------------------------------------------------------
interface BrushPainter {
  paint(geometry: BrushGeometry, snapshot: ResolvedBrushSnapshot): void;
}
```

Deliberately absent until a strategy needs them: `BrushTip`, `BrushSpacing`, grain
parameters, jitter channels, and any piecewise curve kind. Adding a field before a strategy
reads it makes it durable before it is understood.

## 21. Package ownership

| Concept | Package | Why |
| --- | --- | --- |
| `BrushPreset`, `ResolvedBrushSnapshot`, dynamics, curves | `@folio/ink` | durable model; must stay platform-neutral |
| brush evaluation, spacing, PRNG, velocity and orientation derivation | `@folio/ink` | pure functions of samples and snapshot |
| strategy registry, strategies, geometry primitives | `@folio/ink` | the engine itself |
| `BrushPainter` interface and its Canvas 2D implementation | `@folio/ink` | first backend, behind the interface |
| preset catalogue, slot state, identity mapping | `@folio/editor` | product configuration and tool preferences |
| codec vocabulary widening | `@folio/persistence` | it already owns validation |
| tool dock, radial library, rails, cursors | `apps/desktop` | UI only |

Direction stays `rendering <- ink <- document <- persistence/selection <- editor <- desktop`.
Nothing inverts, and no package widens.

**React and Electron must never enter `@folio/ink`.** One existing wart to contain rather
than fix: `@folio/ink` depends on `@folio/rendering` and hosts `StrokeRenderer`, a Canvas 2D
and `requestAnimationFrame` renderer. That is shipped and works; moving it buys the brush
engine nothing. The rule is narrower and sufficient: **add no new Canvas 2D coupling to
`@folio/ink` outside the painter.**

The 45-identity catalogue should move from `apps/desktop` to `@folio/editor` **when
identities gain real behaviour** and stop being a UI list. Not before.

## 22. Existing code

**KEEP** — correct as designed, no change expected.

`PointerInputController` and its normalization; `StrokeBuilder`'s sample retention and
stationary-sample policy; `Stroke` immutability and `sourceSamples`; `createBrushPreset`,
`resolveBrushPreset`, `createResolvedBrushSnapshot`, `resolveBrushForPointerType`;
`evaluatePressureResponse`; `InkObject`, `Transform`, `ObjectFactory`, `PageDocument`;
History and every command; the preview primitives; the codec's structure and strictness;
the `(Stroke, scale)` geometry caches.

**EXTEND** — evolves, keeps its shape.

`BrushRendererDefinition` (strategy vocabulary); `internal/brush-render-strategy.ts`
(conditional to registry); `StrokeRenderer` (settled-prefix live path);
`project/ink-codec.parseBrush` (widened vocabulary, strict refusal);
`internal/outline-geometry.ts` (becomes `pressure-outline@1`; its `OutlineCenterSample`
becomes the shared hit geometry); `StrokeVisual` (geometry and painter split);
`internal/professional-ink-path.ts` (a prefix-stable tolerance for new strategies, with the
whole-stroke behaviour preserved for `centerline@1` and `outline@1`).

**REPLACE LATER** — frozen, kept for fidelity, not built on.

`internal/draw-stroke.drawStrokePoints` — the live incremental path and the source of the
divergence; its only shipped user is the one zero-smoothing centerline preset.
`StrokeStyle` — a parallel appearance authority, durable in v1 and therefore unremovable.
`StrokePoint.{velocity, acceleration, delta}` — durable derived data.
`createLegacyBrushSnapshot` — keep for decoding, stop minting.

**REMOVE EVENTUALLY** — no value, and one active hazard.

The inline `resolveBrush` fallback in `CanvasSurface.tsx` that mints `editor-default-pen`
and `editor-default-highlighter` — a catalogue hiding in a component.
`StrokeStyle.brushTextureId` — unwritten, unread, unvalidated, and exactly the external
reference shape durability forbids; **texture must not be built on it**. `SmoothingHook`
and the `catmull-rom` / `bezier` smoothing modes — decodable values with no implementation.

## 23. Prerequisite refactors

**MUST DO BEFORE TECHNICAL PEN** — one item, and it is small.

1. Widen `BrushRendererDefinition` in `@folio/ink` and `parseBrush` in the codec into a
   strategy vocabulary, and register `centerline@1` and `outline@1` as frozen entries in a
   registry. Without it there is nowhere to put a new strategy that does not redefine an
   existing one. This is two validators and a lookup table, and it belongs in E2's first
   commit rather than in a phase of its own.

**SHOULD DO AS PART OF TECHNICAL PEN**

2. Split geometry production from painting (`BrushGeometry` plus `BrushPainter`).
3. Implement the settled-prefix live contract and its parity test.
4. Give the new strategy a prefix-stable fitting tolerance derived from `brush.size`.
5. Move the inline `CanvasSurface` fallback snapshot into `@folio/editor` as a named preset.

**CAN WAIT FOR PRESSURE PEN**

6. Make `pressureOpacity` actually render.
7. Add taper as a durable dynamic in its own right.
8. Add the shared velocity derivation.
9. Unify zero-length, single-tap and terminal-sample handling across strategies.

**CAN WAIT FOR PENCIL AND MARKER**

10. ~~Spacing and stamp evaluation.~~ Shipped with `pencil@1`: an arc-length cursor over
    the smoothed centerline, advancing by a fraction of nominal diameter.
11. ~~The deterministic PRNG and grain phase.~~ Shipped as `internal/brush-random.ts`; the
    phase became a spatial field rather than a per-stamp value (§12).
12. The `logicalBounds` / `visualBounds` split. Still one number; Pencil's two differ by
    its bounded jitter allowance, which no consumer has yet needed separated.
13. ~~`hitGeometry` as a first-class strategy output~~ -- shipped for both `pressure-pen@1`
    and `pencil@1`. The eraser consuming it rather than object bounds is still open, and is
    an editor change rather than a strategy one.
14. Move the 45-identity catalogue into `@folio/editor`.

**DEFER AFTER V1**

15. Anisotropic transforms. 16. Partial-stroke erasing. 17. A GPU backend. 18. A custom
pressure-curve editor and the `piecewise` curve kind. 19. Retiring `StrokeStyle` and the
persisted derived point fields — all of which need a format change and should be bundled
with any future v2 rather than motivating one.

## 24. Persistence compatibility

What already survives Save and Open, exactly: the whole `ResolvedBrushSnapshot` including
`renderer`, `smoothing` and both pressure responses; `sourceSamples` with position, timing,
pressure, tilt, twist, buttons, pointer type and the optional altitude/azimuth pair;
processed `points` with their derived fields; `StrokeStyle`; metrics; statistics; the
object's `transform`, `metadata` and `renderingHints`.

What Technical Pen requires that is not already durable: **nothing**. A deterministic,
constant-width, pressure-free solid stroke is expressible today as
`pressureSize.enabled: false` with a fixed `size` — every value it needs already round
trips.

What Technical Pen requires that is not already *legal*: one widened field value,
`renderer.kind === "technical-pen"`. That is a decode-vocabulary change inside
`formatVersion 1`, not a schema change (§7).

Two open extension channels exist in the format — `metadata` and `renderingHints` are
free-form JSON that round-trips. **Neither may be used for brush state.** Durable brush
authority lives on the snapshot; routing it through an object-level bag would create the
second authority this whole design exists to prevent.

**`.folio` formatVersion stays at 1, and E1 changes nothing about the format.**

## 25. Migration of existing strokes

There is no migration, and that is the design rather than an omission.

Existing strokes carry `{version: 1, kind: "centerline"}` or `{version: 1, kind:
"outline"}`. Those two strategies are frozen at today's behaviour and keep their existing
code paths. An old stroke opened in a Folio that has Technical Pen renders exactly as it
rendered before, down to the average-width flattening.

Rejected alternatives, and why:

- *Remap old centerline strokes onto Technical Pen.* Technical Pen will not flatten pressure
  to an average, so every pressure-enabled centerline stroke would change appearance on
  open. That is a silent visual change to saved artwork.
- *Fix `centerline@1` in place and call it a bug fix.* Same outcome, with the added problem
  that a file would look different depending on which build opened it.
- *Migrate on open.* Destructive, unasked-for, and unattributable to any user action.

If an artist ever wants old work re-rendered with a newer strategy, that is an explicit
per-object command producing an ordinary History entry, and it is undoable.

## 26. Catalogue mapping

Forty-five identities, nine backing presets, and a target of **four** strategies plus two
frozen legacy entries. No strategy is created to serve a name.

| Group (identities) | Current preset | Proposed strategy | Differentiating parameters | Unknowns |
| --- | --- | --- | --- | --- |
| Fineliner, Gel Pen, Ballpoint, Rollerball, Bold Liner, Ink Pen, Contour Pen | `pen-fineliner` | `technical-pen` | size, smoothing, opacity | Ballpoint arguably wants slight pressure-opacity, which is Pressure Pen territory |
| Technical Pen, Micro Liner, Drafting Pen, Fine Ink, Ruling Pen | `pen-technical` | `technical-pen` | size, smoothing | **Ruling Pen** implies constrained straight-line drawing, which is a *tool*, not a brush |
| Mechanical Pencil, Draughting Pencil, Fine Lead | `pencil-mechanical` | `technical-pen` | size | could instead be `pencil` at very low grain; needs a visual decision |
| Brush Pen Soft, Brush Pen Firm, Fountain Pen, Calligraphy Pen, Sign Pen, Dynamic Pen | `pen-brush` | `pressure-pen` | pressure range, curve exponent, taper | **Calligraphy Pen** and **Fountain Pen** want an oriented chisel tip, which is marker geometry with pen opacity. **Dynamic Pen** names no defined behaviour |
| HB Pencil, Hard Pencil, Layout Pencil, Blueline Pencil | `pencil-hb` | **`pencil@1`, shipped** | hardness, grain strength, coverage, default colour | Blueline's non-black default is a preset default, not a strategy |
| Soft Pencil, 2B Pencil, Sketch Pencil, Contour Pencil | `pencil-2b` | `pencil` | hardness, grain, pressure range | |
| 4B Pencil, 6B Pencil, Shading Pencil, Broad Lead | `pencil-4b` | `pencil` | hardness, grain, size, edge roughness | tilt shading is deferred; these are the presets that will want it first |
| Fine Marker, Felt Marker, Bullet Marker, Sketch Marker, Layout Marker, Slim Marker | `marker-felt` | `marker` | round tip, size, flow | |
| Broad Marker, Chisel Marker, Wide Marker, Studio Marker, Block Marker, Flat Marker | `marker-broad` | `marker` | **chisel** tip: width, height, angle; flow | tip angle fixed to the preset, or driven by azimuth? needs a product decision |
| *(no library identity)* | `highlighter-default` | `marker` | very low alpha, high flow | highlighter wants multiplicative overlap, which Folio's single-alpha compositing does not express today |
| *(existing artwork only)* | — | `centerline@1`, `outline@1` | frozen | none |

Marker terminology, since the four words are used loosely everywhere:

- **opacity** — the alpha of the finished stroke as a whole. One value, applied once.
- **flow** — the alpha of an individual stamp. Low flow with tight spacing builds up.
- **coverage** — how much of the nominal footprint a stamp actually inks, that is, the
  tip's own density profile. Independent of both of the above.
- **compositing** — how overlapping marks combine. Folio composites source-over with one
  alpha today, and within a single stroke `outline@1` deliberately fills once so joins do
  not accumulate. Whether two *separate* marker strokes should darken where they cross is
  an unanswered product question, not an engine detail.

## 27. Phase scope

### E2 — Technical Pen

The reference strategy. Every later strategy is described relative to it.

In: `technical-pen@1` as a `stroked-path`; deterministic output; stable width from
`brush.size` with pressure ignored; stable opacity; predictable smoothing; high-quality
joins and caps; the strategy registry; the geometry and painter split; the settled-prefix
live contract; a prefix-stable fitting tolerance; the widened codec vocabulary.

Out: texture, scatter, tilt, randomness, wet-media build-up, any change to `centerline@1`
or `outline@1`, any change to the format, any Phase D optimization.

### E3 — Pressure Pen

Technical Pen plus dynamics. The split that matters:

| Belongs to shared brush evaluation | Belongs to the strategy |
| --- | --- |
| pressure to size factor | variable-width outline construction |
| pressure to opacity factor | join and cap geometry at varying radius |
| taper as a function of progress | the terminal dot case |
| velocity derivation and smoothing | how width maps to boundary offset |

Shared evaluation is reusable by Pencil and Marker; outline construction is not. Keeping
that line sharp is what stops E3 from becoming a second engine.

**As shipped.** Pressure to size and pressure to opacity are shared, evaluated through
`evaluatePressureResponse` and `brushSizeAtPressure`; variable-width boundary
construction, its corners and caps, and the terminal dot belong to the strategy. The line
held: `pressure-pen@1` is about four hundred lines and imports no legacy geometry.

Two items on the left of that table did not ship, deliberately. **Taper** is a function of
progress rather than of pressure, has no durable field, and faking it by bending a pressure
curve would put a lie in every saved file. **Velocity** is not derived at all: Pressure Pen
is pressure-driven, and a durable velocity response would have expanded E3 into a different
brush. Both remain for a focused follow-up.

One rule was added that the table does not mention, because it belongs to neither column:
**a mouse's synthetic pressure must not drive expression.** An `outline@1` preset answers
that by resolving to centerline; a strategy that reads pressure per sample keeps its own
strategy and resolves its responses off instead, so the mark is the brush exactly as
configured. See D-030.

### E4 — Pencil

The first dry medium, and the first strategy to emit `stamps`.

In: `pencil@1`; distance-based stamp placement with an incremental arc-length cursor; a
deterministic grain field; pressure driving coverage and width through the durable
responses already in the model; bounded edge roughness; the stamp stream as hit geometry.

Out: tilt and side-of-pencil shading, per-hardness physics, wet media, external texture
assets, any change to a frozen strategy, and the rest of the catalogue.

**As shipped.** The section above expected hardness, grain strength, edge roughness and
spacing to become durable fields. **None of them did, and none should until an artist can
set one.** They are strategy constants pinned by `pencil@1`, which is exactly what a
version is for: a field added before a preset varies it is a durable promise with nothing
behind it, which is the mistake `pressureOpacity` and `brushTextureId` each made once
already. When per-hardness presets arrive they will need real parameters; that is the phase
that should add them.

Texture is deterministic and procedural, as predicted, and no bitmap is generated per
stroke. What the prediction got wrong is its *address*: the grain is a pure function of
`(seed, painted position)` rather than of `(seed, position, index)`, for the reasons in
§12.

Two decisions carry the rest of it, and both follow from Canvas 2D rather than from
pencils:

- **Pressure moves coverage, not alpha.** Varying *which marks exist* is the only tonal
  variation Canvas 2D can express without compositing an overlap twice, and it happens to
  be what coverage physically is. The marks are then laid out so that no two of them
  overlap, which is what lets the painter batch them — §14 has the measurement that makes
  this the whole shape of the strategy.
- **Coverage reads `pressureOpacity`.** For a dry medium a lighter touch leaves less
  graphite rather than translucent graphite, so that response — "how much medium pressure
  lays down" — is read as coverage. It is a per-strategy reading of one durable field, not
  a second field, and `(kind, version)` pins it for ever.

Measured in [`../performance/pencil-e4.md`](../performance/pencil-e4.md).

### E4.1 — Pencil fidelity

The architecture above survived contact with the artwork. The picture did not.

E4's Pencil satisfied every contract in this document and still read as a patterned brush
rather than as graphite: at a broad size it painted a small number of parallel tracks of
rectangular dashes, with a mathematically clean edge around an artificially noisy interior.
Every one of those defects was the implementation showing through, and the phase was opened
to remove them without touching anything that already worked.

Nothing durable changed, no strategy was added, and `technical-pen@1` and `pressure-pen@1`
kept byte-identical digests. `pencil@1` itself was re-pinned, which is allowed exactly once
and only here: it had never shipped in a release, so no saved artwork could be looking at
the old appearance. A second refinement after a release is `pencil@2`.

What changed, and why each one is a rule rather than a tweak:

- **The tip's divisions drift.** Filaments at fixed offsets paint rails. Two smooth fields
  in the artwork's space — one sliding the whole set sideways, one breathing it wider and
  narrower — wander them while preserving their order, which is what keeps them disjoint.
- **The divisions tile the tip.** The gap that used to earn disjointness was itself a line.
- **The tip has a profile.** Deposition is certain through a boosted core and fades to
  nothing past the rim, so the edge is made of grains rather than of a boundary, and a
  two-pixel pencil still draws a continuous line.
- **Graphite clumps.** One smooth field modulates deposition, sized against the tip rather
  than fixed in page units — a cluster wider than the tip gates every filament at once and
  a small pencil comes out dashed.
- **Streaks are pointed, and cut at addressed stamps.** Squared ends read as brickwork; a
  cut that depended on how long a streak happened to be moved the gaps when pressure
  changed, which broke the one property §12 exists to protect.

The last of those is the phase's general lesson, and it is the same lesson as the drift
fields one level down: **anything periodic and shared across the tip becomes visible
structure.** A single shared streak limit put a faint rung across the stroke every dozen
page units. Per-filament limits and phases, drawn from the seed, scattered them. Marker will
divide a wider tip and will meet this sooner.

Measured in [`../performance/pencil-e4-1.md`](../performance/pencil-e4-1.md).

### E4.2A — Pencil hybrid material foundation

One alpha a stroke is the ceiling of a geometry model, and E4.1 reached it. A pencil's tone
is *how much graphite a patch of paper holds*, which varies continuously and builds where a
stroke crosses itself; past the approximation E4.1 makes, the medium has to be deposited
into a raster the strategy owns rather than drawn as contours.

E4.2A landed that model in production and connected none of it; E4.2B connected it and
retired the geometry model. The two are recorded separately because the first is about what
a mark is made of and the second is about when it appears.

In: built-in generated nib and paper resources with versioned identities and one shared
decode; the hybrid deposition equation and its passage accumulation; page-space field
addressing; distance placement with a settled prefix; the material tile lattice; compact
committed tiles; the packed tile-to-dab index; deterministic single-tile reconstruction; and
the runtime that owns the cache.

Out, and E4.2B's: the cooperative scheduler, cancellation, global budgets and eviction,
cross-stroke fairness, viewport reconstruction, local repaint, the live editor path, and
transform integration.

Four decisions carry it, and the first is the one that made the phase cheap:

- **The strategy version is the durable resource identity.** A stroke names `pencil@1`;
  `pencil@1` names its nib and its sheet. No field was added to the format, no
  `formatVersion` moved, and `StrokeStyle.brushTextureId` was not repurposed — see §30 and
  [D-033](../DECISIONS.md).
- **`pencil@1` keeps its identity.** A version exists so that saved artwork keeps looking
  the way it looked, and nothing is looking at this one yet. Creating `pencil@2` now would
  freeze a pre-release appearance nobody approved. After the release that ships Pencil, the
  same refinement is `pencil@2` — the E4.1 rule, unchanged.
- **The nib moves with the dab; the sheet does not.** Deposition happens in page space at a
  fixed material resolution with no rendered scale in it, which is what lets a finished mark
  move with its object under §16 rather than resampling a different patch of paper.
- **One equation serves live and cold.** A medium with a drawing algorithm and a separate
  redraw algorithm changes under the artist the first time a cache is dropped.

The cache boundary is the load-bearing one, and it is narrower than it looks: material is a
**derived cache owned by the runtime**, and the moment a tile is reachable from `Stroke`,
History, a document or the codec, dropping it stops being free, undo has pixels in it, and a
save has a cache in it.

Recorded in [`pencil-material-e4-2.md`](pencil-material-e4-2.md).

### E4.2B — Pencil runtime, cache and the editor switch

The foundation was exact and unreachable. E4.2B connected it, and the editor now draws
`pencil@1` as deposited material.

In: the project-runtime-owned material cache with hard 64 MiB material and separate 16 MiB
index budgets; the cooperative 4 ms scheduler with rotate fairness, a 16-job scratch cap,
generation ownership and cancellation; visible-first reconstruction with progressive
publication of exact tiles; hot-cache bypass; local active painting; the transform policy;
and the removal of the geometry model it replaced.

Out, and deliberately: GPU, Marker, background prefetch, predictive page loading, per-pixel
erasing, and any material awareness in selection or the eraser — both read the dab stream
exactly as they read the stamp stream before.

Four things carry it, and three of them are about *when* rather than *what*:

- **The runtime owns the cache, guarded by `RuntimeActivation`.** A slice that began
  legitimately and finishes after its project has been replaced finds ownership gone and
  publishes nothing. That one check is what makes New, Open and window handoff safe.
- **A frame repaints its tail, not its stroke.** The renderer had an incremental evaluator
  in front of a full repaint, which for a medium made of pixels would cost more the longer
  the artist drew. See [D-035](../DECISIONS.md).
- **Nothing approximate is ever drawn.** An approximation of a texture is a different
  texture, so a tile that is not resident is left bare until its exact bytes arrive.
- **Scale scales the graphite.** Material is deposited once in the artwork's frame and
  transformed when painted, which is the only reading under which moving or resizing an
  object does not resample the sheet. Pencil and the pens now disagree about scale on
  purpose — see [D-036](../DECISIONS.md).

The geometry model, `drawStamps` and the `stamps` primitive were removed once nothing
reached them, so bounds, hit geometry and the material share one placement implementation
and one `FULL_COVERAGE`. `pencil@1`'s freeze digests were re-pinned for the second and last
time before release.

Recorded in [`pencil-material-e4-2.md`](pencil-material-e4-2.md).

### E4.2C — Presentation tiles, and a corrected diagnosis

E4.2B recorded a long frame and attributed it to presentation-tile creation. E4.2C measured
it and found that attribution wrong in every part: presentation is 0.2 ms a tile and twenty
five tiles a workload, and the long frame happens a second and a half into drawing rather
than at commit. What remains is a single collection pause that neither a CPU profile nor a
timeline trace reproduces -- recorded with its evidence in
[`../performance/pencil-e4-2.md`](../performance/pencil-e4-2.md) rather than assigned a
cause it has not been shown to have. See [D-038](../DECISIONS.md).

The presentation work was still done, on the strength of the measurement rather than the
guess: a tile's drawable form is a second phase of the same reconstruction job, so it
inherits the priority classes, the rotation, the concurrency cap, generation ownership and
every cancellation path unchanged, and a paint builds at most eight of them inline before
handing the rest over. The scheduler asks whether a tile is *ready* rather than resident,
which is what makes a tile adopted at commit -- material complete, drawable form missing --
a job rather than work inside a frame.

Two defects were fixed on the way. The material cache was keyed by stroke id alone, and
`applyInkStyle` keeps the id while changing width and opacity, so a restyled mark was served
the graphite of the mark it used to be -- see [D-037](../DECISIONS.md). And a unit test
introduced in E4.2B asserted a wall-clock slice bound, which this repository keeps behind its
performance flag for good reason; it failed about one run in three under load and now asserts
structure instead.

### E4.2D — Where a tile is put, and when it is handed over

Two defects a person reported from the running application, neither of them in the material.

**A pale grid through broad Pencil.** Tiles abut exactly in page space and the deposited
alpha runs across the join without a step -- both were checked first, so that the rest of
the work was known to be about compositing. Neither survives rasterization: each `drawImage`
is antialiased on its own, so a shared boundary between two device pixels is covered partly
by one tile and then partly by the other, and two partial coverages do not add up to one.
Tiles are now placed on whole device pixels, with both neighbours rounding the same page
coordinate so they agree by construction. See [D-039](../DECISIONS.md).

**A flicker when the pencil is lifted.** Sampling every animation frame across pointer-up
found one frame with the mark on neither surface, then a frame carrying 46% of it. Two
causes: the live layer was cleared synchronously while the compositor's repaint waited for
the next animation frame, and the inline presentation limit -- which exists to protect a
cold viewport -- was rationing the tiles of a mark the artist had just finished. The render
is now flushed inside the same task, and a stroke the runtime is handing over finishes in
one frame. See [D-040](../DECISIONS.md).

Deposition is untouched: the nib, the fields, the pressure model, the accumulation rule and
the spacing are all unchanged, and the resource and strategy freeze digests are unmoved.

### E4.2E — The seam, and an experiment that could not fail

E4.2D placed tiles on whole device pixels and the grid was still there at high zoom. Two
different mistakes, recorded because they are different kinds.

**Alignment is not a property one operation can have.** The live path repaints a tile by
clearing it and redrawing it, and only the drawing had been aligned; the clear and the clip
were still derived from page coordinates, so a clear whose edge fell between pixels partly
erased the neighbouring tile's graphite while the neighbour was not dirty. Measured on the
live layer: thirty-two units of graphite short along every boundary, nine standard
deviations outside ordinary variation. Invisible on the compositor, which redraws whole
objects -- which is why the lines changed when the pencil was lifted, and why that change
was the clue. See [D-041](../DECISIONS.md).

**And the verification could not have failed.** E4.2D's controlled comparison used uniform
tiles, and clamping a constant returns the same constant, so it could not detect edge
sampling at all. Repeated with a varying field against a contiguous reference, the defect is
exact: zero difference everywhere, 10.5 tone units within one pixel of a boundary, only once
a tile is magnified past 1:1. A presentation now carries one cell of each neighbour and the
painter blits the inner square, letting the filter reach into the ring. See
[D-042](../DECISIONS.md) and [D-043](../DECISIONS.md).

The uncomfortable part is kept: this seam preserves average tone and is flanked by flat
clamped runs, so neither a brightness statistic nor an averaged gradient resolves it in the
running editor. It was settled against ground truth in a fixture and confirmed by magnified
pictures.

Deposition is untouched: the resource and strategy freeze digests are unmoved.

### E4.3A — The Pencil visual freeze

The artist drew with the production Pencil and approved it, so `pencil@1`'s artistic output
is frozen from here. The freeze is a pinned value and not an intention: page-cell digests of
eleven fixtures across nine shapes, four widths and three pressures, the three pressure
readings of one path, and the two generated fields. Live, committed and cold deposition are
each asserted *against* the pinned value rather than only against each other, because three
paths moving together is exactly what a memory optimization does and mutual agreement cannot
see it. See [D-044](../DECISIONS.md) and
[`pencil-material-e4-2.md` §25](pencil-material-e4-2.md).

Runtime mechanics are deliberately **not** frozen — scheduler timing, eviction order, memory
layout, allocation strategy, Canvas reuse, collection behaviour — because the next phase
rewrites them. The 26-page-unit collection pause is unchanged and unexplained; it is
performance debt, not visual debt.

Every gate in the freeze was shown able to fail before it was trusted. A thirteen-parts-in-a-hundred-thousand
change to one tone constant fails all seven digest assertions. The pressure-superset claim
needed two forms: read on the shipped preset a firm tip is nearly twice the radius of a light
one, so the wider footprint absorbs a one-and-a-half-cell displacement without the subset
breaking; with the size response off, a single cell breaks it.

A roster test derives the five shipped strategies from the vocabulary and requires each to
name a gate, so a strategy cannot ship without one. A refinement to an approved appearance
is a new strategy version, never an edit to a digest.

### E4.3B — The long task was not Pencil's

This phase was briefed as a Pencil allocation and garbage-collection pass and did not become
one, because the measurement did not support it. Two findings, in the order they were needed.

**The broad fixture was never created.** Every mounted Pencil measurement set the brush width
through a `window.__folioDrawingActions.setSize` hook that does not exist in the application;
optional-chained, it was a silent no-op, and the "12 px" and "26 px" workloads were both
drawn at the preset's own 2 page units. The size control is real and runs 0.5 to 40, so the
fixture was always reachable. The specs now drive it and read the value back.

**The block fires three seconds after pointer-up.** Raising the post-stroke settle past the
recovery capture's debounce moves it out of the stroke entirely: six runs out of six at
2.98 s after the previous pointer-up, against the only three-second constant in the
application. Its cost is linear in the samples in the document at 0.05–0.07 ms each — the
1 620 ms case is a 12 page-unit stroke and the 417 ms case is 26 — and the only JavaScript
frames in a profile of it belong to the project codec. It is the recovery capture, it would
behave identically with any brush, and more than half of it is not JavaScript at all.

**Pencil's drawing path had no allocation problem.** V8's sampling heap profiler across a
42-second, 5 000-sample, 26 page-unit stroke: 2.1 MB, about 50 KB a second, 82% of it
`freezePoint` and `freezeSourceSample` freezing the finished `Stroke` once. Nothing per-frame
registered above a 4 KB sampling floor. With typed arrays accounted from the runtime's own
numbers the whole stroke allocates about 9 MB — 0.2 MB a second — and across 5 700 frames
exactly two intervals exceed one display period: the handover frame, and the capture. So
nothing was optimized. See [D-045](../DECISIONS.md) and
[`../performance/pencil-e4-3.md`](../performance/pencil-e4-3.md).

The hitch is real and is persistence's: a capture landing after the artist has begun a new
mark blocks that mark, and `RECOVERY_MAXIMUM_AGE_MS` interrupts any stroke past thirty
seconds on purpose. A 5 000-sample stroke encodes to 5.6 MB of JSON.

`pencil@1`'s freeze digests are unmoved; no production Pencil code was touched.

### Later — Marker

Durable: tip profile (round or chisel), tip width, height and angle, flow, coverage,
spacing. Derived: the stamp stream and its alpha accumulation. The within-stroke rule is
already settled by `outline@1`'s precedent — apply stroke opacity once, so a stroke does not
darken at its own joins. Between separate strokes is the open question in §26.

## 28. E2 performance acceptance

Same harness, same machine, `FOLIO_PERFORMANCE_BASELINE=1`, foreground-guarded, metric
names as they already exist in `tests/performance`. Technical Pen is a `stroked-path`, so
its comparison is **centerline**, not outline.

| Metric | Phase D reference | E2 acceptance | Fail |
| --- | --- | --- | --- |
| `live/technical-pen/100/1/callback-work` p95 | centerline 1.6 ms | <= 2.4 ms | > 4 ms |
| `live/technical-pen/100/1/input-to-callback-end` p95 | centerline 9.0 ms | <= 10.5 ms | > 12 ms |
| frames over 16.67 ms, 100/1 | 0 of ~200 | 0 | any |
| `live/technical-pen/5000/16/input-to-callback-end` p95 | centerline 14.0 ms | <= 16.67 ms | > 33 ms |
| frames over budget, 5000/16 | 0 of 4 952 | <= 1% | > 5% |
| `live/technical-pen/20000/64/input-to-callback-end` p95 | centerline 51.9 ms | <= 51.9 ms expected, <= 60 ms accepted | > 60 ms, investigate |
| `stroke/5000/technical-pen/geometry` p50 | centerline 22.7 ms | <= 25 ms | > 30 ms |
| `stroke/20000/technical-pen/geometry` p50 | centerline 103.8 ms | <= 115 ms | > 130 ms |
| scaling exponent, 1k to 20k | 0.96–1.05 | <= 1.15 | > 1.25 |
| `stroke/{n}/technical-pen/finalize` | centerline 0.4–0.5 ms | <= centerline + 25% | > +50% |
| geometry cache | 8 scale variants max | `getStrokeRenderCacheSnapshot().outlineScaleCount <= 8`; no per-frame allocation proportional to stroke length | any growth per frame |
| `.folio` size, 500-stroke fixture | 38 190 277 bytes | byte-identical | any growth without a named durable field |

Plus one regression guard: **every existing `live/centerline/*`, `live/outline/*` and
`stroke/*` metric must stay within ±10% of its Phase D value**, because E2 touches neither
path. That guard is what actually answers "did the brush engine regress drawing?", and it
is answered by re-running `FOLIO_BASELINE_GROUPS=live,stroke` and diffing.

The 20 000-sample expectation deserves saying plainly: the settled-prefix design should
make long strokes *faster*, not merely no slower, because it removes the per-frame full
rebuild. A Technical Pen that merely matches centerline at 20 000 samples has not
implemented the contract in §13.

**Result.** Measured in [`../performance/technical-pen-e2.md`](../performance/technical-pen-e2.md).
Every criterion is met with room to spare: live callback work is 0.6 ms p95 on a short
stroke and 2.3 ms at twenty thousand samples, input-to-callback-end holds at 8.6-8.7 ms at
every length, no frame exceeded the budget in any workload, and geometry costs roughly a
fourteenth of centerline. Both frozen strategies stayed inside the ±10% band.

### Architecture decisions that would make the baseline worse

Each proposed layer, and the unit its cost scales with. The rule to enforce is that **no
live per-frame step may be O(total stroke length)** — the rule today's outline path breaks.

| Layer | Cost unit | Live cost per frame |
| --- | --- | --- |
| Pointer normalization | per pointer event | O(1) |
| Stationary-sample filter | per event | O(1) |
| Velocity derivation | per sample, windowed cursor | O(1) amortized |
| Fitting and resampling | per new sample inside the tail | O(tail) |
| Brush evaluation | per resampled point or stamp | O(1) each, closed form |
| Spacing | per stamp, arc-length cursor | O(1) each |
| Randomness | per stamp per channel, index-derived | O(1) each |
| Geometry build | per new segment or stamp | O(new) |
| Paint | per visible new primitive | O(new), dirty-rect clipped |
| Commit | per stroke | one full evaluation |

Specific choices to refuse: routing every strategy through outline geometry for uniformity
(multiplies the measured 1.8x constant across all brushes); rebuilding the full stamp stream
per frame (reintroduces the quadratic cost); a sequential PRNG (forces full rebuilds, same
trap); a per-stroke offscreen canvas (allocates per stroke and worsens the already-worst
dense-page repaint); per-stamp `save()`/`restore()` or per-stamp `drawImage` at thousands of
stamps (thousands of canvas state changes per repaint — stamps must be batched); and storing
derived geometry in the document (grows `.folio` and worsens the encode that is already 87%
of Save).

## 29. Test strategy

**Technical Pen (E2)** must prove, before it is called done:

- *Determinism* — the same snapshot and samples produce identical geometry across runs and
  across two independently constructed `Stroke` instances.
- *Live and committed convergence* — after the terminal sample, live geometry equals
  committed geometry exactly; and the settled prefix at frame *k* is a prefix of the
  committed result. The second assertion is the one that actually tests §13.
- *Save and Open* — encode, decode, re-evaluate, and compare geometry exactly.
- *Undo and Redo* — the restored object is the same `Stroke` reference and re-renders
  identically.
- *Terminal sample* — the last sample always reaches the geometry, including when it is
  stationary.
- *Pointer cancel* — nothing commits; the dirty rect covers what was drawn.
- *Zero-length and tap* — a single sample produces a dot with the nominal radius.
- *Pressure* — pressure varies across the samples and the width does not.
- *Zoom independence* — geometry at `renderedScale` 1, 2 and 0.5 paints the same page-unit
  width.
- *Bounds* — logical is contained in visual; both finite; both stable under rotation and
  translation.
- *Hit testing* — a point on the stroke hits; a point one nominal width away does not.
- *Selection transform* — translate, rotate and scale preserve painted width.
- *Eraser* — a whole-object erase works through `hitGeometry` with no strategy-specific
  code.
- *Export and offscreen* — the same stroke through `renderPageThumbnail` and through an
  `OffscreenCanvas` context produces the same result.
- *Legacy freeze* — a `centerline@1` and an `outline@1` stroke render identically to their
  pre-E2 output. This is the regression test that protects every existing project.
- *Codec refusal* — an unknown `(kind, version)` is refused with a typed error naming it,
  and never silently substituted.
- *Performance* — §28, behind `FOLIO_PERFORMANCE_BASELINE`.

**Pressure Pen (E3)** adds: pressure-curve determinism across the full `[0,1]` domain and
at both endpoints; width continuity across segment boundaries; taper at both ends and on
strokes shorter than the taper length; behaviour at pressure 0 and 1; non-monotonic, equal
and duplicated timestamps producing finite, non-spiking velocity.

**Pencil and Marker** add: identical grain after Save and Open; identical grain after
duplicate and paste; a stamp stream identical whether evaluated incrementally or at once;
spacing independent of sample rate; `visualBounds` actually containing the grain spill;
chisel tip orientation correct under object rotation.

**As covered for `pencil@1`**, all of the above except the chisel, plus five the list did
not anticipate: that a settled prefix is byte-identical under a reversal, a pressure slam, a
long jump, a dense burst and a sparse one; that raising coverage only ever *adds* marks
rather than moving them; that the painter issues exactly one `fill()` at exactly one alpha
over a self-crossing loop; that a mouse resolves to one width and one coverage rather than
to the middle of a curve; and that a stroke carrying the dead `brushTextureId` renders
identically to one without it, so the field cannot quietly have become the texture
mechanism.

**E4.1 added four**, three of them defending the refined deposition model rather than the
architecture: that graphite present at a light pressure is still present, in the same
place, at a firm one — checked by sampling the paper, which is where it matters, and which
is the strongest statement of "pressure is a threshold on one fixed field" the code can
make; that on a straight stroke the painted vertices do *not* pile up on the tip's nominal
division grid, which is the anti-rail regression test and the one that would have caught
E4's central defect; that changing colour or opacity moves no vertex; and that neither
`pencil.ts` nor `brush-random.ts` reaches for a clock, a global generator or `crypto`.

Unit tests for everything that is a pure function — which, by design, is nearly all of it.
Electron end-to-end tests only for pointer capture, cancellation and foreground-dependent
timing, and rerun a suspected focus failure alone before treating it as a regression.

## 30. Boundaries this design must not cross

- Durable artwork holds **data only**: no callbacks, no closures, no GPU handles, no Canvas
  objects, no generators, no filesystem paths, no transient device state.
- `ResolvedBrushSnapshot` stays the **sole** durable authority for reproducing a stroke.
- Randomness is persisted as a **seed or a derivation rule**, never as generated values.
- Texture identity is a **stable versioned resource id or embedded project data**, never an
  absolute path and never `StrokeStyle.brushTextureId`. As shipped in E4.2A the id is named
  by the **strategy version** rather than stored per stroke, so durable artwork gained no
  field at all — the strongest available form of this rule.
- Deposited material is a **derived cache owned by the renderer/project runtime**. It is
  never reachable from `Stroke`, a document, History or the codec, and destroying all of it
  must leave the artwork authoritative and exactly reconstructable.
- A shipped `(strategyId, strategyVersion)` **never changes what it draws**. Enforced by a
  pinned digest per strategy, and a roster test that requires every shipped strategy to name
  the gate that pins it.
- No strategy stores derived geometry in the document.
- No live per-frame step is **O(total stroke length)**.
- `@folio/ink` stays free of React and Electron, and gains no new Canvas 2D coupling
  outside the painter.
- Presets never become algorithms; strategies never read presets.
