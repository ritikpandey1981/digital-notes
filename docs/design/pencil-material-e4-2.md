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

## 19. Where a tile is put

A tile's rectangle in page space is exact and continuous: tile `t` ends at `t × 64` and tile
`t + 1` begins there, and the material's own alpha runs across that line without a step.
Neither fact is sufficient, because **each `drawImage` is rasterized on its own**.

When the shared boundary falls between two device pixels, the straddled pixel is covered
partly by the left tile and then partly by the right one, and two partial coverages
composited with `source-over` do not add up to one. A pixel that should have been solid
graphite comes out lighter. Repeat that down every boundary and a person sees a pale grid
through broad Pencil — which is exactly what was reported.

Measured with uniform tiles, so that nothing but the compositor could vary:

| zoom | tile pitch, device px | seams |
| --- | --- | --- |
| 0.5, 1, 1.5, 2, 2.5, 3 | 32, 64, 96, 128, 160, 192 | none |
| 0.8 | 51.2 | at ⌊n × 51.2⌋ — **except** where n × 51.2 is a whole number |
| 1.93 | 123.52 | at ⌊n × 123.52⌋, every boundary |

Body tone 80, seam tone 86–118. The exception at 0.8 is the mechanism confirming itself:
the boundaries that happen to land on whole pixels have no seam. And a **fractional pan
puts every zoom in the same position**, including 100%, 200% and 300% — panning is
continuous, so this is the ordinary case rather than an odd one.

### The rule

A tile is placed by **whole device pixels**, and both neighbours derive their shared edge
from the same page coordinate through the same rounding. They therefore agree on it exactly,
by construction rather than by luck, and no pixel is left partly covered by anything.

Placing them means drawing under the identity transform. That is not incidental: expressing
the snapped rectangle back in page space reassociates the arithmetic, and
`(l − e) / a + (r − l) / a` is not `(r − e) / a` in floating point. Measured in the running
editor, the page-space form disagreed on ten of thirty shared edges at 150%; the device-space
form disagrees on none at any zoom. A clip is held in device space and is unaffected by the
transform change.

It applies only to an upright transform. Under rotation there is no device axis to snap to,
the seam is not an axis-aligned line anyway, and the exact rectangle is what is wanted.

The cost is that a tile's width varies by at most one device pixel out of sixty-four — under
two per cent, applied to a resampling that was already happening. This is what every tiled
renderer does.

### What this left

Folding the tone of a scribbled block onto all sixteen offsets inside a tile, in the running
editor: the boundary was **the lightest of the sixteen in eleven of twelve conditions**
before, exceeding the worst ordinary column by about three tones. After, it exceeds it by at
most **0.13 of a tone**.

That is the whole of what this rule fixed, and the section that follows is the record of
what it did not. Placing a tile is one of three operations that have to agree about where a
tile goes, and the other two were left alone; and the residual dismissed here as "the edge of
bilinear filtering ... at the level of the paper's own texture" was a real defect that a
person found at 664%. Both are settled in §21 and §22. See [D-041](../DECISIONS.md) and
[D-042](../DECISIONS.md).

## 20. The handover

A finished stroke leaves the live ink layer and arrives on the compositor that will keep it.
The editor draws finished artwork on the compositor and not on the ink canvas, so those are
two different surfaces, and the transition between them has a visual contract:

> A completed mark is on one surface or the other in **every** frame, whole, and on only one
> of them.

Measured at pointer-up before this phase, both halves of that were false:

| frame | ink layer | compositor |
| --- | --- | --- |
| n | the mark | — |
| n + 1 | — | — |
| n + 2 | — | **46%** of the mark |
| n + 3 | — | the mark |

Two separate causes, one visible result.

**The blank frame is ordering.** Finalizing clears the live layer synchronously; the
compositor's repaint is requested through `requestAnimationFrame` and therefore lands in the
next frame. Flushing the render the document change has already asked for puts both surfaces
in the same frame. Nothing is rendered twice and nothing is rendered early — the work that
was going to happen next frame happens in this one, before the browser composites either
canvas. Ordering, not delay.

