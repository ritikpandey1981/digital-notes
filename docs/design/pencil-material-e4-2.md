# Pencil hybrid material

This records the hybrid textured Pencil: the material model landed in E4.2A, and the
runtime, cache, scheduler and editor switch landed in E4.2B. It is an integration note,
not a prototype report — the evidence behind every choice here is the B2/B3/B4A/B4B
experiment sequence, which lives outside the repository and is summarised rather than
restated.

**As of E4.2B the editor draws Pencil through this model.** The geometry model it replaced
is gone. §1–10 record the material, §9–16 the runtime that made switching possible, and
§17–18 the presentation layer and cache identity that E4.2C settled.

## 1. Why a material at all

E4.1's Pencil is a *geometry* model: it decides where graphite lands and emits contours
describing it. That is the most a Canvas 2D painter can do without compositing an overlap
twice, and it is why the strategy is built the way it is — disjoint streaks, one alpha, no
overlap anywhere.

One alpha is the ceiling. A pencil's tone comes from *how much* graphite a patch of paper
holds, which varies continuously across a mark and builds where a stroke crosses itself. A
model that paints every mark at one alpha can approximate that by varying which marks
exist, and E4.1 went as far as that approximation goes. Past it, the medium has to be
deposited rather than drawn: per-cell accumulation, in a raster the strategy owns.

That is what this foundation is.

## 2. Strategy identity

**`pencil@1`, unchanged.**

No `pencil@2`, and deliberately not. A version exists so that artwork already on disk keeps
looking the way it looked; `pencil@1` has not reached a release, so nothing is looking at
it yet. Creating a second version now would freeze a pre-release appearance nobody approved
and leave the engine carrying it for ever.

The corollary is the same one E4.1 recorded: after the release that ships Pencil, a
refinement of this material is `pencil@2`, without exception.

`technical-pen@1`, `pressure-pen@1`, `centerline@1` and `outline@1` are untouched, and
their freeze digests are unmoved.

## 3. Durable resource identity

The material is made of two built-in resources — a graphite nib and a sheet of paper. A
stroke has to be able to name them across a save, and the question the phase had to settle
was where that name lives.

**It lives in the strategy version, and nowhere else.** A stroke durably names
`pencil@1`; `pencil@1` names `folio.graphite.hb-tip.v1` and
`folio.paper.graphite-tooth.v1`. The binding is one function,
[`pencilMaterialResources`](../../packages/ink/src/internal/pencil-material/resources.ts),
and it is the whole durable contract.

What that buys:

- **No format change.** `.folio` `formatVersion` stays 1 and `ResolvedBrushSnapshot`
  `schemaVersion` stays 1. The renderer field that already round-trips is the resource
  identity, so nothing was added to the file.
- **No new durable promise.** A resource id in the snapshot would be a field artwork could
  vary before anything can vary it — the mistake `pressureOpacity` and `brushTextureId`
  each made once already.
- **A version is still the way it moves.** A Pencil wanting a different nib is `pencil@2`
  naming different ids, which is exactly what a strategy version is for.

`StrokeStyle.brushTextureId` was not repurposed and must not be. It is an arbitrary legacy
string with no resolver behind it; promoting it into this contract would give it semantics
it has never had and make old artwork mean something new.

### Resource contract

| Property | How it is met |
| --- | --- |
| Stable versioned identity | `folio.<family>.<name>.v<n>`, added to and never changed |
| Bundled with Folio | Generated from pinned primitives at first use; no asset, no fetch |
| Deterministic | Pure function of the generator and its seed |
| Shared runtime decode | One `Uint8Array` per id per process, memoized |
| No filesystem reference | A resource is `{ id, size, samples }` and holds no path or URL |
| Explicit failure | An unknown id throws `InkError("UNKNOWN_MATERIAL_RESOURCE")` |

Nothing substitutes. A build that cannot resolve a resource refuses, because opening a
project while quietly drawing somebody's artwork differently is worse than not opening it.

## 4. The material model

One equation, in
[`deposition.ts`](../../packages/ink/src/internal/pencil-material/deposition.ts), reached
by both the live path and the cold path. The product of four terms:

- **A circular textured nib**, addressed in the tip's own frame, so it is the same mask
  wherever the tip lands. This is why a tap leaves a tip rather than a disc and why a
  terminal runs out rather than being cut.
- **The sheet's tooth, addressed in page space.** The paper resource is a *distribution*
  indexed by a spatial hash of the page coordinate, not a texture tiled across the page, so
  the sheet has no period at all rather than a period large enough to hope nobody notices.
- **A clump field**, because graphite crumbs: neighbouring paper takes it and leaves it
  together. Its cell size scales against the nominal tip, because a cluster wider than the
  tip gates the whole mark and a small pencil comes out dashed.
