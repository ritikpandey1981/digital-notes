# Pencil fidelity result

This records why `pencil@1`'s deposition model was replaced before the strategy had ever
reached a release, what the replacement cost, and what it did not touch. It supplements
rather than replaces [`pencil-e4.md`](pencil-e4.md), whose record of the contour discovery
still stands and is still the reason this phase had a budget to spend at all.
[`desktop-baseline.md`](desktop-baseline.md) remains the reference for the machine, the
method and the limits on what any of these numbers can support.

## 1. What was wrong

E4's Pencil satisfied every contract in the brush-engine architecture. It was
deterministic, prefix-stable, anchored in the artwork's space, reproduced exactly through
Save, Undo and duplication, and comfortably inside the frame budget. It also did not look
like graphite, and at a broad size it did not look like a pencil at all.

Rendered at twenty-six page units and inspected rather than measured, it showed:

- **six parallel tracks** running the length of the stroke, one per grain lane;
- **rectangular dashes** inside them, laid in rows like brickwork;
- **grain far too coarse** for the width — features a sixth of the stroke across;
- **a mathematically clean edge** around an artificially noisy interior.

Every one of those is the implementation showing through, and the first is worth naming
precisely because it was not obvious from the code. The lanes were visible not because the
marks were in lanes, but because the *gaps between them* were. Disjointness — the property
that lets the painter batch contours without compositing an overlap twice — was earned by
narrowing each mark before moving it, which leaves a sliver of unmarked paper between every
pair of lanes. A sliver present at every stamp is a continuous line down the whole stroke.
The mechanism that made Pencil fast was the mechanism that made it look wrong.

## 2. What replaced it

The architecture did not change. Stamps are still placed by distance along an arc-length
cursor, grain is still a field addressed by painted position, pressure still moves coverage
rather than alpha, streaks are still merged before they are emitted and still laid out not
to overlap, and nothing generated is durable. What changed is how a tip deposits.

| | E4 | E4.1 |
| --- | --- | --- |
| Tip subdivision | 2–6 lanes at fixed offsets | 2–24 filaments whose divisions drift |
| Disjointness earned by | narrowing each mark before moving it | divisions that tile the tip and move as one set |
| Grain lattices | coarse tooth (1.3) + fine fleck (0.8) | one tooth (0.62) + one smooth clump field |
| Ink threshold addressed by | grain cell **and lane index** | grain cell alone |
| Across the tip | uniform to the rim, then a hard edge | a boosted core falling to nothing past the rim |
| Streak ends | squared | pointed |
| Streak cut after | a fixed number of inked stamps | fixed, per-filament, addressed stamp positions |
| Stamp advance | 0.8 × diameter, capped at 1.8 | 0.5 × diameter, capped at 1.5 |

Four of those need their reason stated, because each was a defect before it was a design.

**Divisions drift, and drift together.** Two smooth fields in the artwork's space — one
sliding the whole set of divisions sideways, one breathing it wider and narrower — replace
fixed offsets. Shared by every filament of a stamp, they form an affine map of the lateral
axis, which moves the divisions without ever reordering them. That is what lets the
filaments *tile* the tip with no sliver between them and still never overlap: disjointness
now comes from monotonicity rather than from a gap. Drifting each filament independently
would have been easier and would have put two streaks on top of each other.

**The tip has a profile.** Deposition is certain through a boosted core and smoothsteps to
nothing slightly past the nominal rim. The boost is above one because it multiplies a
probability rather than being one: without it a four-pixel pencil, which is three filaments
wide, loses its line wherever any one of them declines, and reads as dashes.

**Clusters are sized against the tip.** One smooth field modulates deposition into clumps
and voids. It is scaled to the brush rather than fixed in page units, because a cluster
wider than the tip gates every filament at once — the same dashing failure by another
route.

**Cuts are addressed, not counted.** A streak is cut at fixed stamp positions, each
filament with its own limit and its own phase drawn from the seed. Counting inked stamps
instead makes the cut depend on how much graphite happened to land, so a firm stroke opens
gaps a light one does not have — which silently breaks the property that pressure is a
threshold on one unchanging field. A single *shared* limit is worse still: a firm stroke
saturates its core, so every filament inks from the same stamp, cuts on the same stamp, and
paints a faint rung across the stroke every dozen page units.

