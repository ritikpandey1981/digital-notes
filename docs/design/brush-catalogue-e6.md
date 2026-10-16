# Forty-five names, ten presets, six engines

An audit, not a migration. It answers one question for every shipped brush —
can the engines Folio already has draw it honestly? — and turns the answer into
a plan. Nothing here changes the catalogue.

## The thing to understand first

"The catalogue" is two things, and conflating them makes every count wrong.

**Presets** are the durable configuration. Ten of them, in
[`pen-presets.ts`](../../packages/editor/src/foundation/pen-presets.ts). A
preset is what resolves into a `ResolvedBrushSnapshot`, which is what a stroke
carries into a `.folio` file. Its entire surface is `color`, `size`, `opacity`,
`smoothing`, `dynamics.pressureSize`, `dynamics.pressureOpacity` and `renderer`
— there is no hardness, no grain, no flow, no coverage, no tip angle, and that
is deliberate.

**Library identities** are the names a person picks from. Forty-five of them,
in
[`brush-library-catalogue.ts`](../../apps/desktop/src/components/editor/brush-library-catalogue.ts).
An identity carries **no configuration at all** — only a name, a family and a
`fallbackPresetId`. Two identities pointing at one preset draw identically, and
the file says so.

So the catalogue offers forty-five names backed by nine distinct marks (the
tenth preset, the highlighter, has no library identity). That gap is recorded
and gated — `brush-library-catalogue.test.ts` asserts the backings number nine
— but it is the single largest fact about the catalogue, and it is worth being
blunt about: **the biggest gap between what Folio promises and what it draws is
not an engine gap. It is a preset gap.** Seven pen identities — Fineliner, Gel
Pen, Ballpoint, Rollerball, Bold Liner, Ink Pen, Contour Pen — are one mark
today, and no new strategy changes that.

This audit is about the ten presets, because those are what name a strategy.
Where a count is more useful at identity level it is given both ways.

## What the four modern engines actually do

Read off the frozen implementations and their suites, not off the names.

| | `technical-pen@1` | `pressure-pen@1` | `pencil@1` | `marker@1` |
| --- | --- | --- | --- | --- |
| primitive | stroked path | filled silhouette | tiled material | swept swath |
| width | constant, from `size` | varies with `pressureSize` | tip varies with `pressureSize` | constant; nib is oriented |
| pressure → width | **ignored by design** | yes | yes | yes, when enabled |
| pressure → alpha | no | `pressureOpacity` per band | `pressureOpacity` as *coverage* | per band, when enabled |
| texture | none | none | grain; never covers the whole tip | none |
| within one stroke | one path, one alpha | bands tiled on shared cross-sections | **retrace darkens** | **retrace cannot darken** |
| between strokes | source-over | source-over | source-over | source-over |
| terminals | round cap; a tap is a disc | capped band; a tap is a disc | full textured tip | full nib impression |
| mouse | identical to pen | expression dropped | expression dropped | expression dropped |
| cache | per-stroke geometry | per-stroke geometry | **shared material runtime**, 64 MiB + 16 MiB index | per-stroke geometry only |
| frozen by | `engine-strategy-freeze` | `engine-strategy-freeze` | `+ pencil-visual-freeze` | `marker-visual-freeze` |

And the two legacy strategies, which are frozen compatibility rather than
deprecated: `centerline@1` is a constant-width stroked path with round caps and
joins that marks a tap; `outline@1` is a pressure-varying filled silhouette
with no texture. Neither is bad. Both are simply the pair that existed before
any of the four above did.

Three consequences fall straight out of the table.

**No strategy composites with anything but source-over.** Pencil uses
`source-in` inside its own offscreen tile and then hands the result over
normally. Blend mode is not a durable field and not a strategy parameter, so
multiply is not reachable by configuration from any engine. That decides the
highlighter.

**`marker@1`'s nib angle and proportions are strategy constants**, not preset
fields. A brush whose identity is *its own* angle cannot be a Marker preset; it
would be `marker@2` or another strategy. That decides calligraphy.

