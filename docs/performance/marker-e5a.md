# A marker is a shape being dragged

**`marker@1` is approved and frozen.** The user drew with the production
Marker and said yes, so what the nib leaves on the page is artwork's business
now. The pinned values live in
[`marker-visual-freeze.test.ts`](../../packages/ink/src/__tests__/marker-visual-freeze.test.ts),
the rules in [D-050](../DECISIONS.md) and [D-051](../DECISIONS.md). This records
what was built, what it measures, and how the appearance was decided.

One number changed with the approval and it is not the engine's: the shipped
`marker-felt` is **twelve page units**, not the eight it carried as a round
line. Everything below about the nib is unchanged by that, and was unchanged by
it at the time — the thirteen geometry digests taken before the preset edit were
identical after it.

Every other strategy in the engine makes a mark whose shape is a function of a
radius. A marker's is not. Its nib is *oriented*, so the same brush draws broad
one way and narrow the other, and that single fact is where the whole character
comes from — not from texture, not from grain, not from anything painted inside
the mark.

## The nib

A **capsule**: a rectangle with semicircular ends. The simplest convex shape
that is directional enough to read as a chisel and rounded enough to read as
felt rather than as a blade.

| | |
| --- | --- |
| broad width | the brush's size |
| thickness | `MARKER_NIB_THICKNESS_RATIO` = 0.42 of it |
| widest to narrowest | about 2.4 : 1 |
| page-space angle | `MARKER_NIB_ANGLE_DEGREES` = 45, fixed |

Forty-five degrees is the angle a broad-edge nib is conventionally held at, and
it is the one that makes the character legible: horizontal and vertical come out
identical and mid-width, while the two diagonals are the widest and the
narrowest the brush can draw. Any other angle privileges one axis-aligned
direction for no reason a person could predict.

**Orientation does not follow the tangent**, and that is a decision rather than
an omission. A nib that rotates through a turn is a calligraphy brush, and its
swept boundary folds at corners. Fixed, a corner is two slabs meeting and the
thick-to-thin character becomes a property of *which way you drew*.

Neither constant is durable. They are constants of this strategy version, so a
Marker that holds the pen differently is `marker@2` rather than a field in
everyone's files. The serialization test asserts that no `nib`, `nibAngle`,
`markerTipAngle`, `markerAspectRatio`, `markerHardness` or `markerTextureId`
reaches a `.folio`.

## Sweeping it

A capsule's **support function** is closed form, which is what makes sweeping it
exact rather than approximate. The support point in direction `n` is

```
centre + a * sign(u . n) * u + r * n
```

for axis `u`, straight half-length `a` and corner radius `r`. So the boundary of
the swept region is a *traced curve*, not a union of stamps: each span
contributes the two tangent lines in its own normal direction, each vertex
contributes the arc the support point traces as the normal rotates, and each
terminal contributes the half of the nib lying beyond it.

That is why this strategy has no stamps to batch and no brick pattern to hide.
It is also why a terminal is a whole nib: the cap is the nib's own outline, so a
tap is an angled impression rather than a dot, and a stroke drawn along the
nib's axis ends in the narrow angled tip a real chisel leaves.

Placement is by **distance travelled**, decimated to a spacing derived from the
brush's width, so a device reporting 240 events a second produces the same mark
as one reporting 60.

## Ink is not event density

One band is one closed contour and one `fill()` under the **nonzero** winding
rule. A stroke that crosses itself is one path either way, so Canvas resolves
the overlap inside the fill and composites the region exactly once.

That is the whole accumulation semantic, and it falls out of the representation
rather than being a rule applied afterwards:

- **within one stroke**, dense placement cannot darken anything, and neither can
  a deliberate self-retrace: one stroke is one coverage mask;
- **between strokes**, normal alpha compositing applies, so a second Marker
  crossing the first darkens — which is what a marker is expected to do.

Opacity that varies along a stroke is the one case needing more than one fill.
`pressureOpacity` cuts the swath into bands at an alpha drift of 1/64, each at
least sixteen spans long, and consecutive bands close on the **same straight
cross-section** so they tile along the stroke instead of overlapping. Measured:
the same path with the response on and off covers exactly the same page, which
is what proves the cut neither gaps nor doubles.

`marker-felt` resolves neither response, so in production this is one fill.
`marker-broad` is still on its legacy strategy until the catalogue phase.

## Measured

Node, on the machine every note here uses:

| stroke | placements | boundary points | fills | committed rebuild |
| --- | --- | --- | --- | --- |
| ordinary, 220 samples, 8 pu | 215 | 876 | **1** | 0.40 ms |
| long, 1000 samples, 8 pu | 555 | 2236 | **1** | 1.48 ms |
| very long, 5000 samples, 8 pu | 670 | 2694 | **1** | 3.45 ms |
| very long, 5000 samples, 24 pu | 670 | 2694 | **1** | 5.42 ms |

**One contour per fill, at every length and every width.** D-031 measured six
thousand contours in a single fill at 155 ms a frame against 8.4 ms for the same
vertices in batches; a swept swath never enters that regime, so there is nothing
to batch and no batch size to tune.

