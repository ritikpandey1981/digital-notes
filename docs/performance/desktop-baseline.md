# Folio desktop performance baseline

This is the durable record of Folio's first measured desktop performance baseline. It
describes what was measured, how, and what the numbers mean for planned work. It does not
propose optimizations; unfinished work belongs in [`ROADMAP.md`](../ROADMAP.md) and
durable choices in [`DECISIONS.md`](../DECISIONS.md).

Two independent runs were collected. Run #1 is the full-coverage sweep; run #2 is a
selected repeat of the measurements that matter for scaling and repeatability. No
production renderer, document, or persistence code was changed to produce either run.

## 1. Environment

Both runs were collected on one machine, and the recorded `environment.json` is
byte-identical across every artifact directory.

| Property | Value |
| --- | --- |
| OS | Windows 11 Home Single Language, 10.0.26200 |
| CPU | AMD Ryzen 7 6800H with Radeon Graphics |
| Logical cores | 16 |
| RAM | 16 312 721 408 bytes (~15.2 GiB) |
| Electron | 43.2.0 |
| Chromium | 150.0.7871.129 |
| Node (runtime) | 24.18.0 |
| Node (harness) | 22.23.2 |
| Display | 1536x864 at 120 Hz, scale factor 1.25 |
| Renderer viewport | 1440x900, devicePixelRatio 1.0 |
| GPU | Software path: `glImplementationParts: (gl=none,angle=none)`, no Vulkan, no D3D12 |

Two properties constrain every reading below. The GPU reports no hardware acceleration,
so Canvas 2D work is CPU-bound. The measured runtime is the Vite development harness under
React StrictMode, not a production build; production startup is measured separately.

## 2. Methodology

Measurements are collected by a dedicated Playwright project that launches the real
Electron application, loads the real renderer from a Vite dev server, and drives real
editor code. The harness records timings only. It asserts no speed thresholds, so a
baseline run cannot fail for being slow.

The harness refuses to run unless `FOLIO_PERFORMANCE_BASELINE=1` is set. The same variable
gates the wall-clock assertions that live inside the normal unit suite, keeping
load-sensitive timing assertions out of ordinary test runs.

Every run writes an `environment.json`, a `run.json` manifest with the exact command and
exit code, and a `source-hashes.json` recording the harness files that produced it.

## 3. Benchmark architecture

| File | Role |
| --- | --- |
| `tests/performance/run-baseline.mjs` | Run wrapper; writes the manifest, sets performance mode |
| `tests/performance/desktop-baseline.spec.ts` | Electron baseline: model groups, live input, mounted runtime, persistence, memory |
| `tests/performance/browser-baseline.ts` | In-page workloads executed against real editor modules |
| `tests/performance/fixtures.ts` | Deterministic project fixtures |
| `tests/performance/metrics.ts` | Sample summarization (`min`/`p50`/`p95`/`p99`/`max`, frame-budget counters) |
| `tests/performance/live-scheduling.ts` | Native foreground enforcement and rAF diagnostics |
| `tests/performance/storage-baseline.spec.ts` | Filesystem stage timings |
| `tests/performance/canvas-baseline.spec.ts` | Bare `CanvasSurface` reference points |

Selection is controlled by `FOLIO_BASELINE_GROUPS`, `FOLIO_BASELINE_STAGES`, and
`FOLIO_BASELINE_MODEL_SIZES`, which is how a selected run avoids repeating an exhaustive
sweep.

Fixtures are deterministic: the representative 500-stroke project encoded to exactly
38 190 277 bytes in both runs.

## 4. Measurement boundaries

Understanding what is excluded matters more than the numbers.

- **Live input** is measured from synthetic event receipt, immediately before dispatch, to
  the end of the `StrokeRenderer` requestAnimationFrame callback. It **excludes**
  presentation, compositor scanout, and physical pen hardware latency. It is a software
  latency floor, not end-to-end pen-to-photon latency.
- **Mounted navigation** is measured to two rAF callbacks after the viewport action, which
  includes the renderer's own scheduling but not presentation.
- **Save** is measured to the acknowledged IPC result, including encode.
- **Open** is measured to two rAF callbacks after read, decode, and activation.
- **Memory** is sampled through CDP after an explicit `HeapProfiler.collectGarbage`.

## 5. Baseline #1 artifact composition