**`pencil@1` has no hardness.** HB, 2B and 4B can differ in width, darkness and
pressure response, and in nothing else. The grain is one grain.

## Every preset, once

Family is the user-facing classification; strategy is rendering behaviour. The
repository already proves they differ — three pencil-family presets sit on
three different strategies today — so nothing below is classified from its
family name.

| Preset | Name | Family | Current | Recommended | Class | Confidence | Risk | Preset changes | Defining visual property | Reason | Prototype? | Future engine? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `pencil-hb` | HB | pencil | `pencil@1` | `pencil@1` | already modern | HIGH | — | none | soft graphite, pressure-varied coverage | the frozen graphite engine, and the family default | No | No |
| `pencil-2b` | 2B | pencil | `outline@1` | `pencil@1` | **C** | HIGH engine, MEDIUM config | **HIGH** | enable `pressureOpacity`, about `[0.55, 1]` power 0.75 | softer, darker graphite | same medium as HB; `outline@1` gives it a smooth filled silhouette with no grain at all | **Yes** | No |
| `pencil-4b` | 4B | pencil | `outline@1` | `pencil@1` | **C** | HIGH engine, MEDIUM config | **HIGH** | enable `pressureOpacity`, wider, about `[0.6, 1]` | very soft, broad graphite | as above, and the broadest pencil, so the one that tests the material budget | **Yes** | No |
| `pencil-mechanical` | Mechanical Pencil | pencil | `centerline@1` | `technical-pen@1` *or* `pencil@1` | **G** | — | MEDIUM | none on technical-pen; raised opacity if graphite | clean, fine, uniform lead line | behaviourally a monoline today, and `pencil@1` never covers its whole tip — at 1.2 page units that grain may read as a broken line rather than graphite | **Yes** | No |
| `pen-fineliner` | Fineliner | pen | `centerline@1` | `technical-pen@1` | **A** | HIGH | MEDIUM | none | uniform monoline ink | `technical-pen@1` is precisely a constant-width clean line; both painters already use round caps and joins and both mark a tap, so the delta is path fitting | **Yes** | No |
| `pen-technical` | Technical Pen | pen | `technical-pen@1` | `technical-pen@1` | already modern | HIGH | — | none | fine technical nib | — | No | No |
| `pen-brush` | Brush Pen | pen | `pressure-pen@1` | `pressure-pen@1` | already modern | HIGH | — | none | pressure-sensitive round ink | — | No | No |
| `marker-felt` | Felt Marker | marker | `marker@1` | `marker@1` | already modern, **frozen** | HIGH | — | none | oriented felt chisel | approved and pinned in E5B | No | No |
| `marker-broad` | Broad Marker | marker | `centerline@1` | `marker@1` | **D** | HIGH | MEDIUM | none; 16 and 0.82 carry over | broad chisel swath | the six identities it backs are named Broad, Chisel, Wide, Studio, Block and Flat — a round constant-width line is the wrong mark for every one of them | **Yes** | No |
| `highlighter-default` | Default Highlighter | highlighter | `centerline@1` | `centerline@1` for V1 | **F**, held as **E** | — | — | none | translucent wash that leaves the ink underneath readable | needs multiply; nothing composites anything but source-over and blend mode is not durable. `marker@1` at low opacity would change the nib without fixing the blend | No | **`highlighter@1`** |

## Counts

Reconciled against the ten presets, and against the forty-five identities they
back.

| | presets | identities |
| --- | --- | --- |
| total | **10** | **45** |
| already modern | 4 | 21 |
| → `technical-pen@1` | 1 | 7 |
| → `pressure-pen@1` | 0 | 0 |
| → `pencil@1` | 2 | 8 |
| → `marker@1` | 1 | 6 |
| remain `centerline@1` | 1 | 0 |
| remain `outline@1` | 0 | 0 |
| uncertain, needs a prototype | 1 | 3 |
| specialized engine wanted | 1 | 0 |