That last one is the phase's general lesson, and it is the same lesson as the drift fields
one level down: **anything periodic and shared across the tip becomes visible structure.**

## 3. Method

Same harness, same machine, same boundaries as Phase D and E4. No harness change was needed;
the counters E4 added (`stamps`, `marks`, `contours`, `path-vertices`) carried over.

```powershell
$env:FOLIO_BASELINE_RUN="e41-run1"; $env:FOLIO_BASELINE_GROUPS="none"; $env:FOLIO_BASELINE_STAGES="live"; $env:FOLIO_BASELINE_LIVE_KINDS="pencil"; node tests/performance/run-baseline.mjs --grep "measured desktop baseline"
$env:FOLIO_BASELINE_RUN="e41-run2"; $env:FOLIO_BASELINE_GROUPS="none"; $env:FOLIO_BASELINE_STAGES="live"; $env:FOLIO_BASELINE_LIVE_KINDS="pencil"; node tests/performance/run-baseline.mjs --grep "measured desktop baseline"
$env:FOLIO_BASELINE_RUN="e41-frozen"; $env:FOLIO_BASELINE_GROUPS="none"; $env:FOLIO_BASELINE_STAGES="live"; $env:FOLIO_BASELINE_LIVE_KINDS="technical-pen,pressure-pen,centerline"; node tests/performance/run-baseline.mjs --grep "measured desktop baseline"
$env:FOLIO_BASELINE_RUN="e41-models"; $env:FOLIO_BASELINE_GROUPS="stroke"; $env:FOLIO_BASELINE_MODEL_SIZES="1000,5000,20000"; $env:FOLIO_BASELINE_STAGES="models"; node tests/performance/run-baseline.mjs
```

Only the `stroke` and `live` groups were run. Pencil was measured twice, in the same
session, on identical code.

**The caveat E4 stated applies again, in the other direction.** This machine ran *faster*
today than during E4: `live/centerline/20000/64` is 50.0 ms p95 here against 57.8 ms in E4,
on code neither phase touched. So the cross-phase Pencil comparison below, which already
shows a regression at the largest workload, if anything understates it. The comparison that
is safe is the one *within* this run, against the strategies measured beside it.

## 4. Live input

p95 milliseconds of callback work. Two Pencil runs on identical code; the frozen
comparisons are from the same session.

| Workload | pencil run 1 | pencil run 2 | E4 pencil | technical-pen | pressure-pen | centerline |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 / 1 | 0.9 | 0.8 | 0.8 | 0.4 | 0.5 | 1.9 |
| 1 000 / 4 | 1.7 | 1.7 | 1.4 | 0.7 | 1.0 | 3.9 |
| 5 000 / 16 | **4.4** | **4.8** | 6.5 | 1.3 | 2.1 | 13.4 |
| 20 000 / 64 | **16.4** | **16.7** | 14.4 | 2.4 | 4.5 | 50.0 |

Input-to-callback-end, p95: 8.9 / 8.9 / 8.8 / 17.2 for run 1, and 8.8 / 8.9 / 9.0 / 17.4
for run 2.

Frames over the 16.67 ms budget:

| Workload | pencil run 1 | pencil run 2 | E4 pencil | technical-pen | pressure-pen | centerline |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 / 1 | 0 of 95 | 0 of 95 | 0 of 95 | 0 | 0 | 0 |
| 1 000 / 4 | 0 of 246 | 0 of 246 | 0 of 246 | 0 | 0 | 0 |
| 5 000 / 16 | 0 of 309 | 0 of 309 | 0 of 309 | 0 | 0 | 0 of 309 |
| 20 000 / 64 | 40 of 309 | 43 of 309 | 8 of 309 | 0 | 0 | 220 of 309 |

**The tradeoff, stated plainly.** At five thousand samples the new Pencil is *faster* than
the one it replaces — 4.4 against 6.5 ms p95, and still not one frame over budget. At twenty
thousand it is slower: 16.4 against 14.4 ms, and forty frames over budget against eight. The
reason is not subtle and is not a regression in the design: texture is breaks, breaks are
contours, and contours are the whole of Pencil's repaint cost. The new model emits 3 120
contours at twenty thousand samples where the old emitted 2 161, because its core is allowed
to open into clumps and voids instead of running solid.

