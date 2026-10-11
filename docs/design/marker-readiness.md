# What Marker will find already built

A readiness audit, not a design. It answers the architectural questions E5 has
to answer anyway, and records what was cleaned up before it so that none of the
answers is "it depends on some debt we never closed".

No Marker behaviour is decided here. Nib angle, texture, opacity curve, edge
softness and presets all belong to E5, and deciding them now from an empty page
would be guessing.

## The short version

`marker@1` is **additive**. Nothing frozen has to move, no existing strategy's
logic has to change, no document type is needed and `formatVersion` stays 1.

## Where each thing lives

| question | answer |
| --- | --- |
| strategy identity | `brush-model.ts`: the `BrushStrategyId` union and the `SUPPORTED_BRUSH_STRATEGIES` set of `"kind@version"` strings. Entries are only ever added. |
| strategy implementation | `internal/brush-render-strategy.ts`: a static `Map` from `brushStrategyKey(id, version)` to one frozen `BrushRenderStrategy`. Five entries today. |
| resolution | `requireBrushRenderStrategy()` — one map lookup, which throws `UNSUPPORTED_BRUSH_STRATEGY` rather than substituting a near neighbour. |
| family and preset mapping | `editor/foundation/pen-presets.ts`: the catalogue, and `BrushPreset.renderer` names the strategy per preset. |
| glyph | `desktop/components/editor/brush-family-glyphs.ts`: one table, family-level, shared by the dock and the radial wheel, explicitly non-durable. |

Adding a strategy touches exactly four places, all of them additions: the id
union, the supported set, one `BrushRenderStrategy` object, one entry in the
array the map is built from. There is no chain of conditionals to extend —
checked, and the few places that do test `renderer.kind` in production are a
mouse-resolution rule that already treats every non-legacy strategy the same
way, a guard asserting Pencil material is only built for Pencil, and two
diagnostic `data-` attributes.

## Marker already exists everywhere except the engine

This is the finding worth leading with. `DrawingToolKind` *is* `BrushFamily`, so
the Tool Dock's four slots are the four families — and `marker` is one of them.
The catalogue already ships `marker-felt` and `marker-broad`, both currently
pointing at `centerline@1`; `DEFAULT_BRUSH_PRESET_IDS.marker` is already
`marker-felt`; `BRUSH_FAMILY_GLYPHS.marker` is already a brush glyph with the
reported name `"brush"`.

So E5 is not "add a tool". It is "give a tool that already exists a real
strategy", which is the same shape as Technical Pen and Pressure Pen before it:
change one preset's `renderer` from a frozen legacy strategy to the new one.
Artwork already saved keeps naming `centerline@1` and keeps rendering exactly as
it was drawn, which is the entire reason strategies are versioned.

## The reusable primitives

**Placement, which is the one to reuse.** `pencil-material/placement.ts` walks
the smoothed centreline with an arc-length cursor and drops a tip every fixed
advance — by distance, not by sample, so the mark is the same whether the device
reported 60 or 240 samples a second and a fast flick cannot leave a gap. It
depends only on the snapshot's size response and pressure response. An oriented
chisel tip is a placement stream with an orientation, and this is where it goes.

The roadmap used to call this "the stamp primitive". There is no module of that
name; `stamp` is the vocabulary of the design docs and `MaterialDab` is the type.
Corrected, so E5 does not go looking for it.

**What is Pencil-specific and should not be reused.** Everything after
placement: depositing grains per cell against a paper tooth field, the tile
raster, and the runtime cache that holds the result. A solid shaped tip needs
none of it. `BrushPaintContext.materialRuntime` is typed
`PencilMaterialRuntime | null` and a strategy that does not deposit passes
`null` and never reads it — so the one Pencil-shaped field in an otherwise
generic interface costs Marker nothing. It is flagged rather than generalised,
because generalising an interface for a second implementation that does not need
it is how shortcuts become architecture.

**Live rendering.** `LiveBrushEvaluator` — `append(points, final)`,
`geometry()`, `evaluationSnapshot()` — is the settled-prefix contract all three
engine strategies share. A strategy that supplies `createLiveEvaluator` gets
incremental live evaluation; one that does not is rebuilt per frame, as both
legacy strategies still are. Marker can start without one and add it later
without touching anything else.

**Committed rendering.** `resolveGeometry(stroke, renderedScale)`, cached by
immutable `Stroke` identity and scale in an eight-entry window. No new
finalization path is needed and none should be added.

