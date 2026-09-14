# Pressure Pen performance result

This records what `pressure-pen@1` measured against the Phase D baseline and against
`technical-pen@1`, and what changed for the three strategies that were already frozen while
it was added. It does not replace [`desktop-baseline.md`](desktop-baseline.md), which
remains the reference for the machine, the method and the limits on what these numbers can
support, or [`technical-pen-e2.md`](technical-pen-e2.md), which is what E2 measured.

## 1. Method

Same harness, same machine, same measurement boundaries as Phase D. The harness gained
`pressure-pen` as a fourth measurable strategy and nothing else: no workload, count,
density or sample stream was changed.

Dynamics are deliberately *not* shared across the four. Each kind carries what its shipped
preset carries, so what is being measured is what an artist actually pays for: Pressure Pen
is measured with both responses enabled, including the non-linear opacity curve, because
that is how `pen-brush` resolves.

```powershell
$env:FOLIO_BASELINE_RUN="e3-pressure-pen"; $env:FOLIO_BASELINE_GROUPS="stroke"; $env:FOLIO_BASELINE_MODEL_SIZES="1000,5000,20000"; $env:FOLIO_BASELINE_STAGES="models"; node tests/performance/run-baseline.mjs
$env:FOLIO_BASELINE_RUN="e3-pressure-pen-live"; $env:FOLIO_BASELINE_GROUPS="none"; $env:FOLIO_BASELINE_STAGES="live"; node tests/performance/run-baseline.mjs --grep "measured desktop baseline"
```

The live stage was run twice, under the same foreground guard Phase D introduced. Raw
measurement directories stay test artifacts and are not tracked.

Only the `stroke` and `live` groups were repeated. Dense navigation, selection, persistence,
recovery and memory are untouched by this work and were not re-measured.

**One property of the shared fixture is worth naming, because it flatters nobody.** Its
pressure is `0.3 + (index % 9) / 15` — a sawtooth swinging between 0.3 and 0.83 every nine
samples. As an opacity signal that is adversarial rather than representative: it crosses the
band tolerance constantly, so these figures are close to Pressure Pen's worst case for
banding and not its typical one. The fixture was left alone rather than softened, because
changing it would have made every comparison against Phase D and E2 meaningless.

## 2. Live input

p95, milliseconds.

| Workload | Metric | centerline | outline | technical-pen | **pressure-pen** |
| --- | --- | ---: | ---: | ---: | ---: |
| 100 / 1 | callback work | 1.5 | 2.5 | 0.6 | **0.7** |
| 100 / 1 | input-to-callback-end | 9.0 | 9.0 | 8.7 | **8.8** |
| 1 000 / 4 | callback work | 3.9 | 11.8 | 0.7 | **1.1** |
| 1 000 / 4 | input-to-callback-end | 9.2 | 12.1 | 8.6 | **8.7** |
| 5 000 / 16 | callback work | 13.4 | 63.2 | 1.2 | **2.2** |
| 5 000 / 16 | input-to-callback-end | 13.9 | 63.7 | 8.6 | **8.8** |
| 20 000 / 64 | callback work | 49.4 | 257.4 | 2.5 | **4.8** |
| 20 000 / 64 | input-to-callback-end | 50.2 | 257.8 | 8.6 | **8.7** |

Frames over the 16.67 ms budget:

| Workload | centerline | outline | technical-pen | **pressure-pen** |
| --- | ---: | ---: | ---: | ---: |
| 100 / 1 | 0 of 97 | 0 of 97 | 0 of 97 | **0 of 97** |
| 1 000 / 4 | 0 of 988 | 0 of 988 | 0 of 988 | **0 of 988** |
| 5 000 / 16 | 16 of 4 952 | 3 640 of 4 952 | 0 of 4 952 | **0 of 4 952** |
| 20 000 / 64 | 13 839 of 19 808 | 18 758 of 19 808 | 0 of 19 808 | **0 of 19 808** |

The last column is the result. Pressure Pen's input-to-callback-end sits at 8.7–8.8 ms at
every stroke length — which is the 120 Hz frame interval and almost nothing else — and not
one frame in any workload exceeded the budget. Its callback work grows from 0.7 ms to
4.8 ms while the stroke grows two hundredfold; centerline multiplies by 33 over the same
range and outline by 103, because both rebuild the whole stroke every frame.

Against the two references the phase was set:

- **It does not regress to the legacy outline.** At 20 000 samples the same stroke costs
  8.7 ms instead of 257.8 — thirty times better on latency, fifty-four on callback work —
  and outline misses 95% of its frames where Pressure Pen misses none.
- **It costs roughly twice Technical Pen**, which is what a varying width is worth: two
  boundary points per sample instead of one curve control, tessellated corners, and a fill
  per alpha band rather than one stroke for the path. That was the expected shape and the
  objective was never to match a constant width exactly.

Run two agrees: 8.7, 8.7, 8.8 and 9.0 ms across the same four workloads, zero frames over
budget in all of them, and callback work from 0.8 to 5.2 ms.

The residual growth in callback work is the per-frame draw loop, which is linear in
boundary vertices and always was. Evaluation itself is bounded by the open tail, which is
asserted structurally in the unit suite rather than inferred from these timings.

### What the bands actually cost

Measured on the same fixture, at unit scale:

| Samples | kept | bands | boundary vertices | vertices per fill |
| ---: | ---: | ---: | ---: | ---: |
| 1 000 | 736 | 44 | 1 994 | 45 |
| 5 000 | 3 682 | 217 | 9 974 | 46 |
| 20 000 | 14 724 | 867 | 39 920 | 46 |

