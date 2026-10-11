# Recovery waits for the hand

Recovery R1 is a scheduling phase. The encode is unchanged — the same six passes over the
same bytes, costing the same ~26 ms per megabyte of record — and what changed is when it is
allowed to begin. [`pencil-e4-3.md`](pencil-e4-3.md) identified the block; this records what
was done about it and what it cost.

Same machine as every note in this directory: AMD Ryzen 7 6800H, Windows 10.0.26200, 120 Hz,
so **8.3 ms is the frame period**. Windows verified visible, focused and not minimized;
background throttling left enabled; no CPU throttling and no frame-rate flags.

## What was wrong, precisely

Nothing was ignoring anything. The capture path asked `isPersistenceSettled` and got a
truthful yes: a live mark is not in the document, so the committed project really was safe to
serialize while it was being drawn. The question nobody was asking was whether *now* was a
good moment to spend several hundred milliseconds producing those bytes.

The failure needs no unusual input. Finish a mark, which arms the three-second debounce.
Begin the next one inside three seconds, which is ordinary sketching. The capture for the
first lands inside the second.

| project | record | renderer block |
| --- | --- | --- |
| 2 strokes | 4.19 MB | 147 ms |
| 3 strokes | 8.37 MB | 278 ms |
| 5 strokes | 20.92 MB | 566 ms |
| 6 strokes | 22.31 MB | 641 ms |
| 7 strokes | 26.50 MB | 692 ms |

Linear, about **26 ms per megabyte of record**, and brush-independent: 5.57 MB cost 303 ms
with Pencil, 290 ms with Pressure Pen and 292 ms with Technical Pen. The heartbeat stall and
the `longtask` entry agree to within 3 ms in every case, so the whole block is renderer-side;
the record lands 23–100 ms later, which is the IPC and the write, and neither is on the
drawing thread.

## The signal

A press on the editor surface is now tracked on its own, by pointer id, separately from
settlement, from `transientEditDepth`, from `pendingCommitDepth` and from anything about
document content. It counts presses rather than gestures, because a gesture is a tool's own
idea and a press is not: whichever tool is active, and whether the press produces artwork, a
selection, a pan or nothing at all, a long task would land in the middle of it.

Three details earn their keep.

**Reported before routing.** The press is recorded at the top of the canvas pointer listener,
before the artwork sampler, the viewport pan and the tool registry can consume it. One press
counts exactly once however it is then handled.

**Released on the window, after the handling.** A tool that consumes its own release stops the
event before it could bubble back out, and the canvas sees a release only while it still holds
pointer capture — so the release is observed in front of everything, on the window in the
capture phase. The report itself is deferred to a microtask, because a mark commits during
that same event: a scheduler told the hand is free before the commit exists would decide about
the previous document and act on it inside the lift.

**Abandoned when the release will never come.** Window blur and loss of input ownership both
clear it. A signal stuck on would mean recovery never ran again, which is a worse failure than
the one being fixed.

## Why the ordinary paths were never going to change

**A burst of quick marks was already deferred, by the debounce.** Eight marks in 10.3 s
produced **one** capture, because every commit re-arms the three-second debounce. Deferring
during the marks themselves adds nothing to that.

**The age limit cannot fire inside a mark.** `pendingSince` is set by the arrival of a
*committed* change, and a mark in progress commits nothing, so no deadline is outstanding for
it to pass. Measured on a **75.4-second** continuous stroke: no capture and no block inside it
at all. The limit now explicitly means *capture at the first safe moment* rather than *capture
immediately*, and during continuous input there is no newer committed content for that
distinction to lose.

## Measured before and after, on the fixture that produced the finding

The audit's own harness was re-run with the gate in place
(`FOLIO_RECOVERY_RESPONSIVENESS=1 FOLIO_RECOVERY_LABEL=after`, artifact `after.json` beside
the original `foreground.json`). Same four scenarios, same brush, same timings; the gate is
the only difference.

**The collision is gone.**

| collision scenario | before | after |
| --- | --- | --- |
| long task inside the second stroke | **147 ms**, 1.76 s into it | **none** |
| largest block inside the second stroke | 150 ms | 26.6 ms, which is the stroke's own handover frame just before pointer-up |
| when the capture of the first mark ran | 28 263 ms — inside the second stroke | 54 631 ms — after it ended |
| when its record landed | 28 433 ms | 54 950 ms |
| frame median / p95 | 8.3 / 8.6 ms | 8.3 / 8.6 ms |

**And the three paths that were already fine are unchanged.**

| scenario | before | after |
| --- | --- | --- |
| 75.4 s continuous stroke | no long task inside it; capture 3.63 s after pointer-up | no long task inside it; capture 3.68 s after pointer-up |
| 8 marks in 10.3 s | no long task inside the burst; one capture 3.46 s after the last | no long task inside the burst; one capture 3.43 s after the last |
| single mark, then quiet | block at + 2.99 s, 692 ms; durable at + 3.78 s | block at + 2.99 s, 711 ms; durable at + 3.80 s |

The burst scenario records eight per-mark commit stalls after the change and five before, which
is not a regression: there are eight marks, the stalls are 16.8–19.5 ms, and three of them sat
just under the 16.67 ms recording threshold in the earlier run. The largest is **lower** after
the change (19.5 ms against 22.1 ms), and neither run has a long task inside the burst.