- **Pressure-dependent deposition**, which moves the contact threshold rather than
  multiplying an alpha — so pressing harder *reveals more of the same sheet*.

A narrow-tip term sits on top, for one measured reason: at two to six page units a tip is
only a few field cells across, and thresholding tooth alone breaks such a line into a
dashed chain.

### The coordinate rule

**The nib moves with the dab; the sheet does not.** This is the distinction the whole model
rests on, and the one a transform implementation must not quietly reinterpret. Deposition
happens in page space at the material resolution, with no rendered scale anywhere in it: the
material is deposited once, in the frame the artist drew it in.

The consequence for E4.2B and beyond, which B2 and B3 both recommended and this foundation
preserves: **a finished mark moves with the object.** Reconstruct in the original deposition
frame, then apply the object transform. Resampling destination paper after a transform
would change a drawing the artist only moved.

### Accumulation

Deposits within one **passage** keep the strongest contact; a tip that leaves a cell and
returns later opens a **new passage**, which composites over what the last one left. The
threshold is the dab advance, and the arc distance each dab carries is what distinguishes
the two cases.

That is the rule that makes a stroke read as graphite. Without it, the dozens of
overlapping dabs making up one pass would each compound and a straight line would darken
with the device's sampling rate; with it, one pass saturates and a deliberate retrace
builds, which is how graphite actually behaves.

### Colour and opacity

Neither is in the material. Base opacity is folded into the deposited bytes **exactly
once**, and colour is applied when a tile is painted — so one cached tile serves every
colour, and no pigment is baked into the model. A painter must not apply opacity again.

## 5. Tiles

Backend-neutral by construction: typed arrays and integers, no `Canvas`, no `ImageData`, no
context. `@folio/ink` gains no new Canvas coupling outside the painter.

| | Cells | Bytes | Holds |
| --- | --- | --- | --- |
| Lattice | 128 × 128 at 2 cells/page unit | | 64 page units square |
| Active | 16 384 | 112 KiB | `alpha`, `base`, `peak`, `last` |
| Committed | 16 384 | 16 KiB | `alpha` |

`base`, `peak` and `last` answer questions about a stroke *in progress* — which passage is
this, how much did it deposit, when was this cell last touched. A finished stroke has no
next dab to ask them on behalf of, so commit drops them. Seven bytes a cell become one,
which is what lets a runtime cache hold a realistic working set.

A committed tile is a **derived cache, never artwork**.

## 6. Packed index

`PencilDabIndex` holds the dab stream as a packed `Float64Array` (five values a dab) plus
one `Uint32Array` of members per tile. It is derived, deterministic, rebuildable from the
source samples and the snapshot, and contains no pixels.

It is what makes a tile reconstructable **without replaying the stroke**: the tile's own
membership list is read directly and only its dabs are deposited. Coordinates are `Float64`
rather than `Float32` deliberately — the dab stream feeds a threshold on a hashed lattice,
so narrowing it would move individual grains. The storage width is part of the material.

Members are in the order the stroke placed them, which is what makes single-tile
reconstruction exact rather than merely close.

## 7. Reconstruction contract

```
source samples + resolved snapshot -> index -> one tile key -> exact committed tile
```

Guaranteed, and tested:

- **Independent.** One tile rebuilds alone, with its own field cache, matching the full
  build byte for byte.
- **Order-free.** Rebuilding tiles in reverse gives the same material as forwards.
- **Convergent.** Live accumulation and cold reconstruction produce identical bytes across
  straight, curve, scribble, tap, self-crossing and broad fixtures. There is one algorithm,
  not two that agree by inspection — a medium with a drawing algorithm and a separate
  redraw algorithm changes under the artist the first time a cache is dropped.
- **Schedule-independent.** How the samples arrived does not change the settled result.

## 8. Cache ownership

**The runtime owns material. Nothing else may.** Not `Stroke`, not `PageDocument`, not
`SketchbookDocument`, not History, not `ResolvedBrushSnapshot`, not the codec.

This is not tidiness. The moment a tile is reachable from any of those, dropping it stops
being free, undo has pixels in it, and a save has a cache in it — and every guarantee
above stops holding.

`PencilMaterialRuntime` owns three things with three different lifetimes: committed
material per stroke, one index per stroke, and one field cache per sheet shared by every
stroke drawn on it. The invariant it exists for is stated as a test: **clearing it costs
time and nothing else.**

Nothing generated is persisted. Durable authority remains the source samples, the resolved
snapshot, and the strategy identity inside it.

## 9. Runtime ownership