So a 20 000-sample stroke on the sawtooth is **867 `fill()` calls per frame**, and it still
sits at 8.7 ms with nothing over budget. That is the number the minimum band length exists
to hold down: the ratio stays at one fill per forty-six vertices at every length, so
banding is a bounded fraction of the path rather than a cost that overtakes it. At the
four-span minimum this shipped with initially it would have been roughly 3 600 fills for
the same drawing.

A brush with `pressureOpacity` disabled resolves to exactly one band and one fill, whatever
its length.

## 3. Stroke geometry

p50, milliseconds, for one complete evaluation.

| Samples | centerline | outline | technical-pen | **pressure-pen** |
| --- | ---: | ---: | ---: | ---: |
| 1 000 | 6.3 | 9.2 | 0.6 | **1.2** |
| 5 000 | 22.4 | 41.8 | 1.8 | **4.9** |
| 20 000 | 102.4 | 180.9 | 7.3 | **21.4** |

Fitting a power law across those three points gives an exponent of 0.96 for Pressure Pen,
against 0.83 for Technical Pen, 0.93 for centerline and 0.99 for outline. All four are
linear-like. Pressure Pen's constant is roughly five times smaller than centerline's and
eight times smaller than outline's, and about three times larger than Technical Pen's.

A cold committed rebuild follows the same pattern: at 20 000 samples, 21.5 ms against
centerline's 105.1 and outline's 184.0.

The gap to outline is a difference in kind of work, not quantity. Outline runs an adaptive
least-squares fit with Newton reparameterization, corner detection and self-intersection
guards, then resamples the fitted curve. Pressure Pen offsets a decimated polyline by a
radius it already has, which is also what makes it prefix-stable.

## 4. Strategies that were already frozen

The acceptance condition was that no frozen strategy moves by more than 10%.

Live, p95, run one against E2's two runs. No metric exceeded 10% on either E3 run; run
two's largest movement was +4.2%.

| Metric | E2 | E3 | Change |
| --- | ---: | ---: | ---: |
| `live/centerline/100/1/callback-work` | 1.6 | 1.5 | −6.2% |
| `live/centerline/100/1/input-to-callback-end` | 9.0 | 9.0 | 0.0% |
| `live/centerline/5000/16/input-to-callback-end` | 14.4 | 13.9 | −3.5% |
| `live/centerline/20000/64/input-to-callback-end` | 51.8 | 50.2 | −3.1% |
| `live/outline/100/1/callback-work` | 2.5 | 2.5 | 0.0% |
| `live/outline/1000/4/input-to-callback-end` | 12.8 | 12.1 | −5.5% |
| `live/outline/5000/16/input-to-callback-end` | 62.1 | 63.7 | +2.6% |
| `live/outline/20000/64/input-to-callback-end` | 257.7 | 257.8 | 0.0% |
| `live/technical-pen/100/1/input-to-callback-end` | 8.8 | 8.7 | −1.1% |
| `live/technical-pen/5000/16/callback-work` | 1.2 | 1.2 | 0.0% |
| `live/technical-pen/20000/64/input-to-callback-end` | 8.6 | 8.6 | 0.0% |
| `live/technical-pen/20000/64/callback-work` | 2.4 | 2.5 | +4.2% |

Geometry, p50:

| Metric | E2 | E3 | Change |
| --- | ---: | ---: | ---: |
| `stroke/1000/centerline/geometry` | 6.3 | 6.3 | 0.0% |
| `stroke/5000/centerline/geometry` | 23.0 | 22.4 | −2.6% |
| `stroke/20000/centerline/geometry` | 102.0 | 102.4 | +0.4% |
| `stroke/1000/outline/geometry` | 8.7 | 9.2 | +5.7% |
| `stroke/5000/outline/geometry` | 42.3 | 41.8 | −1.2% |
| `stroke/20000/outline/geometry` | 178.5 | 180.9 | +1.3% |
| `stroke/1000/technical-pen/geometry` | 0.5 | 0.6 | +20.0% |
| `stroke/5000/technical-pen/geometry` | 1.8 | 1.8 | 0.0% |
| `stroke/20000/technical-pen/geometry` | 7.1 | 7.3 | +2.8% |

Everything is inside the band except one figure that cannot be read as a percentage:
`stroke/1000/technical-pen/geometry` moved 0.5 ms to 0.6 ms, which is a single tick of a
clock that quantizes to 0.1 ms. Its p95 moved 0.7 to 0.9 on the same metric. Two things
argue this is measurement rather than change: Technical Pen's geometry is byte-identical
to its E2 implementation — the unit suite proves it against the file as it stood at
`842e691`, across three smoothing settings and four scales — and the same strategy's live
metrics at 5 000 and 20 000 samples did not move at all.

One p95 worth recording rather than smoothing over: `stroke/20000/outline/geometry` p95
went 183.7 to 212.9 (+15.9%) while its p50 moved +1.3% and its cache-miss p95 moved −7.3%.
That is a tail on a metric whose own Phase D runs differed by more than a millisecond, not
a change in the fit; nothing in this phase touches the outline builder. It is the one
number here worth re-checking if outline is measured again.

## 5. What this does not establish

Every limitation in [`desktop-baseline.md`](desktop-baseline.md) still applies: one
machine, one display, a software GPU path, a Vite development runtime under React
StrictMode, and live timings that exclude presentation, scanout and pen hardware.

Three further limits are specific to this result. The long-stroke figures are synthetic
input at a fixed density, not a hand. Nothing here was measured with a physical stylus, so
Pressure Pen's behaviour on real pressure hardware — including how much banding a real
digitizer's noise actually buys — remains unvalidated in the same way every other
strategy's is. And the fixture's pressure sawtooth means the banding cost measured here is
a near-worst case: a real stroke should cost less, but that is an argument, not a
measurement.
