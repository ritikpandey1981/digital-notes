# Pencil performance result

This records what `pencil@1` measured, what the measurement changed about its design, and
what happened to the strategies that were already frozen while it was added. It does not
replace [`desktop-baseline.md`](desktop-baseline.md), which remains the reference for the
machine, the method and the limits on what these numbers can support, nor
[`technical-pen-e2.md`](technical-pen-e2.md) or [`pressure-pen-e3.md`](pressure-pen-e3.md).

**Superseded in part.** Every number below was measured against a deposition model that was
replaced in E4.1, before `pencil@1` had reached a release, because it did not look like
graphite. The current figures are in [`pencil-e4-1.md`](pencil-e4-1.md). What this document
records that has not been superseded is section 2 — the discovery that Canvas 2D's contour
cost is quadratic within one fill — which is still the constraint every stamped strategy is
designed around.

## 1. Method

Same harness, same machine, same measurement boundaries as Phase D. The harness gained
`pencil` as a fifth measurable strategy, three volume counters (`stamps`, `marks`,
`contours`, `path-vertices`), and one environment variable, `FOLIO_BASELINE_LIVE_KINDS`,
which narrows the live stage to named strategies. The last exists because one crashing
workload should not cost every measurement queued behind it — which happened twice during
this phase.

```powershell
$env:FOLIO_BASELINE_RUN="e4-final"; $env:FOLIO_BASELINE_GROUPS="stroke"; $env:FOLIO_BASELINE_MODEL_SIZES="1000,5000,20000"; $env:FOLIO_BASELINE_STAGES="models"; node tests/performance/run-baseline.mjs
$env:FOLIO_BASELINE_RUN="e4-ribbons"; $env:FOLIO_BASELINE_GROUPS="none"; $env:FOLIO_BASELINE_STAGES="live"; $env:FOLIO_BASELINE_LIVE_KINDS="pencil"; node tests/performance/run-baseline.mjs --grep "measured desktop baseline"
$env:FOLIO_BASELINE_RUN="e4-frozen"; $env:FOLIO_BASELINE_GROUPS="none"; $env:FOLIO_BASELINE_STAGES="live"; $env:FOLIO_BASELINE_LIVE_KINDS="technical-pen,pressure-pen,centerline"; node tests/performance/run-baseline.mjs --grep "measured desktop baseline"
```

Only the `stroke` and `live` groups were run. Navigation, selection, persistence, recovery
and memory are untouched by this work and were not re-measured.

**One caveat about absolute numbers, stated before any of them.** This machine ran
measurably slower during E4 than during E3 — `stroke/20000/centerline/geometry` is 117 ms
here against 102 ms in E3, and `stroke/20000/outline/geometry` 197 ms against 181 ms, on
code neither phase touched. Every comparison below is therefore **within one run**.
Comparing an E4 figure to an E3 figure measures the afternoon, not the change.

Pencil is measured with both responses enabled, under the shared fixture's pressure
sawtooth (`0.3 + (index % 9) / 15`, swinging between 0.3 and 0.83 every nine samples). As a
coverage signal that is adversarial rather than representative: it crosses the coverage
range constantly, so it produces more broken runs — and therefore more contours, which is
Pencil's cost — than a real hand would. The fixture was left alone rather than softened.

## 2. What the measurement changed

This is the part worth reading. The first working Pencil was correct, deterministic,
prefix-stable, and unusable.

Counted on the live fixture at twenty thousand samples, where the whole live stroke is
repainted every frame:

| Form | Contours | Vertices | Fills | `live/pencil/20000/64` p50 |
| --- | ---: | ---: | ---: | ---: |
| One contour per mark, one `fill()` | 60 055 | 240 220 | 1 | renderer crashed |
| Runs merged, one `fill()` | 6 375 | 107 876 | 1 | 155.6 ms |
| Runs merged, batches of 48 | 8 439 | 143 768 | 176 | **8.4 ms** |
| *(`pressure-pen@1`, for scale)* | *1 013* | *50 775* | *1 013* | *2.9 ms* |

Read the third row against the second. It has **more** contours and **more** vertices than
the row above it, and it is eighteen times faster. The only difference is that the path is
handed to the rasterizer in batches instead of all at once.

Evaluation was never the problem. Measured separately on the same fixture, the worst single
frame's evaluation was 2.0 ms at five thousand samples and 6.9 ms at twenty thousand,
before any of these changes — the settled-prefix design did its job from the start. The
entire difference above is painting.