Live evaluation over a 5000-sample stroke at 12 samples a frame: **first frames
0.027 ms, last frames 0.022 ms**, maximum 2.0 ms across 416 frames. The last
frames cost no more than the first, which is the settled-prefix contract doing
its job — settled samples are evaluated once and the tail is bounded by the
smoothing window, not by the stroke.

Placements saturate with distance rather than growing with the event rate: 1000
samples give 555 placements and 5000 give 670, because above the decimation
threshold the step is the brush's, not the device's.

Mounted, the live stroke and the committed stroke covered **exactly the same
2250 cells** either side of pointer-up.

## No cache, and no new state

Marker keeps nothing Pencil keeps. No material runtime, no tile raster, no paper
field, no resource registry, no offscreen coverage mask. The only state is the
geometry every strategy keeps — one evaluator per live stroke, and an
eight-entry per-stroke cache of committed geometry keyed by scale, both already
built.

## How the width was decided

The engine draws a chisel. Whether the *shipped preset* was a marker was a
different question, and it was decided by looking.

The migration deliberately changed the strategy and nothing else, so the first
sheets showed exactly what the existing preset now drew rather than what a
retuned one would. At eight page units the nib character was there — one
diagonal visibly wider than the other — but the weight read as a broad pen.
Twelve is the reviewed answer. Measured off the comparison strip, in screen
pixels at 108% zoom:

| size | tap chord | horizontal / vertical | along the nib | across the nib | ratio |
| --- | --- | --- | --- | --- | --- |
| 8 | 4 | 8.0 | 4.2 | 8.5 | 0.50 |
| **12** | **8** | **10.0** | **5.7** | **12.7** | **0.44** |
| 14 | 9 | 12.0 | 6.4 | 15.6 | 0.41 |
| 26 | 16 | 24.0 | 12.0 | 28.3 | 0.43 |

What the width bought is **contrast**: the broad direction grew by half again
while the narrow one barely moved. The ratios cluster on the engine's 0.42; the
spread is pixel quantisation at the thin end, not the brush. The same quantities
read off the geometry rather than the screen are 9.961463 axis-aligned, 5.04
along the nib and exactly 12 across it, and those three are pinned.

An early version of that strip understated the brush and had to be corrected:
its diagonals were 120 by 100 rather than square, so neither of them was the
extreme, and the measured ratio came out between 0.46 and 0.55 depending on the
row. Close to forty-five degrees is not forty-five degrees in the one picture
whose job is to show the difference.

Pressure was the other question, and the conservative answer was kept:
`marker-felt` resolves neither response, so the pen rows at 0.15, 0.5 and 0.95
are identical to each other and to the mouse row *by design*. A marker barely
responds to pressure; what varies is which way you drew. The strategy consumes
both responses generically — tested separately — so enabling one later is a
preset change rather than engine work.

## What the sheet measured

Read off the production renderer's own pixels rather than asserted by eye. Ink
is `#1f2937` at 0.9 on this paper, so one coat predicts luminance 61.3 and two
predict 42.0.

| | |
| --- | --- |
| a plain run, 1060 px long | 10–11 ink rows and darkness 61.0 at every x sampled |
| a figure-eight's crossings | 61.0 — the same as its own arm, no two-coat pixel anywhere |
| a retrace, out and back | 61.0, the luminance profile of a plain line |
| two separate strokes crossing | arm 61.0, crossing 41.9 |
| nine shading rows closer than the mark is wide | lightest pixel inside the block 61.0, so no paper shows through; profile alternates 61 / 42 with no third level |
| mouse vs pen at 0.15, 0.50, 0.95 | 0 of 431 columns differ, identical darkness |
| a loop, 180 radial scans | band 5.5–14.0 px as direction turns, 0 broken scans, interior clean |
| a tap | an 8 px angled chord, which is the capsule's own horizontal section |

The two crossing numbers are the accumulation semantics in their most direct
form: within a stroke the page never takes a second coat, between strokes it
takes exactly one more.

## Artifacts

Regenerate with `FOLIO_MARKER_SHEET=1 MARKER_LABEL=<name>`; they land in
`test-results/marker/`, which is gitignored.

- `<label>-sheet-12pu.png` — at the preset's own width: three taps, a short run,
  the four orientations, a curve, a corner, a long run, a U-turn, a loop, a
  zigzag, a self-crossing figure-eight, a retrace, two separate strokes crossing,
  nine rows of dense shading, and a mouse row above three pen rows
- `<label>-detail-12pu.png` — the same width drawn at 300%, where the chisel
  terminals and the nib's edge are legible; zooming also asks the strategy a
  real question, since the committed geometry is rebuilt at the new scale
- `<label>-comparison-8-12-14-26.png` — five marks per width, top to bottom,
  with both diagonals squared to forty-five degrees. Diagnostic: it shows what
  the chosen width was chosen against

How deterministic, measured rather than assumed: two runs of the same build give
byte-identical detail and comparison images, and sheets differing on 143 of 1.6
million pixels by at most 11 of 255 — the brush cursor ring at the last point
drawn, and a hover state on the colour rail. No mark differs. Nothing compares
screenshots today, so that costs nothing; it is written down because the first
person who tries to will want to know.

The sheet asserts that every case drew and that the console stayed quiet. It
asserts nothing about a pixel; the pixels are pinned in the freeze suite
instead, where a failure can say which shape moved.