Run #1 was collected in two parts. The first process hit a one-hour global timeout during
its final assertion and teardown; a continuation completed the remaining categories without
repeating completed groups. Category coverage is complete across the pair, audited in
`clean-baseline-1-split-audit.json` (321 metrics, no missing categories).

| Artifact directory | Contents |
| --- | --- |
| `clean-baseline-1` | Stroke geometry, document, layers, pages, selection, bare canvas |
| `clean-baseline-1-continuation` | Mounted navigation, Save, Open, recovery, storage, memory, soak, CPU profile, startup |
| `clean-baseline-1-live-correction` | All live input metrics (supersedes the original live records) |

The original `clean-baseline-1/live/*` records are retained as historical evidence only.
They are not a valid live baseline and must not be mixed with corrected live data.

## 6. The D1C live correction

Run #1 originally recorded live frame scheduling at roughly 1001 ms per rAF on a 120 Hz
display, uniformly across all eight live workloads, including one whose real callback work
is about 132 ms. A workload-independent one-second floor is a scheduling artifact, not
compute.

Investigation established one concrete defect: Playwright enables focus emulation, so
`document.hasFocus()` reported `true` for a natively minimized, unfocused window.
`document.visibilityState` stayed `"visible"` and `document.hidden` stayed `false` whether
or not emulation was on, so on Windows no renderer-side signal tracks minimization.
Foreground state must therefore be read from the native `BrowserWindow`.

The harness now disables focus emulation, forces the benchmark window to the foreground,
gates the live stage on a clean rAF probe, and fails the run if any workload loses
foreground ownership. Chromium's normal background throttling policy is left enabled; only
the visibility and focus condition was fixed.

The exact trigger of the historical one-second cadence was **not** reconstructed.
Deliberate minimization did not reproduce it: across four minimized probes rAF held near
8.3 ms. That uncertainty is preserved deliberately.

With the correction in place, the foreground rAF probe reads p50 8.3-8.4 ms and p95 8.5 ms,
consistent with the 120 Hz display.

## 7. Baseline #2 selected-run methodology

Run #2 deliberately repeats only what informs repeatability, Brush Engine readiness, and
the major editor bottlenecks. It is six focused processes rather than one sweep, because
the harness writes one measurement file per process.

| Artifact directory | Scope |
| --- | --- |
| `clean-baseline-2-live` | Live input, all eight workloads, foreground-guarded |
| `clean-baseline-2-geometry` | Stroke geometry at 1 000 / 5 000 / 20 000 samples |
| `clean-baseline-2-selection` | Selection at 100 and 500 objects |
| `clean-baseline-2-navigation` | Mounted dense-page navigation at 5 000 and 10 000 strokes |
| `clean-baseline-2-persistence` | Save, Open, recovery at the 500-stroke fixture |
| `clean-baseline-2-memory` | Project replacement retention observation |

Total runtime was about eight minutes. The 1 000-object selection case was not repeated;
its run #1 result stands as a scaling extreme.

## 8. Repeatability comparison

101 metrics were comparable across runs.

| Band | Count |
| --- | --- |
| Stable (<= 10%) | 55 |
| Moderate (10-25%) | 33 |
| High (> 25%) | 13 |

Those bands are a guideline, and three qualifications matter more than the counts.

**Timer granularity.** The clock quantizes to 0.1 ms. `selection/*/marquee-hit-test` and
`selection/*/selection-creation` moved from 0.1 ms to 0.0 ms, which the arithmetic renders
as -100%. Both are simply below timer resolution in both runs. The same effect inflates
small geometry metrics: `stroke/1000/centerline/finalize` moved 0.4 ms to 0.5 ms, a single
tick, reported as +25%.

**Sparse samples.** Selection at 500 objects records one sample per metric by design,
because a single operation takes seconds. A percentage difference between two single
samples does not establish distribution stability.

**Systematic shift, not noise.** Every selection metric became 17-29% *faster* in run #2,
in one direction, across independent metric families. That is the signature of execution
history: run #1 measured selection after a long sweep, run #2 in a short dedicated process.
The absolute magnitudes remain in the same order, so no conclusion changes.

Excluding sub-millisecond quantization artifacts and the sparse 500-object family, the
genuinely notable variance is `stroke/20000/outline/finalize` (8.6 ms to 12.5 ms, n=20).

