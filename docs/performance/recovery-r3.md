# The codec stops decoding what it just encoded

[`recovery-r2.md`](recovery-r2.md) ended by naming what was left: the encoder
validating output it had just built. `encodeStroke` assembled a stroke from
already-validated model fields and then ran the whole decode-side `parseStroke`
over the result. At 39 MB that was roughly 728 ms of 1332 ms — more than
`JSON.stringify` — and it was left alone deliberately, because removing it
needed a proof rather than a hunch.

R3 is that proof, and the answer was not the one the plan assumed. The bytes are
identical, `formatVersion` is still 1, and the decoder has not changed at all.

Same machine as every note here: AMD Ryzen 7 6800H, Windows 10.0.26200, 120 Hz.

## What `parseStroke` was actually costing

The 728 ms was one number. Instrumented stage by stage, at 39 MB (70 000 points
and source samples), it was not what a reading of the code suggests:

| stage of the encoder's self-validation | cost | share |
| --- | --- | --- |
| per point: exact-key check | 167.0 ms | 20% |
| per point: rebuilding the record without `delta`/`velocity`/`acceleration` | 190.7 ms | 23% |
| per point: the sample's own key check and value checks | 177.5 ms | 21% |
| per point: `delta`, velocity, acceleration | 73.9 ms | 9% |
| per source sample: exact-key check | 139.1 ms | 16% |
| per source sample: value checks | 29.4 ms | 3% |
| **everything per stroke** — id, counts, ordering, style, brush, metrics, statistics | **1.5 ms** | **0.18%** |

Two facts decide the whole phase. **Over 99.8% of it was the two per-sample
loops**, so every per-stroke rule could be kept for free. And **the majority of
those loops was shape, not value**: the key-set checks and the record rebuild
come to 497 ms, against 280 ms for looking at the numbers — and the shape of
that object was this function's own doing a few microseconds earlier.

The allocation census says the same thing more plainly. One encode of the 39 MB
fixture, counted:

| | before | after |
| --- | --- | --- |
| `Set` allocations | 280 265 | **13** |
| `Object.fromEntries` rebuilds | 35 014 | **14** |
| `Set`s per sample | 4.00 | 0.0004 |

Four `Set`s per sample is not an accident of style: `assertExactKeys` builds two
of them per call, and parsing one processed point calls it three times — once
for the point, once for the rebuilt record it synthesises, once for `delta`.

## Who owns each rule

The audit's question was whether a valid in-memory `Stroke` can violate anything
serialization depends on. Taken literally the answer is **yes**, so the
preferred candidate — emit and trust — was not available. The `Stroke`
constructor checks remarkably little: a non-blank id, a finite timestamp, at
least one point, at least one source sample, and then it delegates style and
brush to their factories and *freezes the rest without looking at it*.

What makes production artwork valid is one level down, and it is worth naming
precisely because it is not the model:

| rule | who owns it |
| --- | --- |
| sample coordinates, timestamp, pressure, tilt, twist, buttons finite | `StrokeBuilder.validateInput`, per sample as it arrives |
| pressure within zero and one | `StrokeBuilder.validateInput` |
| timestamps non-decreasing | `StrokeBuilder.addPoint`, which refuses the sample that goes backwards |
| `points[].x`/`y` finite after smoothing | `StrokeSmoother`, which asserts its own output — including a hostile interpolation hook's |
| velocity non-negative, statistics within their own minima and maxima | `StrokeBuilder`, by deriving them |
| `statistics.pointCount` agreeing with `points.length` | **now the `Stroke` constructor** |
| colour, width, opacity; cap and join round | `createStrokeStyle`, which hard-codes the cap and join so nothing else is expressible |
| every brush field, and the strategy identity | `createResolvedBrushSnapshot`, which the constructor always runs |
| **sample counts, id and string lengths, the project's sample budget** | **the codec, and nothing else** |

That last row is why `parseStroke` could not simply be deleted. A stroke with a
513-character id is a perfectly good drawing; it is the *file* that has a
ceiling. Those rules are properties of the format, so the encoder owns them
outright, and a project Folio writes and then refuses to open is the failure
they exist to prevent.