The last two rows overlap nothing: `pencil-mechanical` is the uncertain one and
`highlighter-default` the specialized one. 4 + 1 + 0 + 2 + 1 + 1 + 1 = 10.

**Coverage, not inflated.** Today the four modern engines draw **4 of 10
presets (40%)** and **21 of 45 identities (47%)**. With the four recommended
migrations they draw **8 of 10 (80%)** and **42 of 45 (93%)**. Resolving
`pencil-mechanical` either way takes identities to **45 of 45 (100%)** and
presets to 9 of 10; the tenth is the highlighter, and it is the only preset the
four engines cannot serve honestly.

**Coverage after LOW-RISK migrations only is unchanged, because there are
none.** Every remaining migration either changes a family default or visibly
changes the mark. That is not a problem with the mappings — three of the four
are HIGH confidence — it is a statement that each one deserves the single sheet
that settles it. The last three phases were all about not freezing a mark
before somebody looked at it.

## What the footprints say, and what they do not

Measured by building the same pressure-ramped diagonal under each pair of
strategies and reading `getStrokeRenderedBounds`:

| swap | bounds before → after | change |
| --- | --- | --- |
| `pen-fineliner` centerline → technical-pen | 226.0 × 146.0 → 226.0 × 146.0 | 0.0% |
| `pencil-mechanical` centerline → technical-pen | 225.2 × 145.2 → 225.2 × 145.2 | 0.0% |
| `pencil-mechanical` centerline → pencil | 225.2 × 145.2 → 226.2 × 146.2 | +0.4% / +0.7% |
| `pencil-2b` outline → pencil | 227.9 × 147.9 → 228.9 × 148.9 | +0.4% / +0.7% |
| `pencil-4b` outline → pencil | 231.2 × 151.2 → 232.2 × 152.2 | +0.4% / +0.7% |
| `marker-broad` centerline → marker | 240.0 × 160.0 → 240.0 × 160.0 | 0.0% |
| `highlighter-default` centerline → marker | 236.0 × 156.0 → 236.0 × 156.0 | 0.0% |

The useful reading is the null one: **no candidate swap materially changes a
stroke's footprint.** Selection, hit testing, page bounds, layer bounds and the
eraser all see the same rectangle, so none of them is at risk from any of these
migrations. It also means bounds cannot tell these swaps apart — the entire
difference is *inside* the mark, which is exactly why the shortlist below is
visual.

## The special cases

**Highlighter.** Is any shipped preset conceptually a highlighter? Yes —
`highlighter-default`, and it has a dock slot of its own. Walking the test: its
same-stroke coverage should be uniform (both `centerline@1` and `marker@1`
give that); separate strokes should darken somewhat (both do); it should be
strongly translucent (0.34, and opacity is durable); its nib should be a chisel
(`marker@1`'s is, `centerline@1`'s is not); and **dark ink underneath must stay
readable**, which is where it fails. Source-over yellow at 0.34 over black text
tints the text toward yellow. A highlighter multiplies. No strategy exposes a
blend mode, `ResolvedBrushSnapshot` has no field for one, and adding one is not
preset tuning. → **specialized engine required** for a real highlighter;
**stays on `centerline@1` for V1**, because what ships today has the same
limitation and swapping it to `marker@1` would change the nib while leaving the
actual defect in place.

**Calligraphy.** `calligraphy-pen` and `fountain-pen` are library identities,
not presets; both fall back to `pen-brush` on `pressure-pen@1`, which gives
them a pressure-varying *round* line. Their identity is an oriented flat nib —
width from direction, not from pressure. `marker@1` has exactly that geometry,
but its angle and 0.42 proportions are constants of the strategy version, and a
calligraphy brush whose angle a person cannot set is not one. Distorting
`marker@1` to absorb them would mean editing a frozen engine's constants, which
§22 of the brief and D-051 both forbid. → **future `calligraphy@1`**; no preset
migrates for it, and nothing is blocked meanwhile.