## 9. Live drawing

This is the most repeatable part of the entire baseline. All 24 live metrics repeated
within 8%, most within 2%.

Short strokes (100 samples, one per frame):

| Metric | Run #1 p50 / p95 | Run #2 p50 / p95 |
| --- | --- | --- |
| centerline callback work | 1.0 / 1.6 ms | 1.0 / 1.6 ms |
| centerline input-to-callback-end | 8.4 / 9.0 ms | 8.4 / 9.0 ms |
| outline callback work | 1.6 / 2.4 ms | 1.4 / 2.3 ms |
| outline input-to-callback-end | 8.4 / 9.1 ms | 8.3 / 9.0 ms |

Zero frames exceeded the 16.67 ms budget in either run. The input-to-callback-end figure is
dominated by the wait for the next frame, not by Folio's own work: about 8.3 ms of it is
the 120 Hz frame interval.

Larger live workloads, run #2 p50 / p95 of input-to-callback-end:

| Workload | Run #2 | Frames over 16.67 ms |
| --- | --- | --- |
| centerline 5 000 / 16 | 8.7 / 14.0 ms | 0 of 4 952 |
| outline 5 000 / 16 | 32.9 / 61.1 ms | 3 658 of 4 952 |
| centerline 20 000 / 64 | 28.7 / 51.9 ms | 13 805 of 19 808 |
| outline 20 000 / 64 | 132.1 / 254.0 ms | 18 717 of 19 808 |

Centerline holds the frame budget to 5 000 samples. Outline does not: at 5 000 samples it
misses roughly three quarters of frames.

## 10. Geometry scaling

Fitting p50 against sample count across 1 000, 5 000 and 20 000 samples gives an exponent
of 0.96-1.05 in both runs, for both strategies. Quadrupling input from 5 000 to 20 000
samples multiplies cost by 4.4-4.6x.

| Strategy | 1 000 | 5 000 | 20 000 | Per sample |
| --- | --- | --- | --- | --- |
| centerline geometry | 5.8 ms | 22.7 ms | 103.8 ms | ~5.2 us |
| outline geometry | 8.1 ms | 41.1 ms | 180.0 ms | ~9.0 us |

Scaling is **linear-like**, with a mild super-linear tendency that the data does not
separate from measurement noise. There is no evidence of quadratic behaviour.

This is the most consequential interpretation in the document: long-stroke cost is a
**constant-factor** problem, not a complexity-class problem. Outline geometry costs roughly
1.8x centerline per sample. Work aimed at the per-sample constant is the tractable path;
an algorithmic complexity rewrite is not indicated by this evidence.

## 11. Document and dense-page navigation

Measured to two rAF callbacks after the viewport action, run #2:

| Objects | Pan | Zoom | Zoom-then-fit | Replacement |
| --- | --- | --- | --- | --- |
| 5 000 | 255 ms | 255 ms | 501 ms | 834 ms |
| 10 000 | 505 ms | 503 ms | 1 030 ms | 1 723 ms |

These repeated within 5% of run #1 (pan at 10 000 differed by 0.3%). This is the most
stable bad news in the baseline: dense-page navigation is reproducibly one to two orders of
magnitude outside interactive frame latency, and cost tracks object count linearly.

A 10 000-object page cannot be panned interactively. The current renderer repaints the full
page content per viewport change with no spatial culling or cached layer raster, on a
software GPU path.

## 12. Selection

Run #2, 100 objects, Ink:

| Operation | Run #1 | Run #2 |
| --- | --- | --- |
| preview (per continuous update) | 272 ms | 196 ms |
| commit | 534 ms | 393 ms |
| undo | 270 ms | 196 ms |
| move + undo | 384 ms | 304 ms |

Run #2, 500 objects, Ink (single sample each):

| Operation | Run #1 | Run #2 |
| --- | --- | --- |
| preview | 5 096 ms | 3 888 ms |
| commit | 9 939 ms | 7 673 ms |
| move + undo | 9 361 ms | 7 178 ms |

Selection *creation* and marquee hit testing are free: below 0.1 ms even at 500 objects.
The cost is entirely in continuous style editing and command commit.

At 100 objects a continuous style preview updates at about five frames per second. At 500
objects a single style commit takes the better part of eight seconds. Vector objects cost
roughly half of Ink; mixed selections fall between. The 1 000-object run #1 figures
(18.1 s preview, 37.1 s commit) confirm the trend continues.