One rule moved. `statistics.pointCount` disagreeing with the points it counts is
incoherent whatever anyone intends to do with it, so the constructor now refuses
it instead of leaving the serializer to notice. Every construction site already
satisfied it. Timestamp ordering was considered for the same treatment and left
where it is: the builder refuses it at the source, and a constructor scan would
charge every recolour of a 35 000-sample stroke for a rule nothing can break by
then.

## What replaced it

`assertEncodableStroke` walks the Stroke — not a transcription of it — once per
array, and allocates nothing in the happy path. Every rule `parseStroke`
enforces is still enforced, with the same error code, the same path and the same
message; what is gone is re-deriving which fields exist, and the intermediate
objects that re-derivation needed.

It reads the containers without shape guards, and that is a property of `Stroke`
rather than an assumption. The constructor rebuilds `points`, `sourceSamples`,
each `delta`, `metrics`, both bounds, `center`, `dirtyRect`, `statistics`,
`style` and `brush` through its own spreads and factories, so by the time an
instance exists every one of them is a plain object whose fields may be wrong but
whose absence cannot throw. There is a test for exactly that: a point built
without a `delta` comes out of the constructor with `delta` as `{}`, and the
encoder is what says so.

The decoder is untouched. It still re-parses everything, because it is the side
where a document nobody in this process wrote arrives.

## What it cost, measured

Totals are medians of nine encodes, and the figure below is the median of three
such runs, because a single median still moved by a third between runs. Both
states were measured with the same instrument in the same session: a harness
that imports nothing but `encodeFolioProject`, run against the pre-R3 files and
then against the post-R3 files, with the swap verified by byte size.

| fixture | payload | before | after | saved |
| --- | --- | --- | --- | --- |
| ordinary | 1.49 MB | 37.5 ms | 17.7 ms | **53%** |
| 1 × 5000 | 5.57 MB | 135.5 ms | 61.2 ms | **55%** |
| 2 × 5000 | 11.14 MB | 308.6 ms | 147.9 ms | **52%** |
| 3 × 5000 | 16.71 MB | 457.7 ms | 226.0 ms | **51%** |
| 5 × 5000 | 27.86 MB | 814.8 ms | 454.9 ms | **44%** |
| 7 × 5000 | 39.00 MB | 1163.1 ms | **598.4 ms** | **49%** |

The 39 MB class is now comfortably under the 750 ms this phase was asked for,
and at the bottom of the 600–700 ms band it preferred. Against the pre-R2
encoder the two phases compound to **about 70% less** encode time for identical
bytes: R2 took 41% off, R3 takes another 49% off what was left.

The baseline here reads lower than R2's own note recorded (1163 ms against
1332 ms) because machine state moves between sessions. That is the whole reason
both halves of the comparison were re-measured rather than quoted.

### Where the time goes now

At 39 MB, with every stage measured on the tree the codec actually built:

| stage | cost | share |
| --- | --- | --- |
| `JSON.stringify` | 317.0 ms | **56%** |
| the R2 walk: nesting and JSON-safety | 154.4 ms | 27% |
| `TextEncoder` byte count | 21.2 ms | 4% |
| building the tree, including proving every Stroke encodable | **15.1 ms** | **3%** |
| *(avoided)* whole-tree canonical rebuild | 387.9 ms | — |

The stage that was 56% of the encode is now 3% of it, and `JSON.stringify` —
which R2 correctly declined to attack while something larger sat untouched — is
now the largest thing left by a wide margin. The residual between the total and
the sum of the stages is about 49 ms and each stage is an independent median, so
the arithmetic no longer resolves the model's own cost precisely; at 5.57 MB the
same residual is negative. That is the instrument's floor, not a discovery.

One redundant pass does remain, and it is better named than claimed away. The
walk visits every node the codec has just built -- including the seventy
thousand sample objects whose numbers `assertEncodableStroke` has already proved
on the model, and the metadata and rendering hints that `validateJsonValue` has
already walked more strictly on the way past. What it uniquely knows is
*absolute document depth*, which nothing else in the encoder does, so deleting it
means making depth a property of emission: every object literal in the codec
would have to know its own nesting level. That is 154 ms, and it would buy them
by making encode/decode depth symmetry implicit -- which is the one invariant
this codec has actually got wrong before, and the reason D-048 is written the way
it is. At a 359 ms mounted block that lands on an idle thread, the trade is a bad
one. It is recorded rather than taken.

### Memory

Heap growth across one encode, over a collected baseline, medians of three runs:

