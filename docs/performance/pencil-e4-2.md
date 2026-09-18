# Hybrid Pencil in the mounted editor

This records what the hybrid material costs once a real compositor, a real React tree and a
real input path are in front of it. [`desktop-baseline.md`](desktop-baseline.md) remains the
reference for the machine, the method and the limits on what any of these numbers can
support; [`pencil-e4.md`](pencil-e4.md) and [`pencil-e4-1.md`](pencil-e4-1.md) record the
geometry model this replaced.

Reproduce with `FOLIO_PENCIL_PERFORMANCE=1` and the Pencil performance spec in
`tests/e2e`. The artifact is `test-results/pencil-material-e42b/mounted.json`.

## What is measured, and what is not

The main thread, from inside the page: the gaps between animation frames while a stroke is
being drawn, and the length of the reconstruction slices. A frame gap is **main-thread
scheduling**. It is not pen-to-screen latency, and nothing here is offered as latency: the
compositor, the GPU and the display are all downstream of it, and none of them is
instrumented.

The window was verified visible, focused and not minimized before measuring. Background
throttling was left enabled and nothing was run in parallel. One run, one machine: AMD Ryzen
7 6800H, Windows 10.0.26200, 120 Hz display — so **8.3 ms is the frame period**, and a median
gap at that number means the editor kept up.

## Drawing

| Workload | Frames | Median gap | p95 gap | Longest gap |
| --- | --- | --- | --- | --- |
| Ordinary stroke, 220 samples | 248 | 8.4 ms | 8.7 ms | 75.7 ms |
| Dense stroke, 5 000 samples, 12 px | 5 021 | 8.4 ms | 8.6 ms | 30.6 ms |
| Dense stroke, 5 000 samples, 26 px | 5 022 | 8.3 ms | 8.6 ms | 212.1 ms |

**Drawing holds the frame rate.** Every workload sits at the display's own period at the
median and at the 95th percentile, including five thousand samples at twenty-six page units
— which is the workload the prototype rated hardest. That is the local repaint doing its
job: a frame costs the tail, so a long stroke does not get more expensive the longer it
gets.

The ordinary run's 75.7 ms is the first frame of the session, before anything was drawn.

## The one real hitch, and what it is

The 26 px run's **212 ms** outlier is a single frame, and it is not the material. It is the
moment a finished stroke is first painted by the page compositor: every tile it occupies
needs a presentation canvas built for it — an image upload and a tint per 128-square — and a
seventy-tile stroke builds seventy of them in one frame.

It is a genuine one-off. The same stroke repainted afterwards is hot: the hot-repaint
workload reconstructed nothing, ran no slices, and its longest frame was 9.6 ms.

**This is worth fixing and is not fixed here.** Building a tile's presentation is exactly
the kind of work the scheduler already knows how to slice, and it should be sliced the same
way reconstruction is. It is recorded as E4.2C rather than smuggled into this phase.

## Cache behaviour

| Workload | Reconstructed tiles | Slices | Longest slice |
| --- | --- | --- | --- |
| Hot repaint | 0 | 0 | — |
| Undo then Redo, three strokes | 0 | 0 | 0.6 ms |

Both are zero because both were meant to be. Material a stroke deposits is adopted straight
from the live accumulator at commit, so a freshly drawn mark is never rebuilt; and Undo and
Redo restore the same immutable `Stroke`, which the cache is keyed by, so the material is
still there.

Final state after three strokes: 72 resident tiles, 4.26 MiB of material, 175 KiB of index,
69 hits against 1 miss, no evictions, one scheduler slice of 0.6 ms.

**Cold reconstruction is therefore barely exercised by this run**, which is a property of the
scenario rather than a result. It is measured instead where it can be controlled: the runtime
suite drives cold, warm and hot paths directly and checks the bytes, and the material E2E
spec draws, churns the cache through a page switch and compares the repainted pixels.

## Memory

Budgets are 64 MiB material and 16 MiB index, held separately and hard-capped. This
scenario never came near either — 4.26 MiB and 175 KiB — so what the run demonstrates is
the accounting rather than the cap. The cap itself is exercised in the runtime suite, which
drives it to eviction with a deliberately tiny budget and checks that the bound holds and
that offscreen material goes first.

Typed-array ownership is what is accounted. This is not a process RSS measurement and is
not offered as one.

## Verdict

- **Canvas 2D is sufficient.** Nothing measured here needs a GPU backend, and the one
  expensive frame is a canvas-upload burst that slicing will remove rather than a throughput
  wall.
- **Ordinary drawing is comfortably interactive**, at the display's own frame period.
- **5 000 samples at 12 px is interactive**, p95 8.6 ms against a 16.67 ms budget.
- **5 000 samples at 26 px is viable**, with the same p95 and one commit-time hitch that has
  a known cause and a known fix.