The finding, stated plainly: **Canvas 2D resolves a path's contours against one another,
and the cost of doing so is quadratic in how many there are inside a single `fill()`, and
linear across fills.** Vertex count barely enters it: `pressure-pen@1` pays half the
vertices of the second row and is fifty-three times faster, while the third row pays a
third more vertices than the second and is eighteen times faster.

The same progression at five thousand samples, for completeness: 195.4 ms for a contour per
mark, 19.3 ms for merged runs in one fill, 3.8 ms for merged runs in batches.

Two design changes followed, and the first is geometry rather than painting:

- **Merge before emitting.** Consecutive stamps that ink the same grain lane overlap by
  construction, so they become one ribbon. Their union was the picture anyway.
- **Then batch, which requires disjointness.** Splitting a path is only safe when no two
  contours overlap, so the geometry earns it: a mark is narrowed before it is moved, so it
  cannot leave its lane, and a run stops short of where the next run in that lane begins.

A third change came from the same pressure: the grain became two lattices instead of one. A
coarse `GRAIN_TOOTH` decides whether a patch of paper catches graphite, and a fine
`GRAIN_FLECK` decides how a mark wobbles once laid. Contours are then bounded by the tooth
rather than by the stamp rate, while the edge stays finely irregular.

## 3. Live input

p95, milliseconds. The three frozen comparisons are from the same day.

| Workload | Metric | centerline | technical-pen | pressure-pen | **pencil** |
| --- | --- | ---: | ---: | ---: | ---: |
| 100 / 1 | callback work | 1.6 | 0.4 | 0.5 | **0.8** |
| 100 / 1 | input-to-callback-end | 8.9 | 8.5 | 8.5 | **8.8** |
| 1 000 / 4 | callback work | 4.7 | 0.6 | 0.8 | **1.4** |
| 1 000 / 4 | input-to-callback-end | 9.5 | 8.5 | 8.6 | **8.7** |
| 5 000 / 16 | callback work | 15.7 | 1.0 | 2.1 | **6.5** |
| 5 000 / 16 | input-to-callback-end | 16.1 | 8.5 | 8.7 | **9.2** |
| 20 000 / 64 | callback work | 57.8 | 2.5 | 5.1 | **14.4** |
| 20 000 / 64 | input-to-callback-end | 58.6 | 8.5 | 9.0 | **15.4** |

Frames over the 16.67 ms budget:

| Workload | centerline | technical-pen | pressure-pen | **pencil** |
| --- | ---: | ---: | ---: | ---: |
| 100 / 1 | 0 of 95 | 0 of 95 | 0 of 95 | **0 of 95** |
| 1 000 / 4 | 0 of 246 | 0 of 246 | 0 of 246 | **0 of 246** |
| 5 000 / 16 | 14 of 309 | 0 of 309 | 0 of 309 | **0 of 309** |
| 20 000 / 64 | 232 of 309 | 0 of 309 | 0 of 309 | **8 of 309** |

Pencil holds input-to-callback-end at 8.7–9.2 ms through five thousand samples, which is
the 120 Hz frame interval and almost nothing else, and at 15.4 ms at twenty thousand. Eight
frames of 309 exceed the budget in the longest workload and none do anywhere else.

It costs more than either pen, as the phase expected a dry medium to. Against Technical Pen
it is about six times the callback work at twenty thousand samples; against Pressure Pen,
about three. What it buys is a mark made of thousands of separate pieces of graphite
instead of one continuous shape. Against the strategy an artist would otherwise have been
drawing pencils with, it is four times *cheaper*: centerline costs 57.8 ms p95 on the same
workload and misses 232 frames of 309, where Pencil misses eight.

**The growth is in painting, and painting is linear in the ink drawn.** Callback work goes
0.8 → 1.4 → 6.5 → 14.4 ms p95 while the stroke grows two hundredfold; contour count over
the same range goes 117 → 570 → 2 161 for the geometry fixture. Evaluation is bounded by
the open tail and is asserted structurally in the unit suite rather than inferred from
these timings. What is not bounded — for any strategy, including both frozen pens — is that
a live frame repaints the whole live stroke, because the dirty rect grows to contain it.
That is the architecture, and Pencil pays more for it per unit length than a pen does.

## 4. Stroke geometry

p50, milliseconds, for one complete evaluation.

| Samples | centerline | outline | technical-pen | pressure-pen | **pencil** |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 000 | 5.9 | 8.5 | 0.6 | 1.8 | **1.2** |
| 5 000 | 25.8 | 43.2 | 1.8 | 5.2 | **4.8** |
| 20 000 | 117.3 | 197.4 | 7.5 | 23.2 | **23.8** |