| fixture | before | after | retained after collection |
| --- | --- | --- | --- |
| 3 × 5000 | 45.0 MB | **40.4 MB** | 5.6 MB, both |
| 7 × 5000 | 104.8 MB | **94.2 MB** | 11.1 MB, both |

Across the three largest fixtures the reduction is a consistent 10.2%, and
nothing is retained that was not retained before. The 1.49 MB fixture reads
*worse* (6.3 MB against 9.0 MB) and should not be believed: one sample of heap
growth on a small document is mostly a measurement of when the young generation
was collected, and the new path allocates strictly less than the old one at every
size. Chained with R2's figures, the same quantity at 39 MB has gone 122.0 →
104.9 → 94.2 MB.

## Mounted

The renderer block during a capture in the real application, window verified
visible, focused and not minimized, background throttling left enabled. Matched
by payload against the same four scenarios measured after R2, three runs each,
medians:

| scenario | payload | after R2 | after R3 | reduction |
| --- | --- | --- | --- | --- |
| capture colliding with a mark | 8.37 MB | 193 ms | 133 ms | 31% |
| one continuous stroke | 20.92 MB | 432 ms | 283 ms | 34% |
| a burst of quick marks | 22.31 MB | 395 ms | 313 ms | 21% |
| idle capture | 26.50 MB | 466 ms | **359 ms** | 23% |
| pooled | | 1486 ms | **1088 ms** | **27%** |

The ~400 ms goal for the 26.5 MB class, which R2 got within 66 ms of and did not
meet, is met: 359 ms, from 711 ms after R1. Pooled against R1 the two codec
phases have halved the block.

The mounted reduction is smaller than the 49% measured in Node, and by more than
R2's gap was. Two reasons, and neither is mysterious. The block contains handing
the encoded string across the process boundary, which R3 does not touch and
which is now a larger share of a smaller block. And R3's saving is per *sample*,
not per byte: the synthetic fixtures carry 1 795 points and source samples per megabyte, and a
document drawn with a real brush through real pointer events is not obliged to
match that, so a payload-matched comparison is the right way to compare the
blocks and the wrong way to predict one from the other.

## Byte identity

Seventeen fixtures, every one identical to the digest captured from the
implementation that preceded it. The eight added for this phase were pinned from
the pre-R3 encoder before anything was touched, and they exist because R3 changes
the code that writes strokes specifically: a one-sample tap, a 600-sample
stroke, 5000 samples, a pressure sweep across the whole unit interval, one
stroke per durable strategy (`centerline@1`, `outline@1`, `technical-pen@1`,
`pressure-pen@1`, `pencil@1`), the brush a Stroke built without one falls back
to, a mouse stroke with neither optional angle and a touch stroke with both, and
a transformed stroke beside a restyled one.

Each is also asserted to carry canonical key order, to end in exactly one
newline, and to re-encode to the same bytes after a decode — so the save/open
round trip is part of the byte gate rather than a separate claim.

## Whether the gates can fail

Four perturbations, applied one at a time and reversed:

| perturbation | tests that failed |
| --- | --- |
| remove the encode-side validation entirely | **55 of 304** |
| drop the timestamp-ordering scan | 2 |
| start the source-sample loop at index 1 | 1 |
| remove the constructor's point-count check | 1 |

The last two are the point of the exercise. Each names exactly the gate that
owns it: the off-by-one fails only the case that targets sample zero, and
removing the model's rule fails only the test about the model — because the
encoder's own check still catches a forged Stroke, which is what defence in
depth is supposed to look like.

The encoder's adversarial cases cannot be built through a constructor, because
the whole finding is that a constructor will not build them. They are forged onto
`Stroke.prototype`: 45 of them, one per rule, each asserted down to the error
code and the JSON path. The decoder has 31 of its own, driven through
`decodeStroke` with a damaged document — including `1e999`, which is a legal JSON
number and an illegal stroke coordinate, and is the only way a file on disk can
carry an infinity.

## Not changed

`parseStroke` has not been weakened or moved; it is still the only way a
`.folio` file, a recovery record, or anything else untrusted becomes a `Stroke`,
and it is still the only caller-visible decode path. R1's scheduling is
untouched. The 64 MiB recovery ceiling, the atomic write, the text-side depth
scan on the way in and every error code are as they were. No worker, no custom
JSON writer, no format change.