`PencilMaterialRuntime` is created by `CanvasSurface` alongside the project runtime it
belongs to, and destroyed with it. It is guarded by the same `RuntimeActivation` every
other outward effect is, so `isActive()` is false the moment the project is replaced — and
a reconstruction slice that began legitimately and finishes afterwards publishes nothing.
That is the whole mechanism by which a retired runtime cannot paint into its successor.

Everything the runtime owns has the same lifetime: committed material per stroke, one index
per stroke, one field cache per sheet, and the scheduler.

## 10. Budgets

Two, accounted separately, because material is pixels measured in tens of megabytes and an
index is coordinates measured in single ones. Sharing a cap would let a pan evict indexes it
is about to rebuild, which is the most expensive possible thing to forget.

| Cache | Budget | Evidence |
| --- | --- | --- |
| Material | 64 MiB | 80% hit on a 1000-stroke navigation; 128 MiB removes eviction but needs 91 MiB resident to save work already spread across frames |
| Index | 16 MiB | Measured peak under 2.5 MiB with no eviction at any tested size; headroom rather than a constraint |

The material cap is **hard**. A visible working set larger than the budget thrashes rather
than overruns, because a cache that quietly exceeded its budget is not a budget. Eviction
prefers offscreen material and falls back to least-recently-used; a displayed tile is charged
for its presentation as well as its alpha, because 80 KiB and 16 KiB differ by a factor of
five and a budget that ignored the difference would be wrong by that much.

Nothing evicted is lost. That is what lets eviction be this blunt.

## 11. The scheduler

Four rules, each of which exists because leaving it out breaks something visible.

- **Slices, not tasks.** 4 ms, then yield through a `MessageChannel`. A frame that wants the
  main thread gets it.
- **Whole tiles only.** A half-deposited tile is not a lighter version of the finished one,
  it is a different picture. Scratch stays private until its last dab lands.
- **Rotate between strokes.** One quantum — 48 dabs — per job, in turn, within the highest
  priority class that has work. A viewport where one stroke finishes and the rest are blank
  reads as broken in a way that one filling in evenly does not.
- **Ownership checked at publication.** A job whose generation, request or runtime has moved
  on publishes nothing, so cancellation is a number change rather than an unwind.

At most **16 jobs** hold scratch at once: one active tile each, 1.75 MiB bounded. The
prototype found 16 and 32 indistinguishable on throughput, so this takes the smaller.

### Priority

`Active`, `VisibleCenter`, `VisiblePeripheral`, `Background`. A class never yields to a
higher number while it has work, so visible material cannot be delayed by anything
speculative. The compositor classifies a miss as centre when its tile falls in the middle
half of the view and peripheral otherwise. **Nothing requests `Background` today** — there is
no prefetch, deliberately — and the class exists so that when something does, it cannot be
confused with visible work.

### Index build policy

At or under **2000 samples** an index is built inline inside a slice: the build is a fraction
of one tile's reconstruction and splitting it would cost more bookkeeping than work. Above it
the build is chunked at 512 samples a quantum, cancellable, and restartable to the same bytes
— an ordinary stroke never reaches this, and the ones that do are exactly the ones that would
stall a frame.

## 12. Hot, warm, cold

| State | What happens |
| --- | --- |
| Hot — material resident | Painted immediately. No scheduler, no index, no task hop. |
| Warm — index resident, material not | Only the requested visible tiles are scheduled. The rest of the stroke is not rebuilt. |
| Cold — neither resident | The index is built under the size rule, then only the requested visible tiles. Offscreen material is never eagerly rebuilt. |

### During a miss

**Nothing approximate is ever drawn.** An approximation of a texture is a different texture.
A tile that is not resident is left bare and requested; exact tiles are published
progressively as they finish, each one invalidating only its own page rectangle.

## 13. Local active painting

The load-bearing part, and the one that makes every live measurement mean anything.

Before E4.2B the renderer had an incremental *evaluator* in front of a full *repaint*: the
live dirty rectangle grew monotonically, so every frame cleared and redrew the whole mark.
For a medium made of contours that is affordable. For one made of pixels it would cost more
the longer the artist drew.

Now the accumulator reports exactly which tiles its last append touched — the settled dabs it
added, plus the provisional tail it rolled back — and the renderer clears and redraws those
and nothing else. A frame's repaint is bounded by the tail rather than by the stroke. The
cumulative rectangle is still tracked, because cancelling a stroke has to erase all of it at
once.

The provisional tail is a **region rollback**: the cells it will touch are copied out before
it is deposited and copied back on the next frame. Seven bytes per touched cell, for the area
the tail covers rather than for every tile it lands in. Smoothing is unchanged, and live
material still converges byte-for-byte on cold reconstruction.

## 14. Transforms and scale

