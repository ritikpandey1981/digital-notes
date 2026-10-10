# Recovery encodes the same bytes in fewer passes

Recovery R1 stopped a capture from starting while someone is drawing. It did
nothing about what a capture costs once it runs, and
[`recovery-r1.md`](recovery-r1.md) left that as the next item: a duplicated
serializability guard, a depth check that walked the encoded text, and a sort
that rebuilt every object in the document.

R2 removed all three. The bytes are identical — that is the whole constraint —
and the file format is untouched, so a project written by this version is the
same file the previous version wrote, down to key order and the trailing
newline.

Same machine as every note here: AMD Ryzen 7 6800H, Windows 10.0.26200, 120 Hz.
Node measurements are medians of seven to nine runs per fixture, because one run
of a thirty-megabyte encode mostly measures when the collector happened to fire.
Mounted measurements are from the real application, window verified visible,
focused and not minimized, background throttling left enabled.

## Five passes became two

| pass over the whole document | before | after |
| --- | --- | --- |
| codec builds the tree, validating its own output | ✓ | ✓ |
| `isJsonSerializable` walks the tree | ✓ | folded into the walk below |
| `sortJsonValue` rebuilds every object with sorted keys | ✓ | **gone** |
| `JSON.stringify` | ✓ | ✓ |
| `TextEncoder`, for a byte count | ✓ | ✓ |
| `assertJsonTextDepth` reads every character of the text | ✓ | **gone** |
| one walk of the finished tree: nesting *and* JSON-safety | — | ✓ |

## The two invariants, kept in one place

`assertEncodableProjectTree` walks the finished tree once and answers two
questions about the same nodes.

**Is this nesting the decoder will accept?** Per-field validation cannot answer
it: metadata nested legally inside its own object still sits several levels down
inside the document carrying it, and a project Folio writes but cannot read is
worse than one it declines to write. The walk counts depth the way the decoder's
text scan counts it — the document's outermost object is level one — so the two
agree by construction. The decoder still scans text, because when it runs there
is no tree yet; checking before `JSON.parse` is the entire point of it.

**Is every value one JSON can carry?** This is the half that could not be done
on the text at all. `JSON.stringify` does not refuse what it cannot represent:
it drops `undefined` and functions, and turns `NaN` and `Infinity` into `null`.
By the time there is text to scan, the evidence is gone. So the encoder proves
its own output before serializing it, and fails loudly instead of writing a file
nobody can read back.

The boundary tests find the ceiling rather than assuming it: they walk nesting
outwards until the encoder refuses, then assert the last accepted document has a
text depth of exactly 64 — for nested objects, nested arrays, and the two
alternating. Shifting the walk's origin by one level fails four tests, including
the one asserting that anything the encoder accepts the decoder accepts.

## Canonical order is emitted, not restored

The codec now writes keys in the format's order to begin with, so nothing
rebuilds the document afterwards. Two things had to be understood first, and
neither was what the plan assumed.

**The format's order is not simply "sorted".** It is array-index-like keys
first, ascending, and then every other key by `localeCompare(_, "en")`. The first
half is not a choice: an object always enumerates integer-like keys first and in
numeric order, however it was built. The `dynamic-keys` fixture is in the corpus
because it caught a gate that asserted the simpler, wrong rule. The upside is
that the engine's hoisting makes insertion order irrelevant for exactly those
keys, which is what makes emitting canonical order safe.

**The locale is load-bearing for dynamic keys and irrelevant for fixed ones.**
`localeCompare` puts "apple" before "Apple" and sorts "ümlaut" among the letters;
a code-unit comparison does neither, so swapping it would change the bytes of
every file with a dynamic key in it. But for all twenty-seven of the codec's
fixed schemas the two orders agree, which is asserted where those orders are
declared. The fixed schema's bytes therefore do not depend on the collation
library at all.

Four structures have keys the codec cannot know statically — object metadata,
Ink rendering hints, and the two vector payloads — and those are sorted locally,
where they are small, instead of by a pass over everything.

## What it cost, measured

Node, median total encode:

| fixture | payload | before | after | saved |
| --- | --- | --- | --- | --- |
| ordinary | 1.49 MB | 58.2 ms | 30.8 ms | **47%** |
| 1 × 5000 | 5.57 MB | 296.0 ms | 120.8 ms | **59%** |
| 2 × 5000 | 11.14 MB | 614.5 ms | 369.2 ms | **40%** |
| 3 × 5000 | 16.71 MB | 963.6 ms | 568.5 ms | **41%** |
| 5 × 5000 | 27.86 MB | 1629.2 ms | 935.2 ms | **43%** |
| 7 × 5000 | 39.00 MB | 2250.1 ms | 1332.2 ms | **41%** |

The encoded length was identical in every build for every fixture, which the
instrument checks rather than assumes.

Transient memory fell with the rebuilt tree, and retained memory did not move:

| fixture | peak growth during encode | retained after collection |
| --- | --- | --- |
| 3 × 5000, before | 52.5 MB | 16.7 MB |
| 3 × 5000, after | **45.1 MB** | 16.7 MB |
| 7 × 5000, before | 122.0 MB | 22.3 MB |
| 7 × 5000, after | **104.9 MB** | 22.3 MB |

## Mounted

The renderer block during an idle capture, matched by payload size against the
same scenarios measured after R1. Three runs of each, medians:

| payload | after R1 | after R2 | reduction |
| --- | --- | --- | --- |
| 8.4 MB | 280 ms | 193 ms | 31% |
| 20.9 MB | 598 ms | 432 ms | 28% |
| 22.3 MB | 594 ms | 395 ms | 34% |
| 26.5 MB | 711 ms | 466 ms | **35%** |
| pooled | 2183 ms | 1486 ms | **32%** |

The three runs were worth taking. The first single sample at 26.5 MB came back
at 611 ms, which read as a 14% improvement and prompted a search for what in the
mounted block R2 had failed to touch; the other two came back at 433 ms and
466 ms. One capture of a twenty-six-megabyte document is not a measurement, and
the 611 ms sample was the outlier rather than the answer.

The remaining gap between mounted and Node is real but small: around a third
against around two fifths. The mounted block is not purely the encode -- it also
contains handing the encoded string across the process boundary, which R2 does
not touch and which scales with the same thing -- so some of the difference sits
there. The earlier note's claim that this block "is the encode" is close to true
and no longer exactly true.

The ~400 ms goal for the 26.5 MB class is nearly met and not quite: 466 ms
median, with a best run of 433 ms, down from 711 ms.

## What is left, and it is not `JSON.stringify`

At 39 MB, of 1332 ms:

| stage | cost | share |
| --- | --- | --- |
| tree build, including the codec re-validating its own output | 752 ms | 56% |
| `JSON.stringify` | 362 ms | 27% |
| the new walk | 194 ms | 15% |
| `TextEncoder` byte count | 23 ms | 2% |
| *(avoided)* whole-tree canonical rebuild | 516 ms | — |

The largest remaining item is the encoder validating output it just built.
`encodeStroke` assembles a stroke out of already-validated model fields and then
runs the full decode-side `parseStroke` over the result, which at 35 000 samples
means two `Set` allocations and an intermediate object per point. Measured by
skipping it: 1332 ms becomes **603 ms**, so it is roughly **728 ms, twice
`JSON.stringify`.**

It was left alone deliberately. It is defence in depth that has value — it is
the reason a forged model cannot reach the disk — and removing it needs a proof
that the `Stroke` model's own invariants cover every cross-field rule
`parseStroke` enforces, including ordered timestamps, point-count agreement and
pressure monotonicity. That is a phase, not a line, and it is now the one worth
doing: a custom JSON writer would attack the second-largest stage while the
largest sits untouched.

## Not changed

R1's scheduling is untouched: the mounted collision test still shows no capture
starting inside a stroke, and a 75-second stroke still has no long task inside
it. `formatVersion` is still 1. The 64 MiB recovery ceiling, the atomic write,
the text validator on the way in, and every error code are as they were. The
main process still re-escapes and re-measures the project string; that is not
the renderer-thread stall and is recorded as debt rather than fixed here.
