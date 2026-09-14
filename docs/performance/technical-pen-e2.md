# Technical Pen performance result

This records what `technical-pen@1` measured against the Phase D baseline, and what
changed for the two frozen legacy strategies while it was added. It does not replace
[`desktop-baseline.md`](desktop-baseline.md), which remains the reference for the
machine, the method and the limits on what these numbers can support.

## 1. Method

Same harness, same machine, same measurement boundaries as Phase D. The harness gained
`technical-pen` as a third measurable strategy and nothing else: the fixture gives all
three the same size, opacity and smoothing, and no workload, count or density was
changed. `pressureSize` is disabled for Technical Pen, as it already was for centerline.

```powershell
$env:FOLIO_BASELINE_RUN="e2-technical-pen"; $env:FOLIO_BASELINE_GROUPS="stroke"; $env:FOLIO_BASELINE_MODEL_SIZES="1000,5000,20000"; $env:FOLIO_BASELINE_STAGES="models"; node tests/performance/run-baseline.mjs
$env:FOLIO_BASELINE_RUN="e2-technical-pen-live"; $env:FOLIO_BASELINE_GROUPS="none"; $env:FOLIO_BASELINE_STAGES="live"; node tests/performance/run-baseline.mjs --grep "measured desktop baseline"
```

The live stage was run twice, under the same foreground guard Phase D introduced. Raw
measurement directories stay test artifacts and are not tracked.

Only the `stroke` and `live` groups were repeated. Dense navigation, selection,
persistence, recovery and memory are untouched by this work and were not re-measured.

## 2. Live input

p95, milliseconds. Phase D column is run #2.

| Workload | Metric | centerline | outline | **technical-pen** |
| --- | --- | ---: | ---: | ---: |
| 100 / 1 | callback work | 1.6 | 2.5 | **0.6** |
| 100 / 1 | input-to-callback-end | 9.0 | 9.2 | **8.7** |
| 1 000 / 4 | callback work | 3.7 | 12.8 | **0.8** |
| 5 000 / 16 | callback work | 13.5 | 62.4 | **1.3** |
| 5 000 / 16 | input-to-callback-end | 13.9 | 62.1 | **8.6** |
| 20 000 / 64 | callback work | 50.5 | 254.4 | **2.3** |
| 20 000 / 64 | input-to-callback-end | 51.3 | 255.4 | **8.6** |

Frames over the 16.67 ms budget, Technical Pen, across both runs:

| Workload | Over budget |
| --- | --- |
| 100 / 1 | 0 of 97 |
| 1 000 / 4 | 0 of 988 |
| 5 000 / 16 | 0 of 4 952 |
| 20 000 / 64 | 0 of 19 808 |

The shape of that first column is the result. Technical Pen's callback work grows from
0.6 ms to 2.3 ms while the stroke grows two hundredfold, and its input-to-callback-end
stays at 8.6-8.7 ms at every length — which is the 120 Hz frame interval and almost
nothing else. Centerline multiplies by 31 over the same range and outline by 94, because
both rebuild the whole stroke every frame.

The residual growth in Technical Pen's callback work is the per-frame draw loop and
bounds union, both linear in segment count. Evaluation itself is bounded by the open
tail, which is asserted structurally in the unit suite rather than inferred from these
timings.

## 3. Stroke geometry

p50, milliseconds, for one complete evaluation.

| Samples | centerline | outline | **technical-pen** |
| --- | ---: | ---: | ---: |
| 1 000 | 6.3 | 8.7 | **0.5** |
| 5 000 | 23.0 | 42.3 | **1.8** |
| 20 000 | 102.0 | 178.5 | **7.1** |

Fitting a power law across those three points gives an exponent of 0.89 for Technical
Pen, against 0.93 for centerline and 1.01 for outline on the same run. All three are
linear-like; Technical Pen's constant is roughly 14 times smaller than centerline's and
25 times smaller than outline's.

That gap is a difference in kind of work rather than in quantity. The legacy strategies
run an adaptive least-squares fit with Newton reparameterization, corner detection and
self-intersection guards. Technical Pen converts each span to a cubic from four points
using closed-form arithmetic, which is also what makes it prefix-stable.

Finalize and committed-geometry cache-miss costs follow the same pattern: at 20 000
samples, a cold committed rebuild is 7.0 ms against centerline's 104.8 ms.

## 4. Legacy strategies

The acceptance condition was that neither frozen strategy moves by more than 10%.

| Metric | Phase D | E2 | Change |
| --- | ---: | ---: | ---: |
| `live/centerline/100/1/callback-work` p95 | 1.6 | 1.6 | 0.0% |
| `live/centerline/100/1/input-to-callback-end` p95 | 9.0 | 9.0 | 0.0% |
| `live/centerline/5000/16/input-to-callback-end` p95 | 14.0 | 13.9 | −0.7% |
| `live/centerline/20000/64/input-to-callback-end` p95 | 51.9 | 51.3 | −1.2% |
| `live/outline/100/1/callback-work` p95 | 2.3 | 2.5 | +8.7% |
| `live/outline/100/1/input-to-callback-end` p95 | 9.0 | 9.2 | +2.2% |
| `live/outline/5000/16/input-to-callback-end` p95 | 61.1 | 62.1 | +1.6% |
| `live/outline/20000/64/input-to-callback-end` p95 | 254.0 | 257.7 | +0.6% |
| `stroke/1000/centerline/geometry` p50 | 5.8 | 6.3 | +8.6% |
| `stroke/5000/centerline/geometry` p50 | 22.7 | 23.0 | +1.3% |
| `stroke/20000/centerline/geometry` p50 | 103.8 | 102.0 | −1.7% |
| `stroke/1000/outline/geometry` p50 | 8.1 | 8.7 | +7.4% |
| `stroke/5000/outline/geometry` p50 | 41.1 | 42.3 | +2.9% |
| `stroke/20000/outline/geometry` p50 | 180.0 | 178.5 | −0.8% |

Everything is inside the band. The three largest movements are all on 1 000-sample
workloads, which Phase D already identified as the noisiest: the clock quantizes to
0.1 ms, so 5.8 to 6.3 ms is five ticks on a metric whose own two Phase D runs differed
by one.

`live/outline/100/1/callback-work` was the only figure to exceed 10% on the first run
(+17%, 2.3 to 2.7 ms) and came back at +8.7% on the second. Phase D recorded 2.4 and 2.3
for it across its own two runs, so the metric has a known spread of roughly a tick at
0.1 ms resolution on 96 samples. Two things argue against it being the change: the
registry adds one map lookup per geometry call, which is nanoseconds against a 2 ms
budget, and centerline — which pays exactly the same lookup — did not move at all. It is
recorded as noise rather than explained away, and it is the one number here worth
re-checking if outline is measured again.

## 5. What this does not establish

Every limitation in [`desktop-baseline.md`](desktop-baseline.md) still applies: one
machine, one display, a software GPU path, a Vite development runtime under React
StrictMode, and live timings that exclude presentation, scanout and pen hardware.

Two further limits are specific to this result. The long-stroke figures are synthetic
input at a fixed density, not a hand; and nothing here was measured with a physical
stylus, so Technical Pen's behaviour on real hardware remains unvalidated in the same way
every other strategy's is.