Material is deposited once in the artwork's own frame; the object transform is applied when
it is painted. Translation and rotation therefore move the marks the artist made.

**Uniform scale scales the graphite.** This is a deliberate change of behaviour for Pencil,
and the honest consequence of the coordinate rule in §4: the alternative is redepositing at
the new scale, which resamples the sheet, so an object that was only resized would come back
a different drawing. Every other strategy keeps its painted width under scale; Pencil now
behaves like a photograph of a drawing instead. See D-036.

Because scale is not a material parameter, committed geometry is cached once per stroke
rather than once per zoom level.

## 15. What E4.2B did not do

No GPU, no Marker, no format change, no per-pixel eraser, and no selection or eraser
awareness of material — hit testing and the eraser read the dab stream exactly as they read
the stamp stream before, and never learn what a tile is. No background prefetch and no
predictive page loading: B4B showed background completion buys a free return and spends
substantial extra work and memory for it, so leaving a page **cancels** its reconstruction
and coming back uses whatever survived in the cache.

## 16. The geometry model is gone

`internal/pencil.ts` — the E4.1 stamp-and-ribbon model — was removed, along with `drawStamps`
and the `stamps` geometry primitive, once nothing reached them. Bounds and hit geometry come
from the material's own dab placement, so there is exactly one placement implementation and
exactly one `FULL_COVERAGE`. `pencil@1`'s freeze digests were re-pinned for the second and
last time before release.

## 17. Presentation tiles

A committed tile is alpha. A **presentation** is that alpha tinted with the stroke's colour
and put somewhere a compositor can draw it — a canvas, for the Canvas 2D backend. It is the
last derived thing between the artwork and the screen, and like everything else derived it
is runtime-owned, evictable and rebuildable.

It is also cheap: about **0.2 ms a tile**, measured in the mounted editor. That is why the
answer here is a limit rather than a rewrite.

- Up to **eight** presentations are built inline in a paint. Eight is under two
  milliseconds and more than an ordinary stroke occupies, so an ordinary mark never pays a
  task hop and never shows a blank frame to save nothing.
- Past eight, the tiles are **requested** and the paint leaves them bare. A cold viewport
  of a large project wants hundreds at once, and hundreds of a fifth of a millisecond is a
  frame gone.

Scheduling reuses the existing runtime rather than adding a second one. A presentation is a
second **phase** of the same job: a tile is reconstructed if its material is missing, then
presented if its drawable form is, and each phase costs one quantum. Everything the
scheduler already provides — priority classes, rotation between strokes, the concurrency
cap, generation ownership, cancellation on viewport churn, page switch and runtime
retirement — therefore applies to presentation unchanged.

The material model stays free of Canvas. The runtime is handed a factory it never looks
inside, pays for what it returns, and schedules when it is made.

### Readiness, not residence

A tile whose material is deposited but which cannot yet be drawn is **not ready**. The
scheduler asks about readiness rather than residence, so a tile adopted at commit — material
complete, presentation missing — still becomes a job instead of being built inside a frame.

### Budget

Presentation backing is charged to the **same 64 MiB material budget**: 16 KiB of alpha
becomes 80 KiB once it can be drawn, and a budget that counted only the alpha would be wrong
by a factor of five. Eviction releases the presentation with the tile.

## 18. Cache identity

Material is cached under the stroke's id **and its resolved appearance**, not identity
alone. `applyInkStyle` builds a new `Stroke` with the *same id* and a different width,
opacity or colour, so a cache keyed by identity would serve the graphite of a mark that no
longer exists — and width and opacity are both inside the deposited bytes. This was a live
defect through E4.2B; E4.2C fixed it.

Colour is deliberately **not** in that key. Material is colour-neutral, so recolouring must
throw away the tint and not the graphite. The presentation records the colour it was tinted
with, and a painter that meets a presentation in the wrong colour rebuilds only that.

## 19. What remains

Canvas 2D is sufficient and GPU is not required; the prototype evidence and the mounted
measurement in [`../performance/pencil-e4-2.md`](../performance/pencil-e4-2.md) agree.
What is still open is not about the material:

- **E4.2C: slice the presentation build.** The one expensive frame the mounted run found is
  the moment a finished stroke is first painted and every tile it occupies needs a
  presentation canvas built at once — 212 ms for a seventy-tile mark. That is exactly the
  work the scheduler already knows how to slice, and it is recorded rather than smuggled
  into this phase.

- **Visual approval.** `pencil@1` is not frozen. The picture has not been signed off, and
  until it is, a refinement is still a re-pin rather than a `pencil@2`.
- **Marker**, which will deposit into the same lattice and inherits every rule here.
- **Per-hardness Pencil parameters**, which are the phase that should make grain strength,
  tooth and spacing durable fields.
