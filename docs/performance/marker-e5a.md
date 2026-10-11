# A marker is a shape being dragged

**`marker@1` visuals are not frozen.** This records what was built and what it
measures; the appearance is a candidate awaiting review, and the roster gate in
`pencil-visual-freeze.test.ts` says so in the one place a later phase cannot
miss it.

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

Both shipped Marker presets resolve neither response, so in production this is
one fill.

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

## The visual question this phase does not answer

The engine draws a chisel. Whether `marker-felt`'s shipped **size 8** is a
marker is a different question, and it belongs to whoever approves the
appearance.

The migration deliberately changed the strategy and nothing else: the preset's
width, opacity and smoothing are the ones it already had, so the sheets show
exactly what the existing preset now draws rather than what a retuned one would.
At 8 page units the mark reads closer to a broad pen than to a marker — the nib
character is there and one diagonal is visibly wider than the other, but the
overall weight is light. At 26 page units it is unmistakable: solid swaths,
angled terminals, strong thick-to-thin by direction.

Both sheets are in the artifacts below so the comparison is one glance rather
than an argument. Changing the default is a product decision about what people's
Marker slot draws, not an engine one.

Pressure is the other open question, and it is already answered the conservative
way: `marker-felt` resolves neither response, so the sheet's pen rows at 0.15,
0.5 and 0.95 are identical to each other and to the mouse row *by design*. A
marker barely responds to pressure; what varies is which way you drew. The
strategy consumes both responses generically, so enabling one is a preset
change rather than engine work.

## Artifacts

Regenerate with `FOLIO_MARKER_SHEET=1 MARKER_LABEL=<name>`; they land in
`test-results/marker/`, which is gitignored.

- `<label>-sheet-default-8pu.png` — taps, four orientations, short and long
  runs, an arc, a tight turn, a loop, a zigzag, three crossings and seven rows
  of dense shading, at the preset's own width
- `<label>-sheet-broad-26pu.png` — a mouse row and three pen rows at 0.15, 0.5
  and 0.95 pressure, a broad arc, a broad zigzag, a tap and two opposed
  diagonals, at 26 page units
- `<label>-detail-broad-diagonals.png` — a close look at the two diagonals
  crossing, where the nib's edge and the between-stroke darkening are legible

The sheet asserts that every case drew and that the console stayed quiet. It
asserts nothing about a pixel, because there is nothing to assert yet.