**The partial frame is the inline presentation limit**, doing exactly what it is for in the
one case where it is wrong. Eight tiles a frame protects a cold viewport of a large project,
where hundreds want presenting at once and none is urgent. A mark the artist has this moment
finished is the opposite in every respect: its tiles are few, their material is already in
hand because it was adopted rather than rebuilt, and a tile left bare is a hole in artwork
that was whole a moment ago. So the runtime marks a stroke as **handing over** when it
adopts its material, and a stroke handing over finishes in one frame. Measured: about
seventeen tiles for a 720-pixel mark at 26 page units, three to four milliseconds at the
measured 0.2 ms a tile, inside one frame at 120 Hz.

The handover ends the first time the mark is painted whole, and a local repaint of part of it
cannot end it on the rest's behalf. It is forgotten with the stroke and with the cache.

The alternative — keeping the live layer's copy until the compositor is ready — was
considered and is worse: it needs cross-layer lifetime state, it can leave a stale copy
behind if the object is undone or moved before the release, and during the overlap the mark
is composited twice and reads darker. Making the two surfaces agree inside one task needs
none of that.

### What this did not change

Nothing here touches deposition. The nib, the paper field, the clump field, the pressure
model, the accumulation rule and the spacing are all untouched, and the resource digests and
strategy freeze digests are unmoved. This phase moved where tiles are drawn and when they are
handed over, which is compositing and lifetime, not material.

## 21. The seam, properly

E4.2D placed tiles on whole device pixels and the grid was still there. Two things were
wrong with that phase's work, and they are different kinds of wrong.

**It fixed one of three things that have to agree.** Placing a tile on whole pixels is only
half a rule if the *clear* and the *clip* are still derived from page coordinates. In the
live path they were. A `clearRect` whose edge falls between pixels is antialiased, so the
straddled pixel is *partly* erased — and what is being partly erased is the neighbouring
tile's graphite, while the neighbour is not dirty and so is not redrawn. The clip did the
same thing from the other side, shaving the outermost fraction off a tile the painter had
just aligned.

Measured on the live layer, graphite load along the boundary against fifteen ordinary
columns of the same mark: **thirty-two units short, nine standard deviations out**, at both
300% and 664%. That is the line a person sees while drawing, and it is why the lines looked
different after pointer-up — the compositor redraws whole objects and never took the
per-tile clear path at all.

**And it verified the other half with an experiment that could not fail.** The controlled
comparison in E4.2D used *uniform* tiles. Clamping a constant field returns the same
constant, so uniform tiles cannot reveal edge sampling under any circumstances. It reported
the tiled path pixel-perfect because the question had been asked in a form that had only one
answer.

Asked again with a varying field, against a contiguous reference raster of the same
material, as mean absolute tone difference by distance from a boundary:

| zoom | at the boundary | one pixel in | two pixels in | beyond |
| --- | --- | --- | --- | --- |
| 1.0 | 0 | 0 | 0 | 0 |
| 3.0 | 5.04 | 2.52 | 0 | 0 |
| 6.64 | 10.52 | 5.97 | 0.71 | 0 |

Zero everywhere except within a pixel or two of a boundary, and only once a tile is
magnified past 1:1 — which is exactly why 100% and 200% looked right and 300% and 664% did
not. A tile scaled up is resampled, and a bilinear filter asked for a pixel at the tile's own
edge needs a sample from beyond it; with nothing there it clamps and repeats the edge cell.
The texture stops dead along the boundary.

That one is worth stating carefully, because it is nearly invisible to measurement.
Clamping preserves average tone, so the brightness statistic that passed E4.2D sees nothing
(0.33σ). It puts a whole cell's difference into one pixel where a ramp would spread it, but
flanked by two flat clamped runs, so an *averaged* gradient sees nothing either (0.74
against a control mean of 1.04). Only a direct comparison against ground truth finds it, and
the magnified pictures confirm it: the texture visibly breaks and restarts. **A defect that
no available statistic resolves is still a defect**, and the honest record is that the
fixture comparison is what settled this one.