**Ruling pen.** `ruling-pen` is a library identity on `pen-technical`. A ruling
pen's defining property is that it draws a *straight line of set width against
a straightedge* — the constraint is the instrument, not the ink. The width
behaviour is already right on `technical-pen@1`. → **not a brush engine**; if
anything it wants a straight-line drawing constraint, which is a tool feature.
No specialized strategy, no migration.

**Dry media.** No charcoal, chalk, pastel, crayon or conté exists anywhere in
the catalogue — not as a preset, not as an identity. The library file says so
deliberately. → **nothing to classify.** A future `dry-media@1` would unlock
zero current entries, so it is a product decision about what to add, not a
mapping problem. It must not be done by pointing new names at `pencil@1`:
graphite has one grain, and three dry media sharing it would be three names for
one mark again.

**Wet media.** No watercolour, gouache, oil, wet brush or airbrush exists
either. The fifth dock slot is a second pen precisely because the engine has no
colour-brush behaviour, and the dock model says so. → **nothing to classify**,
and out of V1 scope.

## Legacy policy

`centerline@1` and `outline@1` are frozen compatibility strategies and do not
have to disappear. A preset stays legacy for V1 when no modern engine
represents it better, when the current behaviour is acceptable, and when
replacing it would be a visual regression.

Exactly one preset qualifies on those grounds: **`highlighter-default` stays on
`centerline@1`**. Every other legacy preset has a modern engine that represents
it strictly better, so the legacy strategies end V1 serving one shipped preset
and all existing artwork — which is what frozen compatibility is for.

## Existing artwork

Changing a preset's renderer affects new strokes only, and this is a property
of the architecture rather than a convention. A stroke carries its whole
`ResolvedBrushSnapshot` — strategy, size, opacity, smoothing, both responses —
into the file; the decoder reads that snapshot and never consults the
catalogue. It is already proven both ways: a Marker-family stroke naming
`centerline@1` still renders `centerline@1`
(`marker.test.ts`), and a Marker stroke **saved at size 8 decodes at size 8**
while the catalogue default is 12 (`brush-strategy-decoding.test.ts`). E6B
changes what the next stroke looks like and cannot reach a stroke already
drawn.

## Serialization and UI

All six strategies are already in `SUPPORTED_BRUSH_STRATEGIES`, already named
by the freeze roster, and already carried by every path that persists a stroke:
Save and Open and the recovery autosave all run through
`encodeFolioProject` / `decodeFolioProject` → `page-object-codec` →
`ink-codec`, and the clipboard copies immutable `PageObject`s in memory without
serializing at all. **E6B needs no `formatVersion` change and no vocabulary
addition**, because it introduces no strategy.

The UI is unaffected for the reason it was designed to be: `BRUSH_FAMILY_GLYPHS`
is keyed by family, the dock slot and the radial wheel both read that one table,
and the file states that a glyph is never durable. A preset changing strategy
changes no glyph, no slot family and no selected state.

## Prototype shortlist

Five sheets, each answering one question. The Marker inspection sheet
(`FOLIO_MARKER_SHEET=1`) is the pattern: real renderer, real slot, real input
path, deterministic layout, every case asserted to have drawn.