Fitting a power law across those three points gives an exponent of **1.00** for Pencil,
against 0.97 for centerline, 1.05 for outline, 0.85 for Technical Pen and 0.86 for Pressure
Pen. Pencil evaluates at almost exactly the same cost as Pressure Pen and roughly a fifth
of centerline's, which is the right shape: both walk a decimated centerline once and emit
per-sample geometry.

A cold committed rebuild follows the same pattern: 20.9 ms at twenty thousand samples
against centerline's 115.1 and outline's 189.9.

## 5. What a repaint actually costs

Volume counters, from the `stroke` group's own fixture.

| Samples | stamps | marks | contours | vertices | fills |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 000 | 417 | 701 | 117 | 1 870 | 3 |
| 5 000 | 2 082 | 3 473 | 570 | 9 226 | 12 |
| 20 000 | 8 325 | 14 063 | 2 161 | 36 770 | 46 |

These are the `stroke` group's shorter fixture, not the live one, so they are smaller than
the live figures in section 2; the ratios are what matter.

A *stamp* is one tip placement. A *mark* is a lane of that tip that received graphite; the
ratio is the coverage the pressure signal produced. A *contour* is an unbroken run of marks
in one lane, which is the unit the rasterizer charges for, and the ratio of marks to
contours — about 6.5 here — is what merging buys. Fills are contours in batches of 48.

For comparison at twenty thousand samples, `pressure-pen@1` produces 867 contours and
39 920 vertices. Pencil produces 2.5 times the contours and 0.9 times the vertices, and
costs 2.7 times the live callback work. Contours, not vertices, are the currency.

## 6. Strategies that were already frozen

The acceptance condition was that no frozen strategy moves.

The strongest evidence is not a timing. `engine-strategy-freeze.test.ts` pins every number
a painter reads for `technical-pen@1` and `pressure-pen@1`, at three smoothing settings and
two scales, and those digests are **byte-identical** before and after this phase —
`technical-pen@0:x1q4l0`, `technical-pen@0.3:a2i6kf`, `pressure-pen@0:6bm694`,
`pressure-pen@0.18:92y0oo`. `legacy-strategy-freeze.test.ts` does the same for
`centerline@1` and `outline@1`. No pixel of any existing artwork moved, and no timing is
needed to establish that.

Live, within this run, both engine pens sit where they have always sat: Technical Pen at
8.5 ms input-to-callback-end across every workload with 2.5 ms p95 callback work at twenty
thousand samples, Pressure Pen at 8.5–9.0 ms with 5.1 ms. Both are inside 10% of their E3
figures (2.5 against 2.5, and 5.1 against 4.8) despite the machine's slower day, and
neither misses a single frame in any workload. Centerline is unchanged in kind: it still
misses 232 of 309 frames at twenty thousand samples.

The one thing E4 adds to their code path is a seed argument threaded through
`createBrushRenderGeometry` and `createLiveBrushEvaluator`, which both frozen strategies
ignore. It is one FNV hash of a short string per geometry build — not per sample, not per
frame — and it is not visible in any figure above.

## 7. What this does not establish

Every limitation in [`desktop-baseline.md`](desktop-baseline.md) still applies: one
machine, one display, a software GPU path, a Vite development runtime under React
StrictMode, and live timings that exclude presentation, scanout and pen hardware.

Four more are specific to this result.

The long-stroke figures are synthetic input at a fixed density, not a hand. Nothing here
was measured with a physical stylus, so how much coverage a real digitizer's pressure noise
actually produces — and therefore how many contours a real stroke costs — is unvalidated.

The twenty-thousand-sample workload is a continuous line roughly sixty page-widths long.
Pencil's cost is proportional to the *area of medium laid down*, which is the honest unit
for a particle medium and an unusually harsh one for that fixture. No conclusion about
ordinary drawing should be drawn from it beyond "it does not fall over".

The quadratic-contour finding is measured on this Chromium and this rasterizer. The
*shape* of it is a property of scan-converting a path with many contours and is unlikely to
invert, but the constant that makes 48 the right batch size is not portable, and a GPU
backend would change the question entirely.

Nothing here measures a page full of committed pencil strokes. Dense-page repaint was
measured in Phase D against centerline artwork, and a page of Pencil would be more
expensive per stroke by the ratios in section 5. That is the measurement Marker's phase
should take, because it is the one that decides whether a stamped medium needs a retained
layer.