## 13. Save and Open

Representative fixture: 500 strokes at 64 samples, encoding to 38.19 MB.

| Metric | Run #1 | Run #2 |
| --- | --- | --- |
| Save, acknowledged | 1 097 ms | 1 103 ms |
| Save, IPC write of pre-encoded content | 147 ms | 142 ms |
| Open, read + decode + activate | 1 333 ms | 1 348 ms |

Both repeated within 1.2%. The decomposition is the useful part: **encode accounts for
about 961 ms, 87% of Save**. Filesystem work is not the bottleneck — the storage stages
measure a complete atomic write of the 500-stroke payload at 73 ms, and a bounded read at
102 ms.

Save and Open are explicit, infrequent, user-initiated actions with obvious progress
semantics. Roughly one second for a 38 MB project is acceptable for V1, though it sits
close to the point where it needs a progress affordance rather than a frozen window.

## 14. Recovery

| Metric | Run #1 | Run #2 |
| --- | --- | --- |
| capture + encode + IPC store | 1 281 ms | 1 181 ms |
| IPC store of pre-encoded content | 231 ms | 231 ms |
| rAF interval during store, p50 | 8.4 ms | 8.3 ms |
| rAF interval during store, **max** | **1 343.6 ms** | **984.9 ms** |

Recovery throughput and foreground responsiveness must be read separately. Throughput is
fine for a background autosave. Foreground responsiveness is not: the median frame interval
during a store is a healthy 8.3 ms, but a single frame gap approaching one second occurs in
both runs. Roughly 950 ms of that, 80% of recovery cost, is the same synchronous encode
that dominates Save.

Because recovery autosave is scheduled automatically rather than requested by the user, a
one-second stall lands without warning while someone is drawing. This reproduced in both
runs and is a genuine release-quality concern.

## 15. Memory

The run #1 observation reproduced, and more cleanly, because run #2 measured retention in an
isolated process rather than after a full sweep.

After replacing a 10 000-stroke project with an empty project and forcing collection, heap
fell from 625.1 MB to 623.7 MB — the large project's memory was not released. Six further
replacement cycles with small projects grew heap monotonically from 629.2 MB to 645.7 MB,
with no release after an explicit collection and a console-entry discard.

CDP `queryObjects` against the `ProjectSession` prototype found **12 reachable instances**
after collection, one of which still held 10 000 objects. Run #1 found 59 reachable
instances in the same shape.

Classification: **repeated retention signal**. It is not yet a confirmed production leak.
The measured runtime is the Vite development harness under React StrictMode, and dev-only
module registries, StrictMode double-invocation, and inspector bookkeeping are all plausible
contributors that this measurement cannot separate from real ownership bugs. A dedicated
ownership investigation is required, in a production build, before release.

## 16. Soak summary

From run #1, 120 iterations in 11.75 s against a 320-object, 10-page project. History depth
rose to the bound of 99 and stayed there, which is the intended bounded-stack behaviour. No
unbounded growth was observed in the soak itself.

## 17. Startup and filesystem summary

Production launch to editor surface plus two rAF, measured against a packaged main process
rather than the dev harness: p50 1 216 ms, p95 1 260 ms, cold start 1 979 ms.

Filesystem stages, run #1:

| Payload | Atomic write total | Bounded read |
| --- | --- | --- |
| 100 strokes | 17.2 ms | 18.8 ms |
| 500 strokes | 73.4 ms | 101.8 ms |
| 1 000 strokes | 132.1 ms | 214.2 ms |

Disk cost scales linearly with payload and is a small fraction of Save and Open.

## 18. Stable and unstable metrics

**Stable and trustworthy.** All live input metrics; dense navigation; Save; Open; recovery
throughput; geometry at 5 000 and 20 000 samples. These repeated within 8%, most within 3%,
with sample counts in the hundreds or thousands.

**Directionally trustworthy, magnitude approximate.** Selection at 100 objects, which
repeated with a consistent 17-29% systematic offset attributable to execution history. The
conclusion — style editing at 100 objects is far outside interactive latency — is unaffected.

**Not established.** Selection at 500 and 1 000 objects records one sample per metric.
Order of magnitude is clear; distribution is not. Sub-millisecond metrics
(`marquee-hit-test`, `selection-creation`, small `finalize` cases) sit at timer resolution
and should not be tracked as percentages.

