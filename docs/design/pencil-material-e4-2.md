# Pencil hybrid material — E4.2A foundation

This records the production material foundation landed in E4.2A: what exists, what it
guarantees, and what E4.2B still has to connect. It is an integration note, not a
prototype report — the evidence behind every choice here is the B2/B3/B4A/B4B experiment
sequence, which lives outside the repository and is summarised rather than restated.

The phase replaced nothing that ships. The editor still draws Pencil through the geometry
model in [`pencil.ts`](../../packages/ink/src/internal/pencil.ts); the material lives
beside it, fully tested, and is wired in by E4.2B.

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

## 9. What E4.2B still has to do

Deliberately absent here, and none of it changes a pixel — which is exactly why it can be
added on top of a foundation that is already exact.

| Item | Prototype recommendation |
| --- | --- |
| Cooperative reconstruction scheduler | 4 ms work budget, `MessageChannel` |
| Cancellation and generation ownership | Cancel on viewport churn and page switch |
| Cross-stroke fairness | Rotate, one quantum per active job |
| Global material budget with visible-last eviction | 64 MiB desktop |
| Separate index budget and lifetime | 16 MiB desktop |
| Scheduled index builds | Chunk above ~2000 samples |
| Local active painting | Dirty-region repaint, never full-prefix |
| Live editor path switched to the material | Replaces the geometry model |
| Transform integration | Reconstruct in the deposition frame, then transform |

Canvas 2D is sufficient and GPU is not required; the prototype evidence settles both.

Two of these are load-bearing rather than incremental: **local active painting**, because
every live measurement assumes dirty-region repaint, and **cache ownership**, which this
phase has already established and which E4.2B must not widen.

## 10. What this phase did not touch

No frozen strategy, no format version, no schema, no codec vocabulary, no document model,
no History, no preset catalogue, no editor path, and no Marker.
