# Hybrid Pencil in the mounted editor

This records what the hybrid material costs once a real compositor, a real React tree and a
real input path are in front of it. [`desktop-baseline.md`](desktop-baseline.md) remains the
reference for the machine, the method and the limits on what any of these numbers can
support; [`pencil-e4.md`](pencil-e4.md) and [`pencil-e4-1.md`](pencil-e4-1.md) record the
geometry model this replaced.

Reproduce with `FOLIO_PENCIL_PERFORMANCE=1` and the Pencil performance spec in
`tests/e2e`. The artifact is `test-results/pencil-material-e42b/mounted.json`.

## A correction

The first version of this note attributed a ~212 ms frame to presentation-tile creation:
roughly seventy tiles each building a canvas in the frame that first painted a committed
stroke. **That diagnosis was wrong, and it was reasoning rather than measurement.**

Instrumenting the path settled it three ways:

- A whole 26 px workload builds **25 presentations totalling under 5 ms**, longest 0.6 ms.
  It never built seventy of anything in one frame.
- The long frame occurs **~1.43 s into drawing**, with pointer-up at ~42 s. It is not a
  commit-time event at all.
- Building committed geometry — the one step proportional to the whole mark — is **1424
  dabs in 4.2 ms**, also not it.

What it actually is, is recorded below.

## What is measured, and what is not

Two different things, and the difference is the reason the first diagnosis stood as long as
it did:

- **Frame gap** is the interval between animation frames. rAF is driven by the compositor,
  so a gap can open because the GPU process is busy while the main thread sits idle.
- **Long task** is main-thread blocking, from `PerformanceObserver`. Only this means
  JavaScript held the thread.

Neither is pen-to-screen latency and neither is offered as it. The window was verified
visible, focused and not minimized; background throttling was left enabled; nothing ran in
parallel. Two runs on one machine: AMD Ryzen 7 6800H, Windows 10.0.26200, 120 Hz — so
**8.3 ms is the frame period**.

## Drawing

| Workload | Median gap | p95 gap | Longest gap | Long tasks | Longest task |
| --- | --- | --- | --- | --- | --- |
| Ordinary, 220 samples | 8.3 / 8.3 ms | 9.6 / 10.3 ms | 77 / 79 ms | 0 / 0 | — |
| 5 000 samples, 12 px | 8.4 / 8.4 ms | 9.3 / 9.5 ms | 35 / 34 ms | 0 / 0 | — |
| 5 000 samples, 26 px | 8.4 / 8.4 ms | 9.3 / 9.5 ms | 241 / 228 ms | 1 / 1 | 238 / 226 ms |
| Hot repaint | 8.4 / 8.3 ms | 13.9 / 14.6 ms | 17 / 16 ms | 0 / 0 | — |
| Undo then Redo | 8.3 / 8.4 ms | 13.6 / 9.8 ms | 17 / 17 ms | 0 / 0 | — |

Both runs, separated by `/`.

**Drawing holds the frame rate.** Every workload sits at the display's own period at the
median and within about a millisecond of it at the 95th percentile. Across five workloads
and two runs there is exactly **one** long task, and it is the same one each time.

The ordinary run's ~78 ms gap is the first frame of the session, before anything is drawn,
and carries no long task.

## The one long task

A single ~230 ms main-thread block, only at 26 px, once per run, about 1.4 s into the
stroke. What is known about it:

- It is real blocking: it registers as a long task, not only as a frame gap.
- It **does not reproduce under instrumentation.** Under a CPU profile the longest busy
  stretch is 118 ms attributed entirely to `(program)` — V8-internal, with no JavaScript
  frame under it. Under a devtools timeline trace of the identical workload it does not
  appear at all: the longest events are 25–39 ms GPU tasks.
- Its size scales with brush width, which is what scales allocation: a broad stroke reaches
  new tiles faster, and each new tile is an active tile, a field tile and a presentation —
  a few hundred kilobytes of fresh allocation apiece.

That set of signatures is a **major garbage collection**, not an algorithm. It is a
characteristic of the memory profile of a broad stroke rather than a defect with a line
number, and it is recorded here rather than explained away.

Two of the largest per-frame allocators were removed while looking for it, and neither was
the cause:

- A fresh `ImageData` per dirty tile per frame in the live tint path — 64 KiB at 120 frames
  a second. Now one shared buffer for the process.
- Provisional-tail backup buffers, which were sized to the rectangle they held and so were
  repeatedly found too small, discarded and replaced. Now allocated at full tile capacity,
  so the pool settles after a few frames.

Both are worth keeping on their own terms. Neither moved the long task, which is the honest
result and the reason this section says what it says.

## Presentation

| | |
| --- | --- |
| Cost of one presentation | ~0.26 ms |
| Built during a whole 26 px workload | 25, about 4.5 ms total |
| Built inline per frame, at most | 8, or the whole of a stroke being handed over |
| Beyond that | requested and scheduled |

A presentation carries one cell of each neighbour so that a magnified tile has a true edge
rather than a clamped one, which costs **about 18% more to build** — 0.26 ms against 0.22 —
and 3.1% more to hold. Frame times did not move: medians stayed at the display's own 8.3 ms
across every workload and the 95th percentile at 8.5 to 8.7 ms, with no new long tasks.

The inline limit is the measurement applied: eight is under two milliseconds and more than
an ordinary stroke occupies, so an ordinary mark is never sent through a task hop to save
nothing. Past it a cold viewport of a large project — hundreds of tiles at once, which is
tens of milliseconds — hands the rest to the scheduler and fills in progressively.

## Cache behaviour

| Workload | Reconstructed | Slices |
| --- | --- | --- |
| Hot repaint | 0 | 0 |
| Undo then Redo, three strokes | 0 | 0 |

Both are zero because both are meant to be. Material a stroke deposits is adopted from the
live accumulator at commit, and Undo and Redo restore the same immutable `Stroke`, which
the cache is keyed by.

**Cold reconstruction is therefore barely exercised by this run**, which is a property of
the scenario and not a result. It is measured where it can be controlled: the runtime and
presentation suites drive cold, warm and hot paths directly and check the bytes.

## Memory

Budgets are 64 MiB material and 16 MiB index, held separately and hard-capped, with
presentation backing charged to the material budget — a displayed tile is 82 KiB, not 16,
and a budget that counted only the alpha would be wrong by a factor of five. This scenario
never came near either cap, so what it demonstrates is the accounting; the cap itself is
exercised in the unit suites with a deliberately tiny budget.

The gutter moved a resident displayed tile from 81,920 bytes to **83,984**, measured: 72
tiles held 6,046,848 bytes against 5,898,240 before. That is 2.5%, and it buys about twenty
fewer tiles at the 64 MiB cap — 799 rather than 819.

Typed-array ownership is what is accounted. This is not a process RSS measurement.

## Verdict

- **Canvas 2D is sufficient.** Nothing measured here needs a GPU backend.
- **Ordinary drawing, and 5 000 samples at 12 px, are comfortably interactive** with no
  long tasks at all.
- **5 000 samples at 26 px is interactive** at the median and the 95th percentile, with one
  collection pause per run that instrumentation cannot reproduce.