**Hit geometry.** `BrushHitSample { x, y, radius }` is the canonical shared
representation, and `BrushStamp extends BrushHitSample` so a placement stream
*is* the hit geometry rather than a second array to keep in step. A filled path
and a placement stream both carry one; a constant-width stroked path carries a
single `width` instead, because pressure never changes it, and that is enough
for the same consumers. All three shapes are already in the union, so Marker
inherits whichever it picks rather than introducing a fourth. The broader
debt — that the editor's eraser and hit testing still consume object bounds
rather than `hitGeometry` — is unchanged by Marker and is already recorded in the
roadmap as an editor change. Marker neither needs it solved nor makes it worse.

## Appearance authority

`Stroke.style` and `ResolvedBrushSnapshot` both carry a colour, an opacity and a
width. **The snapshot is the authority** — it is what every renderer reads, what
`brushSizeAtPressure` evaluates, and what the contextual toolbar reports; the
style record is the pre-17A projection kept so that artwork saved before
snapshots existed still resolves. That was true but only verifiable by reading
five strategies, so it is now asserted across the whole registry: give a stroke
a style that disagrees with its snapshot, and every registered strategy must
produce byte-identical geometry. A strategy that reads the wrong one fails it,
and a sixth strategy inherits the rule instead of being told it.

`StrokeStyle.brushTextureId` is dead and must stay dead. Nothing in the editor
or the catalogue writes it; the codec round-trips it only so files that contain
it still open; `pencil@1` has a named regression proving its material is
identical with and without it. It is a durable promise with nothing behind it,
which is exactly what a material resource id must never become — only a
*strategy version* may name a resource. Marker must not repurpose it. Removing
it is a format question and not this phase's.

## Persistence

Nothing. A Marker stroke is a `Stroke` with a `ResolvedBrushSnapshot` whose
`renderer` is `{ kind: "marker", version: 1 }`. `family: "marker"` is already in
the durable `BrushFamily` vocabulary, so even the family needs no change. The
codec validates the strategy identity against the engine's own set, so
registering `marker@1` is what makes it writable and readable in the same
breath. `formatVersion` stays 1.

If Marker eventually wants a durable field the snapshot has no room for — a nib
angle, say — that is a schema decision with a version attached, and the honest
answer is to decide the behaviour first and the field second.

## Cost

Recovery encode cost is a function of sample count, not of which brush drew the
samples: at 5.57 MB, `pencil@1` 302.8 ms, `pressure-pen@1` 290.0 ms,
`technical-pen@1` 291.8 ms, payloads within 34 bytes of each other. A Marker
stroke of N samples costs what any other stroke of N samples costs, and R1–R3
already took the capture itself down by about 70%. Marker adds no persistence
risk.

The risk it does carry is the one D-031 measured: one `fill()` is quadratic in
contours, because Canvas 2D resolves a path's contours against one another. Six
thousand contours in a single fill measured 155 ms a frame where the same
contours in batches of forty-eight measured 8.4 ms, at equal vertex count. A
chisel tip painted as many overlapping shapes per stroke is exactly that shape
of problem, and the mitigation is already proven: merge into runs, earn
disjointness, then batch. Whether Marker needs it depends on its tip model,
which is an E5 decision.

## What was cleaned up first

- The weaker of two "pressure superset" definitions was removed. Measured rather
  than assumed: with a pressure-dependent displacement of a whole cell injected
  into placement, the copy in `pencil-material-model.test.ts` passed while the
  freeze suite's sharp form — size response held off, on a loop rather than a
  straight run — failed. One durable property, one authority.
- `maximumBrushSize` was deleted. It has had no caller since the commit that
  added it in Phase 17B, and it is a second definition of a quantity the builder
  computes per point — the kind of thing a new strategy picks up by accident.
- A mounted Pencil test was claiming coverage it did not have. Its page switch
  ran through `window.__folioPageActions.addPage`, a hook that does not exist,
  optional-chained so it skipped silently: the one manoeuvre the test is named
  for had never happened. It now uses the navigator a person uses and asserts
  the active page actually changed. This is the second instance of exactly this
  defect — E4.3B found the first, a size hook that left "a broad mark" drawing at
  2 page units — so the audit for the pattern is worth repeating whenever a test
  reaches for a bridge instead of a control.
- The recovery capture-cost harness was retired. It measured two whole-document
  passes the codec stopped making in R2, reporting a tree build of exactly
  0.00 ms at every size while its "stages" summed to 1155 ms against a 532 ms
  total. Its five unique concerns now have tracked owners, and the prototype
  pricing it existed to produce is recorded in `performance/recovery-r1.md`
  rather than regenerated by a harness that can no longer be trusted.
- The mounted responsiveness harness was kept, as a tracked opt-in diagnostic.
  It is the only instrument that measures the real renderer block, and it is the
  one behind the mounted tables of all three recovery phases.