## 22. What a presentation carries now

**One cell of every neighbour, all the way round.** A presentation is 130 cells square where
its tile is 128, and the painter blits the inner square — `drawImage` with an explicit source
rectangle — letting the filter reach into the ring for the samples it needs. With it, the
difference from the contiguous reference is 0.00 at every distance and every zoom tested,
worst single column 0.13. Two cells of gutter measure no better than one, because a bilinear
filter never reaches further than one sample.

Three things this deliberately is not:

- **Not an expanded destination.** Overlapping neighbouring rectangles would composite
  semi-transparent graphite twice along every boundary and trade a pale grid for a dark one.
  The gutter is drawn *through*, never drawn.
- **Not a repeat of the tile's own edge.** That is the clamp this replaces.
- **Not nearest-neighbour filtering.** Turning smoothing off removes the seam by replacing
  the entire resampling with a worse picture, which is hiding the defect rather than fixing
  it. It is recorded as a diagnostic and rejected as a remedy.

A missing neighbour leaves zeroes, and that is the right answer rather than a fallback: a
tile the stroke never reached holds no graphite, so interpolating towards nothing is what
the contiguous raster does too.

**Both paths assemble it the same way.** The live layer takes its neighbours from the
accumulator, which holds every tile the stroke has reached; the compositor takes them from
the runtime, which owns the material. Ownership differs, the border rule does not — and the
two now measure identically at the boundary, which is the property that makes lifting the
pencil change nothing.

### Depending on a neighbour

A presentation that was built while a neighbour was missing is wrong once that neighbour
arrives, so the runtime records which directions went short and drops exactly those
presentations when material lands. A presentation that found everything it wanted is already
right and is left alone. **The dependency is one tile deep in every direction and goes no
further.**

The scheduler does its part by ordering: a job deposits everything it owes before presenting
any of it. Interleaving the two would present a tile, invalidate it with the next tile, and
present it again — correct, and a great deal of work to arrive at the same picture.

### What it costs

A presentation is 67,600 bytes rather than 65,536: **3.1% more backing per presentation**,
and 2.5% more per resident tile once the alpha is counted with it. The budget is charged the
real figure, as it was before.

## 23. Where the lattice is, and is not

| | measured at the tile boundary, against fifteen in-tile controls |
| --- | --- |
| Live layer, before | tone −8.8σ at 300%, −9.2σ at 664%; sharpest step 15× and 41× ordinary |
| Live layer, after | +0.4σ and −0.0σ; step 0.85 and 0.55, inside control range |
| Compositor, before | tone 0.3σ; step 1.25 and 1.18 — below what the statistic resolves |
| Compositor, after | 0.3σ and −0.0σ; step 0.85 and 0.56 |

Active and committed now agree to two decimal places on both statistics, which is the
border-equivalence claim stated as a number rather than an impression.

## 24. What remains

Canvas 2D is sufficient and GPU is not required; the prototype evidence and the mounted
measurement in [`../performance/pencil-e4-2.md`](../performance/pencil-e4-2.md) agree.
What is still open is not about the material:

- **A collection pause at 26 page units.** One long task per run, around 230 ms, about 1.4 s
  into a broad stroke. It does not reproduce under a CPU profile or a timeline trace and
  attributes to `(program)`. E4.2B attributed it, by reasoning, to presentation-tile
  creation; E4.2C measured presentation at 0.2 ms a tile and twenty-five tiles a workload
  and showed that was wrong. It is a property of the memory profile of a broad stroke —
  roughly 200 KiB of fresh allocation per new tile — and wants a memory pass rather than
  another scheduling one. It is **performance debt and not Pencil visual debt**: the mark is
  approved and frozen, and the next phase goes after the allocations underneath it while the
  digests in §25 hold the picture still. It is not solved.