| # | Preset | From → To | Why it is uncertain | What the comparison decides |
| --- | --- | --- | --- | --- |
| 1 | `pen-fineliner` | `centerline@1` → `technical-pen@1` | the **pen family default**, backing seven identities; footprint identical and both painters use round caps, joins and a tap disc, so the only delta is bezier path fitting at 2 page units | whether a fitted path at a fine width reads identical, cleaner, or softer than the smoothed polyline |
| 2 | `marker-broad` | `centerline@1` → `marker@1` | the largest intentional visual change in the plan: a round 16-unit line becomes an oriented chisel for six chisel-named identities | whether 16 units at 0.82 reads as a broad marker, and whether 16 wants to move the way 8 wanted to move to 12 |
| 3 | `pencil-2b` | `outline@1` → `pencil@1` | smooth filled silhouette becomes grain; also the first test of whether `pressureOpacity` can make a 2B read *softer* than HB with the same material | whether 2B and HB are distinguishable on one grain, and at what opacity range |
| 4 | `pencil-4b` | `outline@1` → `pencil@1` | as above at size 5, the broadest pencil, and the one that exercises the shared material budget | whether 4B reads as 4B, and what it costs |
| 5 | `pencil-mechanical` | `centerline@1` → `technical-pen@1` **vs** `pencil@1` | the one genuine fork. `pencil@1` never covers its whole tip, and at 1.2 page units that may read as a broken line | which of the two a mechanical pencil is: a clean fine line, or thin graphite |

Sheet 5 is the only one that needs two candidates drawn side by side. Sheets 1
and 2 are cheap and unblock eleven of the forty-five identities between them.

## Risk, and the one performance flag

| migration | visual | blast radius | overall |
| --- | --- | --- | --- |
| `pen-fineliner` → `technical-pen@1` | LOW — identical footprint, same caps and joins | family default, 7 identities | **MEDIUM** |
| `marker-broad` → `marker@1` | HIGH — round becomes chisel | 6 identities, no slot default | **MEDIUM** |
| `pencil-2b` → `pencil@1` | HIGH — silhouette becomes grain | 4 identities | **HIGH** |
| `pencil-4b` → `pencil@1` | HIGH, plus runtime | 4 identities | **HIGH** |
| `pencil-mechanical` → either | unknown | 3 identities | **MEDIUM** |

**The performance flag is the pencils, and only the pencils.**
`centerline@1` → `technical-pen@1` and `centerline@1` → `marker@1` both move a
preset between strategies that keep nothing but per-stroke geometry.
`outline@1` → `pencil@1` moves two presets onto the one strategy with a
*shared* material runtime — 64 MiB of material, 16 MiB of index, a 4 ms
scheduler slice, a tile cache and an eviction order. Three pencil presets
drawing graphite instead of one, with `pencil-4b` the broadest of them, is the
only mapping in this plan that changes the memory profile of a page. It should
be measured on the broad case, not assumed from the narrow one.

## Future engine backlog

Ranked by what the catalogue actually contains, not by what a brush engine
could contain.

| rank | strategy | identities unlocked | importance | difficulty | required for desktop V1? |
| --- | --- | --- | --- | --- | --- |
| 1 | `highlighter@1` — multiply compositing | 0 identities, **1 preset and 1 dock slot** | high: it is a visible tool that is quietly wrong over dark ink | medium — a blend mode on the painter, and a decision about what multiply means between two highlighter strokes | **No** |
| 2 | `calligraphy@1` — per-preset nib angle, possibly angle-following | 2 (`calligraphy-pen`, `fountain-pen`) | medium: two names currently drawing a round pressure line | medium–high: `marker@1` has the geometry but not the configurability, and angle-following reopens the corner-stability problem D-050 avoided | **No** |
| 3 | `dry-media@1` — a second granular material | 0 today | low until the catalogue adds charcoal, chalk or pastel | high | **No** |
| 4 | wet media | 0 today | out of scope | very high | **No** |

A ruling-pen strategy is deliberately absent: it is a drawing constraint, not a
brush.

## The V1 recommendation

**B — the four modern engines plus the frozen legacy strategies are sufficient
for desktop V1.**

One preset out of ten stays legacy, and it stays legacy honestly: the
highlighter is translucent and uniform today and would be translucent and
uniform on `marker@1`, so nothing about shipping it on `centerline@1` is a
compromise a person would notice *more* than they notice it now. Everything
else has an engine that fits it better than what it has.