Twenty thousand samples at 64 per callback is sixty page-widths of unbroken scribble, drawn
without lifting, in one stroke. Five thousand — twelve page-widths — is the workload a real
gesture resembles, and it improved. The regression is real, it is reported, and it is at the
end of the range where centerline, the strategy an artist would otherwise have been drawing
pencils with, costs three times as much and misses seven times as many frames.

## 5. Where the cost went

Full-geometry build, p50 milliseconds, with the volume counters beside it.

| Samples | geometry p50 | stamps | marks | contours | path vertices | fills |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 000 | 1.4 | 500 | 730 | 166 | 2 124 | 4 |
| 5 000 | 6.3 | 2 498 | 3 482 | 783 | 10 096 | 17 |
| 20 000 | 26.4 | 9 990 | 13 865 | 3 120 | 40 210 | 65 |

Scaling exponent between the last two rows: **1.04**. Linear, as E4's was.

Evaluation and painting were also measured apart, on the same twenty-thousand-sample
fixture in the same renderer: **28.2 ms** to build the whole geometry from nothing against
**3.8 ms** to paint it. Live drawing pays a small fraction of the first — the settled-prefix
design means a frame evaluates only its tail — and all of the second, every frame. That is
why contour count, not hash count, is what the constants in `pencil.ts` are tuned against,
and it is why the advance was widened from 0.8 to 1.5 page units partway through this phase:
it removed a third of the stamps, a third of the contours, and six milliseconds a frame at
twenty thousand samples, for no visible change at all.

One measurement that did *not* pay off is worth recording so it is not tried again. Raising
the painter's contours-per-fill from 48 to 96 and then 192 was an attempt to keep two
neighbouring streaks in one `fill()`, because a boundary pixel that two contours each half
cover is composited twice across two fills and comes out lighter than either — which painted
a faint thread along the occasional filament boundary in a saturated core. It cost 1.4 ms a
frame at 96 and 4.4 ms at 192, and only made the threads rarer. Keeping the clump field
strong enough to open a pressed core removed them instead, by making the shared edges short
in the first place, and improved the picture rather than hiding a flaw in it. The batch is
back at 48.

**A residual, honestly.** On a deliberately saturated broad stroke, magnified past 200%, a
few faint threads can still be found where two filaments both ran unbroken and their shared
edge happened to fall across a fill boundary. They are invisible at 100%, they are not
periodic, and the only remaining cures are a larger fill batch (measured above, and not
worth its cost) or a Canvas 2D that composites a path's coverage rather than its pixels.

## 6. Strategies that were already frozen

`technical-pen@1` and `pressure-pen@1` produce **byte-identical freeze digests** — the same
`technical-pen@0:x1q4l0`, `technical-pen@0.3:a2i6kf`, `pressure-pen@0:6bm694` and
`pressure-pen@0.18:92y0oo` they have carried since E3. Nothing in this phase touched them,
and the digest test is what proves it rather than the diff.

Their live cost is unchanged in kind: Technical Pen at 8.5–8.6 ms input-to-callback-end
across every workload with 2.4 ms p95 callback work at twenty thousand samples, Pressure Pen
at 8.5–8.7 ms with 4.5 ms. Neither misses a single frame in any workload.

`pencil@1`'s own digests moved, which is the one thing a version is supposed to prevent. It
is allowed exactly here and nowhere later: the strategy has never shipped in a release, so
no saved artwork can be looking at the old appearance. The next refinement of Pencil's
appearance is `pencil@2`. See D-032.

## 7. What this does not establish

The same limits as E4. One machine, one afternoon, one synthetic fixture whose pressure is
an adversarial sawtooth rather than a hand. Nothing here says what Pencil costs on an
integrated GPU, at a higher device pixel ratio, or with a hundred committed strokes already
on the page.

And nothing here is a substitute for looking. Every defect this phase fixed was invisible to
the entire test suite and to every number above: the tests were green and the frame budget
was met while the strategy painted brickwork. The tests added in E4.1 close three of those
specific holes — the anti-rail check, the pressure-containment check, and the no-clock check
— but the general point stands. A medium has to be rendered and inspected, at several sizes
and pressures and magnifications, before it can be called finished.
