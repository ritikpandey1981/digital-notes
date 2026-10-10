# The long Pencil task was not Pencil's

This phase went looking for allocation pressure in broad Pencil and found something else.
[`pencil-e4-2.md`](pencil-e4-2.md) recorded a single ~230 ms main-thread block, only at 26
page units, once per run, that no profiler reproduced and that attributed entirely to
`(program)`. Those signatures were read as a major garbage collection. **They were not.**

Reproduce with `FOLIO_PENCIL_ALLOCATION=1` (artifacts in
`test-results/pencil-allocation-e43b/`) and `FOLIO_PENCIL_LONGTASK=1`. The corrected mounted
measurement is `FOLIO_PENCIL_PERFORMANCE=1`, artifact
`test-results/pencil-material-e42b/mounted.json`. Same machine as every Pencil note: AMD
Ryzen 7 6800H, Windows 10.0.26200, 120 Hz, so **8.3 ms is the frame period**. Window verified
visible, focused and not minimized; background throttling left enabled; no CPU throttling and
no frame-rate flags.

## Two corrections, and the second is the first's cause

**The brush width was never set.** Every mounted workload called a
`window.__folioDrawingActions.setSize` hook that **does not exist in the application** — in
the source or in the built renderer. It was optional-chained, so every call was a silent
no-op. The "12 px" and "26 px" runs were both drawn at the preset's own **2 page units**, and
what actually differed between them was how much was already on the page. The size slider is
real and runs 0.5 to 40, so the fixture was always reachable; it was simply never driven. The
specs now drive it and read the value back.

**And the block is not in the stroke.** With the post-stroke settle raised past three
seconds, every block moves out of the stroke entirely and lands at a fixed offset from the
previous pointer-up:

| document | pointer-up | block began | offset | block |
| --- | --- | --- | --- | --- |
| 2 strokes | 41 993 ms | 44 977 ms | **+2 984 ms** | 205 ms |
| 3 strokes | 41 936 ms | 44 916 ms | **+2 980 ms** | 417 ms |
| 4 strokes | 42 007 ms | 44 990 ms | **+2 983 ms** | 593 ms |
| 5 strokes | 42 024 ms | 45 007 ms | **+2 983 ms** | 776 ms |
| 6 strokes | 42 372 ms | 45 353 ms | **+2 981 ms** | 1 330 ms |
| 7 strokes | 41 948 ms | 44 936 ms | **+2 988 ms** | 1 620 ms |

Six for six at 2.98 seconds. `RECOVERY_DEBOUNCE_MS` is **3 000**, and it is the only
three-second timer in the application. With the old 1500 ms settle the capture landed about a
second into the *next* workload's stroke, which is where it was read as that stroke's long
task.

## What it is

The recovery capture: `encodeFolioProject` over the whole document, then the write. Three
independent lines of evidence agree.

**It scales with samples in the document, not with brush width.** The 1 620 ms case is a
12 page-unit stroke and the 417 ms case is 26; what separates them is six strokes against
three. Measured directly on the codec, with 5 000-sample strokes:

| strokes | samples | `encodeFolioProject` | per sample | JSON |
| --- | --- | --- | --- | --- |
| 1 | 5 000 | 241 ms | 0.048 ms | 5.6 MB |
| 2 | 10 000 | 466 ms | 0.047 ms | 11.2 MB |
| 4 | 20 000 | 1 222 ms | 0.061 ms | 22.4 MB |
| 7 | 35 000 | 2 309 ms | 0.066 ms | 39.1 MB |

Linear in samples at 0.05–0.07 ms each, which is the shape and the magnitude of the measured
blocks.

**Its stack is persistence.** A CPU profile of a quiet seven-second window after pointer-up
is 6.7 s idle and contains exactly one long task. Resolved through the renderer's source map,
every JavaScript frame in it belongs to the codec:
`packages/persistence/src/project/project-validation.ts`,
`packages/persistence/src/json.ts`, `packages/persistence/src/project/ink-codec.ts`. **No
Pencil frame appears in it at all.**

**And more than half of it is not JavaScript.** 160 ms of a 273 ms block samples as `(idle)`
to V8 — the thread is in C++, which is the encode's write path. That is also why the earlier
CPU profile saw `(program)` and no JavaScript frame: it was looking inside the stroke, where
the block is not.

### Where that time goes, for whoever picks it up

Self time in the quiet window, resolved through the source map. Recorded here because it is
already measured and it names a starting point; it is not this phase's work.

| Frame | Self | What it does |
| --- | --- | --- |
| `assertJsonTextDepth`, `project-validation.ts:337` | 62.7 ms | walks **every character** of the encoded text |
| `stableStringify`, `json.ts:5` | 49.5 ms | `JSON.stringify` with two-space indent |
| `sortJsonValue`, `json.ts:38` | 38.8 ms | rebuilds every object with sorted keys, allocating per node |
| `assertExactKeys` and neighbours, `project-validation.ts:95` | 34.8 ms | per-record key checks |
| `TextEncoder.encode` (native) | 32.2 ms | — |
| `ink-codec.ts:242` | 11.8 ms | the stroke codec itself |
| `(garbage collector)` | 34.6 ms | across the whole seven-second window |