## What deferral actually costs

The audit predicted no measurable freshness loss, and for the three ordinary paths above that
is what the measurement shows — within noise, in both directions. But the collision row is a
real cost and it should be read plainly.

Before the change, the first mark's snapshot was on disk **3.1 s** after it was drawn. After
the change it is on disk **29.6 s** after it was drawn, because the artist spent 25 s on the
next mark and the capture waited for them to finish. A crash in the middle of that second
stroke now loses the first mark, where previously it would not have.

So the trade is stated rather than hidden: **up to the duration of one interaction, plus the
settle, of extra exposure — in exchange for never blocking the drawing.** That is the bound,
and it is a bound: the age limit cannot shorten it, because nothing is committed during an
interaction for the age limit to be measuring. The alternative is the measured 147–692 ms of
dead renderer in the middle of a mark, which is the thing the artist actually experiences.
Both halves of that sentence are the reason the phase exists; neither is free.

The 250 ms settle is not a guess at human timing. It is there so the encode cannot land in the
task that ended the interaction: finishing a mark commits it, hands it to the compositor and
flushes a render inside that same release, which is 18–43 ms of work the encode must not join.

| path | before | after |
| --- | --- | --- |
| ordinary single mark, then quiet | durable at pointer-up + 3.78 s | + 3.80 s |
| burst of marks | one capture, 3.46 s after the last | 3.43 s after the last |
| capture due during a mark that commits | **inside the mark**, 147–692 ms | the new mark's own debounce |
| capture due during a press that commits nothing | inside the press, by the same mechanism | release + 250 ms |

Only the third row was reproduced as a mounted failure. The fourth follows from the same
mechanism — before the gate, a due capture ran whenever its timer fired, and a press that
commits nothing arms no new debounce to postpone it — but a pan or a cancelled stroke was not
separately measured, and it is listed as reasoning rather than as a measurement.

## What it does not do

**The encoder is not preemptible.** A press that arrives while an encode is already running is
still blocked by it, for as long as that encode takes. This phase decides when to start and
declines to start at a bad time; it cannot stop something it has already begun. The exposure
is one encode's worth, after a press that committed nothing, in the 250 ms window before the
next press is noticed.

**The idle block is unchanged.** A capture at rest still costs 147–692 ms on the record sizes
above. Nobody is drawing when it happens, which is the entire point of the phase, but the work
is the same work. The codec is where that goes next: a duplicated serializability guard, a
depth scan that answers on the object graph for 22 ms what it currently answers on the text
for 95, and a sort that disappears if the codec emits sorted keys — together about **47%**,
with no concurrency at all. Off-main-thread encoding was priced and rejected for now: the
cheapest payload to transfer is a string, and the string only exists after the work worth
moving.

## What was priced and rejected, with the numbers

Off-main-thread encoding keeps being the obvious idea, so the audit that
preceded this phase priced every boundary that preserves the codec's contract
rather than arguing about it. The harness that produced these has since been
retired -- it measured two passes the codec no longer makes -- so the figures
live here. At 39 MB, on the machine above:

| boundary | renderer pays | worker pays | why it fails |
| --- | --- | --- | --- |
| clone the live project | 534 ms | — | `structuredClone` drops prototypes, so the codec refuses the result: no `SketchbookDocument` survives the trip |
| clone the finished JSON tree | 370 ms clone + 192 ms `postMessage` | 837 ms | the renderer still builds the tree, then pays the clone synchronously on its own thread |
| transfer the finished text | 9 ms | 400 ms | the cheapest payload there is, and it only exists *after* the work worth moving |
| transfer sample columns as typed arrays | 11 ms read + 1 ms transfer | — | the only boundary cheap in both directions, and a change to what a capture *is* rather than to when it runs |

That is the shape of the whole result: **the cheapest payload to move is a
string, and the string only exists after the work you wanted to move.** The one
genuinely cheap boundary is a different capture representation, not a scheduling
change, and it is not this phase or the two after it.

`JSON.stringify` is also atomic. The depth scan and the key sort both chunk
exactly, byte-identically; `stringify` does not, so cooperative chunking cannot
reach a frame budget either.

And the cost is a function of sample count rather than of which brush drew them.
Three strokes of 5000 samples, same payload within 34 bytes: `pencil@1`
302.8 ms, `pressure-pen@1` 290.0 ms, `technical-pen@1` 291.8 ms. A strategy
added later inherits this cost per sample and adds nothing of its own to it.

## Regressions

`tests/e2e/electron-recovery-input-deferral.spec.ts`, three mounted tests, each on its own
`--user-data-dir`:

- a mark begun before a capture was due and drawn straight through it,
- five quick marks spaced under the debounce,
- one mark drawn for 34 seconds, past the age limit, after leaving a capture owed.

Each asserts two independent things: that no recovery record was written while the pointer was
down, which names recovery specifically, and that no renderer block of capture size (≥120 ms,
above the 18–43 ms a mark costs to finish and below anything a capture has been seen to do)
occurred in that window. Each then asserts that recovery catches up to the **newest** state
afterwards, not to the one it was originally waiting on. Two of the three fail without the
gate; the burst test passes either way, because coalescing already worked and is being
guarded rather than fixed.