## 19. Provisional budgets

These are initial proposals from one machine with a software GPU path. They are not CI
thresholds and must be revalidated on hardware-accelerated and lower-end machines.

| Category | Target | Warning | Unacceptable | Current |
| --- | --- | --- | --- | --- |
| Live callback work, short stroke | <= 4 ms | 4-8 ms | > 8 ms | 1.0-2.4 ms — target |
| Software input-to-callback-end, short stroke | <= 12 ms | 12-20 ms | > 33 ms | 9.0 ms p95 — target |
| Long-stroke callback work, >= 5 000 samples | <= 16.67 ms | 16.67-33 ms | > 33 ms | centerline 7.4 ms target; outline 32.3 ms warning |
| Dense navigation, 5 000-10 000 objects | <= 33 ms | 33-100 ms | > 100 ms | 255-505 ms — unacceptable |
| Selection style preview, 100 objects | <= 16.67 ms | 16.67-50 ms | > 50 ms | 196 ms — unacceptable |
| Save, representative 38 MB project | <= 500 ms | 500-1 500 ms | > 3 000 ms | 1 103 ms — warning |
| Open, representative 38 MB project | <= 750 ms | 750-2 000 ms | > 3 000 ms | 1 348 ms — warning |
| Recovery foreground stall | <= 16.67 ms | 16.67-100 ms | > 250 ms | ~985-1 344 ms — unacceptable |

## 20. Bottleneck classification

| Issue | Classification |
| --- | --- |
| Short-stroke live drawing | Healthy; no action |
| Outline geometry per-sample constant factor | Should fix during Brush Engine work |
| Dense-page navigation at 5 000-10 000 objects | Must fix before desktop 1.0 |
| Selection style editing at 100+ objects | Must fix before desktop 1.0 |
| Synchronous encode blocking the main thread | Must fix before desktop 1.0 |
| Recovery foreground stall (same root cause) | Must fix before desktop 1.0 |
| Project retention after replacement | Must fix before desktop 1.0; investigate first |
| Save and Open wall-clock duration | Can defer; add progress affordance |
| Startup ~1.2 s warm, ~2.0 s cold | Can defer |

The distinction that matters: nothing on that list except outline geometry is about brush
rendering architecture. Dense navigation, selection editing, encode, and retention are
editor-scale and release-scale problems that exist independently of what the brush pipeline
does.

## 21. Brush Engine readiness

Technical Pen work can begin. The evidence is specific rather than general:

- Short-stroke live input is healthy and highly repeatable, with callback work of 1.0-2.4 ms
  inside an 8.33 ms frame, and zero missed frames across nearly 200 measured frames per run.
- Live scheduling is now measured under verified native foreground conditions, so future
  brush work has a trustworthy comparison point.
- Geometry cost is linear in sample count, so a richer brush pipeline will not encounter a
  complexity cliff; it will pay a predictable per-sample price.

Two constraints should shape the work rather than block it. Outline geometry already costs
about 1.8x centerline per sample and misses frames from 5 000 samples upward, so a strategy
that adds per-sample work needs a cost budget from the start. And measurements come from a
software GPU path, so any conclusion about GPU-accelerated brush rendering is unproven here.

Nothing in this baseline must be optimized before starting Technical Pen.

## 22. Known limitations

1. One machine, one display, one GPU configuration. Nothing here establishes behaviour on
   other hardware, and the software GPU path is not representative of typical users.
2. The renderer measured is the Vite development harness under React StrictMode. Production
   builds will differ, most likely favourably. Only startup was measured against a packaged
   build.
3. The exact cause of the historical one-second rAF cadence was never reconstructed.
4. Live measurements exclude presentation, scanout, and pen hardware latency. They are a
   software floor, not pen-to-photon latency.
5. Selection at 500 and 1 000 objects rests on single samples.
6. Run-to-run execution history measurably shifts results by up to about 29% in the
   selection family; runs are comparable in direction and order of magnitude, not to the
   percent.
7. `p99` is undefined for workloads with fewer than 100 samples.
8. The memory observation cannot separate development-runtime retention from real ownership
   bugs, and does not identify a retaining path.
9. No CPU frequency or thermal state was sampled during any run.