- **Marker**, which will deposit into the same lattice and inherits every rule here.
- **Per-hardness Pencil parameters**, which are the phase that should make grain strength,
  tooth and spacing durable fields.

## 25. The freeze

The artist has drawn with the production Pencil and approved the picture. From that point
`pencil@1` is artwork's property rather than the engine's, and what makes that enforceable
is a pinned value rather than an intention — see [D-044](../DECISIONS.md).

### What is frozen

The artistic result, and only that: the strategy identity, the two generated fields, dab
placement, pressure deposition, the clump and tooth fields, passage accumulation, taps,
rounded starts and terminals, material alpha generation, tile reconstruction,
active/committed convergence, the presentation border, and the colour and opacity
semantics.

Pinned in [`../../packages/ink/src/__tests__/pencil-visual-freeze.test.ts`](../../packages/ink/src/__tests__/pencil-visual-freeze.test.ts):

| | |
| --- | --- |
| Resources | `folio.graphite.hb-tip.v1` `1yig76y`, `folio.paper.graphite-tooth.v1` `1a91iur` |
| Fixtures | nine shapes — tap, short and long straight, curve, tight turn, loop, self-crossing, retrace, broad scribble — at 2, 6, 12 and 26 page units and three pressures, eleven in all |
| Pressure | one path at low, medium and firm, pinned separately |
| Paths | live, committed and cold reach the pinned value, not merely each other |
| Order | tile order, neighbour order, a tile alone with its own field cache, and four sample-batch sizes all reach it |
| Border | a presentation is 130 cells where its tile is 128, and the ring is the neighbour's |

Digests are over **page cells**, not tiles: a cell is named by where it is on the page, so
the pinned value is independent of how material happens to be tiled. Tiling is a cache
decision, and the next phase may change it without re-pinning any artwork.

The fixtures and the brush are transcribed into the freeze file rather than imported from
the shared material fixture. A helper another suite can edit for its own reasons is a way
for this gate to report that Pencil changed when it did not.

### What is not frozen

Scheduler timing, eviction order, memory layout, allocation strategy, Canvas object reuse,
collection behaviour, queue implementation. Those are the subject of the next phase and
freezing them would freeze the wrong thing.

### Why the paths are pinned and not only compared

[`pencil-material-cache.test.ts`](../../packages/ink/src/__tests__/pencil-material-cache.test.ts)
already settles that live, committed and cold agree with each other, and that is not
sufficient here. A change that moves all three together passes every one of those tests —
and that is the exact shape of a memory optimization, which touches the buffers all three
deposit into. So the frozen value is asserted *against* the paths rather than *between*
them.

### Every test was made to fail

Following [D-042](../DECISIONS.md), each gate was shown sensitive before it was trusted.
Changing `TONE_RANGE` from 0.78 to 0.7801 — thirteen parts in a hundred thousand — fails all
seven digest assertions. Changing the nib's variation seed fails the resource gate and names
the field. Setting the presentation gutter to zero fails the border gate.

The pressure-superset claim is the instructive one. Read on the shipped preset it is a
**coarse instrument**: a firm tip is nearly twice the radius of a light one, so the wider
footprint absorbs a displacement of a cell or two and the subset never breaks. Measured — a
pressure-dependent shift of one and a half cells passes it. The sharp form holds the
footprint still, with the size response off, so pressure varies only the load; then a
displacement of a **single cell** breaks the chain and names the cell. It reads a loop rather
than a straight run, because a straight run is its own translate along its length and would
hide exactly the defect being looked for. Both are kept: the first is the claim about the
mark a person draws, the second is the one with teeth.

### The roster

Five strategies have shipped, and each is now accounted for by a gate that pins its pixels:
`centerline@1` and `outline@1` in `legacy-strategy-freeze.test.ts`, `technical-pen@1`,
`pressure-pen@1` and `pencil@1` in `engine-strategy-freeze.test.ts`, and `pencil@1` again
here for its material. A roster test derives the list from the vocabulary, so a strategy
cannot ship without a gate, and a failure names the strategy rather than only a count.