The case for C — build `highlighter@1` first — is real and should be heard: a
highlighter that washes out the text under it is a visible defect, not a
missing feature. It is not a V1 blocker because it is the current shipped
behaviour and because no catalogue entry depends on it. It is first in the
backlog for a reason.

And the recommendation that matters more than either: **the four engines are
not the constraint; ten presets for forty-five names is.** After E6B the
engines will draw 93% of the library and the library will still offer nine
distinct marks under forty-five labels. Closing that is preset work — new
presets with distinct sizes, opacities and pressure responses on engines that
already exist — and it needs no new strategy at all.

## E6B, exactly

Nothing in E6A changes the catalogue. This is what E6B would do.

### Group 1 — visual-approval migrations

In sheet order. Each is one preset, one line of `pen-presets.ts`, one sheet,
one approval.

1. `pen-fineliner`: `renderer: "centerline"` → `"technical-pen"`. No other
   change.
2. `marker-broad`: `renderer: "centerline"` → `"marker"`. No other change.
3. `pencil-2b`: `renderer: "outline"` → `"pencil"`, and add
   `opacityRange: [0.55, 1]` with `opacityCurve` power 0.75, so pressure drives
   coverage the way it does for HB.
4. `pencil-4b`: `renderer: "outline"` → `"pencil"`, and add
   `opacityRange: [0.6, 1]`.
5. `pencil-mechanical`: decided by sheet 5, then either
   `renderer: "centerline"` → `"technical-pen"` with nothing else, or →
   `"pencil"` with a raised base opacity.

### Group 2 — deferred, deliberately

`highlighter-default` stays on `centerline@1`. Revisit when `highlighter@1`
exists.

### Group 3 — not a migration, but the bigger win

Give distinct presets to identities that share one. Seven pen identities are
one mark; six marker identities are another. This needs no new strategy and no
new durable field — only `size`, `opacity`, `smoothing` and the two responses,
which is the whole configurable surface. Worth scoping as its own phase rather
than smuggling into a strategy migration.

### Tests E6B must update

Found by searching for hard-coded strategy, size and family expectations
against every preset in Group 1 — not left for a fourteen-minute Electron sweep
to discover.

| File | What it asserts | Why it changes |
| --- | --- | --- |
| `packages/editor/src/__tests__/brush-tool-state.test.ts` | a literal strategy and pressure capability for all ten presets | four or five rows move |
| `packages/editor/src/__tests__/pencil-preset.test.ts` | "is the only preset on the pencil strategy" plus the set every other preset must be in | three pencils on `pencil@1` |
| `packages/editor/src/__tests__/technical-pen-preset.test.ts` | "is the only preset on the new strategy" | `pen-fineliner` joins it |
| `packages/editor/src/__tests__/pressure-pen-preset.test.ts` | the allowed set for every other preset | the set shrinks |
| `packages/editor/src/__tests__/marker-preset.test.ts` | "is the only preset on the marker strategy" | `marker-broad` joins it |
| `tests/e2e/electron-professional-brush-ux.spec.ts` | selects `marker-broad` and asserts width 16 | width is unchanged; re-run to confirm the strategy swap is invisible to it |
| `tests/e2e/electron-tool-dock.spec.ts`, `electron-editor-foundation.spec.ts` | `pen-fineliner` as the pen slot's preset | id unchanged; re-run because the mark changes |

Those four "is the only preset on X" gates were written to stop a strategy
phase quietly becoming the catalogue phase. E6B *is* the catalogue phase, so
they are relaxed on purpose and by name — not edited away because they went
red.

One documentation fix belongs with the first migration: the docblock of
`brush-library-catalogue.ts` still says "The renderer has exactly two
behaviours — a constant-width centreline and a pressure-varying outline". Six
strategies ship. It was true when written and is not now.

### Docs E6B must update

This file, `brush-engine-architecture.md` §26's catalogue table (which already
carries the per-row notes this audit confirms or corrects), `DECISIONS.md` for
whatever the sheets decide, and `ROADMAP.md`.