The stroke codec is the smallest item. The cost is in validating and canonicalising the text
once it exists — a character-by-character depth scan over 39 MB, and a key sort that
allocates a fresh object for every point in the document.

## Pencil's own drawing cost, on the fixture the brief asked for

Corrected mounted run, real widths, settle past the capture:

| Workload | Median gap | p95 gap | Longest in-stroke gap | Pencil long tasks |
| --- | --- | --- | --- | --- |
| Ordinary, 220 samples, 2 pu | 8.3 ms | 8.6 ms | 101 ms (first frame of the session) | 0 |
| 5 000 samples, 12 pu | 8.3 ms | 8.5 ms | 35 ms (the handover frame) | 0 |
| 5 000 samples, 26 pu | 8.3 ms | 8.5 ms | 37 ms (the handover frame) | 0 |
| Hot repaint | 8.4 ms | 8.7 ms | 9 ms | 0 |
| Undo then Redo | 8.4 ms | 9.0 ms | 10 ms | 0 |

Across a 42-second, 5 000-sample, 26 page-unit stroke — 5 700 frames — **exactly two frame
intervals exceed one display period.** One is the final frame before pointer-up, 35–46 ms,
which is the whole mark being painted in the frame it is handed over (D-040), deliberately
bought to remove the flicker. The other is the recovery capture, three seconds after the
stroke ended. There is **no long task during drawing at any width.**

## Allocation, measured rather than assumed

V8's sampling heap profiler at a 4 096-byte interval, across a whole 42-second 26 page-unit
stroke:

| | |
| --- | --- |
| Sampled allocation, whole stroke | **2.1 MB** |
| Rate | ~50 KB/s |
| JS heap growth over the stroke | 2.4–3.1 MB |
| JS heap after a full collection | 7.9 MB at one stroke, 19.0 MB at seven |
| Idle editor | 6.2 MB |

The two dominant sources are both **one per stroke**, in `Stroke.finalize`:

| Source | Bytes | Category |
| --- | --- | --- |
| `freezePoint`, `packages/ink/src/stroke.ts:17` | 1 084 KB | one per stroke |
| `freezeSourceSample`, `packages/ink/src/stroke.ts:119` | 644 KB | one per stroke |
| `stampFromDab`, `pencil-material-strategy.ts:60` | 48 KB | one per dab |
| everything else, each | under 50 KB | — |

Together the first two are 82% of everything sampled, and they are the durable artwork being
frozen once when the mark is finished, in the `Stroke` constructor: two objects per kept
point (the point and its `delta`) and one per source sample, so about fifteen thousand for a
5 000-sample stroke. That is what a `Stroke` is.

Everything below `stampFromDab` sits at the sampling floor — one sample, 4 KB — including
every per-frame collection: `Set`, `Map.add`, `Map.delete` and `Array.slice` together account
for under 100 KB across 5 700 frames, which is about seventeen bytes a frame. The 120 KB
attributed to `tick` is this file's own frame probe growing its arrays, and is measurement
overhead rather than Pencil's.

**Nothing per-frame registers at all.** A 4 KB sampling interval across 5 700 frames found no
per-frame site above the noise floor. Typed arrays are not on the JS heap, so they are
accounted separately, from the runtime's own numbers:

| Per new tile a broad stroke reaches | Bytes |
| --- | --- |
| Active tile (`alpha`, `base`, `peak`, `last`) | 114 688 |
| Field tile (`tooth`, `clump`, two row spans) | 33 280 |
| Presentation (130² RGBA) | 67 600 |
| Committed alpha, after the active tile is dropped | 16 384 |

A 26 page-unit stroke reaches 36–38 new tiles, so about **9 MB over 42 seconds — 0.2 MB/s**,
peak resident 18.5 MB of material against a 64 MiB cap, 13 field tiles against a 64-tile
limit. That is not a quantity of garbage that forces a major collection, and no major
collection was observed: the profile's `(garbage collector)` time across a seven-second
window is 35 ms.

## Verdict

- **The isolated long task is the recovery capture, not Pencil.** It fires three seconds
  after the last committed edit, costs 0.05–0.07 ms per sample in the document, and would
  behave identically with any brush.
- **Pencil's drawing path has no allocation problem to fix.** 0.2 MB/s, bounded resident
  memory, no long task at any width, median at the display period.
- **No Pencil optimization was made**, because the measurement did not support one. See
  [D-045](../DECISIONS.md).
- **It is still a real hitch, and it is persistence's.** Two consequences worth stating: a
  capture that lands while the artist has started a new mark blocks that mark, and
  `RECOVERY_MAXIMUM_AGE_MS` is 30 000, so a continuous stroke longer than thirty seconds is
  interrupted by one on purpose. A 5 000-sample stroke encodes to 5.6 MB of JSON, which is
  where the cost is.
