# Folio engineering decisions

This log records durable choices that constrain future work. It is intentionally
compact: implementation detail belongs in [`ARCHITECTURE.md`](ARCHITECTURE.md), and
unresolved work belongs in [`ROADMAP.md`](ROADMAP.md).

## D-001 — One live sketchbook document authority

**Status:** accepted

The live editor uses `SketchbookDocument -> Page -> PageDocument`. Each `PageDocument`
owns both ordered Layers and one canonical flattened `ObjectCollection`.

Layers own ordered object IDs. `PageObject` does not carry a page ID or `layerId`.
Flattened array position is the canonical mixed-object render order; object `zIndex` is
derived from it. Constructors reject layer membership/order drift.

**Consequence:** features must update layers and the flattened collection atomically.
Do not add another ownership field or ordering system for UI convenience.

## D-002 — Immutable replacement and command-based History

**Status:** accepted

Artwork mutations produce immutable successors and execute through commands. The
generic History layer stores bounded command stacks and supports non-nested,
all-or-nothing transactions.

Interactive previews may install temporary immutable replacements, but a completed
gesture produces one logical command. Cancel restores the exact prior state.

**Consequence:** components and renderers never directly mutate canonical document
objects, and frame-rate input must not become frame-rate History.

## D-003 — Session state stays outside artwork

**Status:** accepted

Active page, active layer, per-page viewport, selection, clipboard, tools, preferences,
and transient UI are editor-session state. They are not PageObjects and do not enter
document History.

**Consequence:** persistence of a preference, if later required, needs an explicit
settings boundary rather than placing it in the sketchbook model.

## D-004 — Page and Layer ownership are independent of objects

**Status:** accepted

An immutable PageObject can be cloned, moved, and reused without embedding container
identity. Page and Layer containers establish ownership. Paper is Page state beneath
artwork, not a Layer or PageObject.

**Consequence:** clipboard and duplication create fresh object identities, then insert
them through the destination page/layer command boundary.

## D-005 — One coordinate and viewport authority

**Status:** accepted

Rendering owns camera/viewport transforms and the conversion path between screen,
canvas, world, and page coordinates. Selection and manipulation consume adapters to
that path.

The viewport preserves a 64-CSS-pixel recoverable portion of the page.

**Consequence:** packages must not invent local coordinate math or store viewport
transforms in document objects.

## D-006 — One request-driven compositor

**Status:** accepted

The Canvas 2D compositor paints paper and the canonical mixed-object order. Rendering
is invalidation-driven and frame-coalesced. Immutable Ink geometry is cached by stroke
identity and object scale with bounded scale variants.

**Consequence:** new object kinds extend the compositor; they do not create a parallel
canvas or continuous render loop. Presentation invalidation must remain explicit.

## D-007 — Preserve exact Ink input

**Status:** accepted; rendering boundary extended by D-028

Committed strokes retain exact useful source/process samples, including timing,
pressure, tilt, twist, buttons, and device information. Smoothing and fitted geometry
are derived views. The rendering boundary is now the versioned strategy vocabulary rather
than the two original behaviours; retaining source samples is unchanged, and a strategy
that ignores a signal still may not discard it.

**Consequence:** an optimization may change derived caches but not discard canonical
source samples or change old strokes when a preset changes.

## D-008 — Low-level selection, editor-owned workflows

**Status:** accepted

`@folio/selection` remains the single-primary-selection and hit-testing foundation.
Logical multi-selection, marquee, overlap cycling, combined bounds, clipboard, and
group commands live in `@folio/editor`.

`@folio/manipulation` emits model-neutral discriminated results; the editor adapts
them to document commands.

**Consequence:** richer editing does not widen lower packages with product workflow or
document dependencies.

## D-009 — Clipboard is session-local

**Status:** accepted

The current clipboard stores immutable PageObject references within the mounted editor
session. It is not serialized and does not use the operating-system clipboard. Copy is
History-free; cut, paste, duplicate, and delete use grouped commands.

**Consequence:** cross-application clipboard support is a separate format/security
design, not an incremental extension of the session clipboard.

## D-010 — Stable drawing slots, replaceable brushes

**Status:** accepted

The main dock exposes five stable physical drawing slots plus Select, Eraser, and
Shapes. A slot can hold any catalogue brush. Activating an inactive slot selects it;
activating the selected slot opens its brush library.

Tool preferences remain session state. Selecting a brush adopts its preset defaults
while retaining the slot color.

**Consequence:** do not couple slot position to a permanent family or put tool
preferences in document History.

## D-011 — Color targets own current color

**Status:** accepted

Artwork color is canonical lowercase six-digit RGB hex. The active creation tool or
selected-object target owns current color. `EditorColorSystem` owns recents, favorites,
palette definitions, and the active palette, but never a parallel current color.

Picker and eyedropper interaction uses `begin`, `preview`, `commit`, and `cancel`.

**Consequence:** creation-tool changes are History-free; selected-object changes use
one continuous edit command. New color surfaces adapt to this boundary.

## D-012 — Concepts is a reference, not a dependency

**Status:** accepted

Approved Concepts interactions may inform spatial placement, density, gestures, and
workflow. Folio adapts them to its visual identity, desktop constraints, pages, and
protected architecture. Third-party trademarks, assets, and unknown internals are not
copied.

**Consequence:** an approved interaction is implemented faithfully, but an apparent
reference behavior never justifies breaking Folio's document, History, or input
invariants. Conflicts are reported for a product decision.

## D-013 — Floating surfaces share dismissal and motion rules

**Status:** accepted

Floating UI participates in an owner-aware, topmost-first dismissal stack. Page
presses may dismiss and continue as canvas input; workspace-surround presses may be
dismissal-only. Exiting surfaces stop accepting pointer events immediately.

The common motion is restrained and honors reduced-motion settings.

**Consequence:** new popovers and portals integrate with the shared ownership contract
instead of adding document-level outside-click listeners.

## D-014 — Legacy folder persistence remains isolated

**Status:** accepted; resolved by D-023

`@folio/persistence` still serves the older `@folio/domain` Notebook model through its
folder serialization. The live editor was never connected to it, and is not now: the
question of migrating that format or introducing a new one was settled by introducing
a versioned `SketchbookDocument` project format alongside it.

**Consequence:** the legacy folder path and the live project path are separate and stay
separate. Do not connect the live editor to the folder format, and do not create a
third canonical model.

## D-015 — Teaching and AI are transient until accepted

**Status:** accepted

Future lesson state, analysis, coaching, and guides do not become artwork by default.
Only an explicit user acceptance may convert a suggestion through a normal command and
History entry.

**Consequence:** future systems consume editor/document context through adapters and
cannot silently mutate PageObjects or establish parallel editor authorities.

## D-016 — Page context travels with commands; companion metadata stays bounded

**Status:** accepted

Every page command family — geometry, paper, rename, add, duplicate, remove, reorder —
and every lifted artwork command records which page it changed, plus a fallback for when
that page no longer exists. Undo and Redo activate the affected page instead of silently
changing a page the artist cannot see. Add falls back to the previously active page,
Duplicate to its source, Remove to the surviving neighbour.

The active page itself remains editor session state, and activating a page creates no
History. Command context is metadata beside a command, not document state.

Companion metadata is bounded by the commands History actually retains. History reports
its retained command identities, and the coordinator prunes the companion map against
that set, so capacity eviction, redo invalidation, rollback, clear, and destroy leave
nothing behind. Only identities cross that boundary, inside a guard, so companion
bookkeeping can never interrupt the History lifecycle.

**Consequence:** a new command family must record its page context, and any future
per-command companion map must be pruned the same way. Do not solve page-aware Undo by
making the active page part of the document.

## D-017 — Deliberate ownership change commits an open creation-color session

**Status:** accepted

Choosing another drawing slot, utility tool, library brush, or shape replaces the
creation color target. That is a deliberate end to the color edit, not an abort: the
session is committed before ownership moves.

Resolution is narrow. Only the session whose target is the one being replaced commits;
everything else is left to the existing rules. A selected-object session can never match
a creation target, so selected-artwork editing keeps its own transaction semantics.
Cancel keeps its exact meaning — the target is genuinely gone, or the artist aborted —
and still restores the original value.

**Consequence:** a chosen color survives switching tools without drawing first, with no
stroke required, no History entry, and no second color store. A new surface that replaces
the creation target must resolve the open session at that boundary rather than leaving
the valid-target guard to cancel it.

## D-018 — The focused Layer is the active Layer

**Status:** accepted

Spatial Layers derives the focused sheet from the session's active Layer id. There is no
second focus authority.

Two pieces of state would be two things that can disagree, and the disagreement is
exactly the confusing case: one sheet in the focus position while another wears the
accent. Deriving it makes that unrepresentable and means an activation from anywhere —
a press, a key, the wheel, or something outside the view entirely — moves the
arrangement through one path.

Navigation changes the active Layer. Active-layer and focus changes are session state
and create no document History.

**Consequence:** new navigation affordances call the same focus path instead of adding
local selection state, and deleting the focused Layer cannot leave a stale focus index.

## D-019 — One Layers experience; Stack is modal, List is not

**Status:** accepted

There is one Layers entry point. Stack is a modal structural mode that owns page input
while open. List is the existing Layers panel with ordinary floating-panel behavior and
does not inherit that modality. The view switch belongs inside the experience.

A closing Stack releases pointer ownership immediately, while it is still visibly
collapsing. Motion must never delay interaction: holding the grip through the collapse
swallowed the first stroke after dismissal.

**Consequence:** do not add a second Layers trigger, and do not give the List modal
ownership. Any future structural mode follows the same rule — visible exit, immediate
release.

## D-020 — One reorder authority, one command per drop

**Status:** accepted

Layer order changes through `moveLayer` and nothing else. Both presentations resolve a
display-order gesture into a canonical storage index with the same resolver, so the two
views cannot disagree about which way "up" is.

A drag is presentation until it is dropped. The candidate position is transient state,
so crossing several layers produces one command, and a drop that lands where it started
produces none. Cancel — Escape, lost capture, blur, teardown — produces none either.

**Consequence:** a new reorder affordance resolves the same way and commits at one
boundary. Do not mutate order while a gesture is in flight, and do not add a second
index mapping.

## D-021 — Edge dwell exposes; it does not focus

**Status:** accepted

Some reorder destinations cannot be expressed by pointer travel: the focused sheet is
held near the bottom of the workspace and the sheets are a full gap apart, so the
position below it is off-screen at supported window sizes. Holding near a structural
edge slides the arrangement under the held sheet instead.

That offset is transient exposure living inside the gesture. It never calls
`setActiveLayer`, so the held layer stays the active layer and focus keeps its single
authority; it never reaches the document; and it cannot outlive the gesture, because
every exit runs one resolution that stops the timer and releases the pointer once.

**Consequence:** reaching a distant position is a presentation concern, not a focus or
document concern. Reduced motion may drop the accompanying transition but must never
remove the reach.

## D-022 — Stack and List are one model, two presentations

**Status:** accepted

The Layers experience supports activate, add, rename, visibility, lock, opacity,
delete, and reorder. Both presentations reach them through `LayerActions`, and neither
stores a layer field of its own. Switching views is a change of presentation and
creates no History.

Equivalent actions carry equivalent document and History semantics even where the DOM
differs — including the continuous opacity transaction, which both views must resolve
on every exit, cancelling when their control unmounts mid-interaction.

**Consequence:** a capability is added to the model first and surfaced in both views, or
in neither. An operation the model does not support — duplicate, merge, flatten, blend
modes, grouping, masks — is offered by neither.

## D-023 — `.folio` is the canonical, platform-neutral project format

**Status:** accepted

One JSON document holds project metadata and the whole sketchbook — pages, layers,
objects, ink with its pressure dynamics, paper — discriminated by
`format: "folio-project"` and an explicit `formatVersion`. Decoding validates and
bounds its input rather than trusting it.

**Consequence:** the same bytes mean the same project on any host, so a future tablet
or web client reads what the desktop wrote. Nothing host-specific may enter the format,
and a change to what it means is a version change, not an in-place edit.

## D-024 — Where a project lives is host state, not project data

**Status:** accepted

A file location belongs to the session that opened it. Paths stay in the Electron main
process; the renderer holds an opaque capability id for the current save target and for
each recovery record, and can only name operations those ids permit.

**Consequence:** the project file never records its own location, a filename never
becomes the project's title, and Save As does not rename the project. The renderer
cannot list a directory, read an arbitrary file, or learn where anything is, so a
compromised renderer gains no filesystem reach.

## D-025 — Dirty state is content identity; checkpoints are runtime-only

**Status:** accepted

Every committed document state has a runtime identity. A project is dirty when its
current identity differs from the one a durable write or load actually confirmed.
History entries carry the identities they move between, so undo and redo restore
identity rather than recomputing it, and undo depth is never used as a proxy for
dirtiness.

**Consequence:** undoing back to a saved state is clean again and redoing is dirty
again, without hashing the project or writing anything. These identities describe one
run and are never serialized. Only a confirmed result may set a checkpoint: an
unconfirmed write leaves the previous one standing.

## D-026 — Replacing a project is transactional and guarded

**Status:** accepted

New, Open, recovery, and window close all pass through one guard offering Save, Discard
or Cancel, and then through one transactional activation: a candidate is prepared and
armed before the authority changes, and the outgoing project is disposed only after the
incoming one is live.

**Consequence:** Discard is permission to replace, never an instruction to clear, so a
failed activation leaves the current project untouched. A save that cannot be confirmed
blocks the replacement rather than assuming the disk took it. New entry points reuse
this guard instead of carrying a copy of it.

## D-027 — Recovery is separate from the project file, and recovered work is detached

**Status:** accepted

Background snapshots of unsaved work live under the application data directory in their
own `folio-recovery` envelope, which embeds the canonical project payload. They never
write to the user's `.folio` and never change its checkpoint, dirty state, or backing.
Recovered artwork is activated with no file and no checkpoint.

**Consequence:** recovery can never overwrite artwork it was rescuing, because the next
save asks where to put it; opening the original is a separate, deliberate choice. A
valid record is never deleted for being old, and is consumed only after the replacement
it produced has committed.

## D-028 — A stroke names its render strategy, and a shipped strategy is frozen

**Status:** accepted

`ResolvedBrushSnapshot.renderer` carries `(kind, version)`, and a static registry resolves
that pair to the code that draws it. One set of identities in `@folio/ink` is the whole
vocabulary; the codec validates through it rather than repeating literals, and a test
asserts the vocabulary and the registry list the same identities.

A shipped pair draws the same pixels for ever. `centerline@1` and `outline@1` are frozen at
what they drew before the vocabulary existed, including centerline's stroke-wide average
width. A strategy whose appearance must change ships as its next version, and old strokes
keep naming the one they were drawn with.

An identity this build cannot draw is refused by name, and the refusal is the whole decode.
Answering it with a nearby strategy would open the project while silently redrawing
somebody's artwork, which is worse than not opening it, because only one of those is
visible to the person who drew it.

**Consequence:** adding a strategy means adding an identity to the vocabulary and the
registry together, never editing an existing one. `.folio` `formatVersion` does not change,
because the document shape does not: what grows is the set of legal values inside a field
that already existed. A file written by a newer build will not open in an older one, which
is ordinary forward-incompatibility within a version rather than a format change.

## D-029 — Live brush evaluation is prefix-stable, not rebuilt

**Status:** accepted

A brush strategy that evaluates incrementally must produce the same geometry for a prefix
whether the stroke ends there or continues. `technical-pen@1` earns this at every stage:
smoothing reads a fixed window, decimation is causal, and a span is a centripetal
Catmull-Rom cubic reading one point back and two forward. Its spacing and tolerance come
from the brush's own width, never from the stroke's extent.

Geometry behind the settled watermark is computed once by exactly the function the
committed render uses, so a live frame costs the open tail rather than the stroke, and
committing replaces nothing. The newest sample is evaluated as terminal whether or not the
stroke has ended, which keeps the drawn tip under the pen and is what makes lifting it move
nothing.

**Consequence:** a new strategy either derives its parameters from the brush and its own
bounded neighbourhood, or it rebuilds per frame as the frozen legacy strategies still do.
Reaching for a whole-stroke statistic — a diagonal, a mean spacing, an error budget fitted
across every sample — forfeits both properties at once. Live and committed must stay one
code path rather than two that are compared.

## D-030 — Pressure drives appearance only through the durable response, and alpha is painted in bands

**Status:** accepted

`pressure-pen@1` varies width and opacity within a stroke. Both come from the responses
the model has carried since Phase 17A and from nothing else: width is `brush.size` times
the `pressureSize` response, alpha is `brush.opacity` times the `pressureOpacity` response,
each applied exactly once. No second pressure model, no function-valued curve, no velocity
term. `pressureOpacity` was durable, validated and serialized but never evaluated; this is
what closes that gap, and it changes nothing about what a stroke already on disk means.

Canvas 2D has no alpha that varies along a path, and painting each span separately would
composite overlaps twice — a stroke that darkens at its own joins, which is the failure
`outline@1`'s single fill exists to avoid. So a run of samples at a similar alpha becomes
one closed shape filled once. Consecutive bands are cut at the midpoint of the span between
two samples, from that span's own direction, and **both** bands are given the same two
points: they tile along a shared edge instead of overlapping across one. A deadband of one
part in sixty-four and a minimum band length bound how many fills a stroke costs; a brush
with the response disabled is a single band and a single fill.

A mouse reports a synthetic pressure fixed at 0.5, so it must not drive expression. An
`outline@1` preset answers that by resolving to the constant-width centerline strategy,
which is also far cheaper than its silhouette. A strategy that reads pressure per sample
answers it differently and better: it keeps its own strategy and resolves its responses
off, so the mark is the brush exactly as configured rather than wherever the middle of
somebody's curve happens to land. That resolution is recorded durably, so reopening
reproduces it.

**Consequence:** an appearance that varies within a stroke must be expressible as a
bounded number of uniformly-shaded, non-overlapping pieces, or it cannot be painted
honestly in Canvas 2D at all. Pencil and Marker will hit this harder than Pressure Pen did,
and the `stamps` primitive is where that goes — not a wider alpha-per-vertex fiction.
Taper stays out: it is a function of position along the stroke rather than of pressure, it
has no durable field yet, and bending a pressure curve to imitate it would put a lie in
every saved file.
## D-031 — Dry media varies by coverage, and its grain is a field in the artwork's own space

**Status:** accepted

`pencil@1` is the engine's first dry medium and its first stamped strategy. Two choices
carry it, and neither is about pencils: both are what D-030's consequence forces once a
strategy stops describing a continuous shape.

**Pressure moves coverage, not alpha.** Tone varies by *which marks exist* rather than by
how dark each one is, which is the only variation Canvas 2D can express without compositing
an overlap twice, and also what coverage physically is. The response it reads is
`pressureOpacity`: for a dry medium a lighter touch leaves less graphite rather than
translucent graphite, so "how much medium pressure lays down" is the honest reading of that
field. It is a per-strategy reading of one durable field rather than a second field, and
`(kind, version)` pins it for ever. Width still comes from `pressureSize`, as it does
everywhere else.

**Overlapping medium is merged into runs, and runs are laid out not to overlap.** A
stamped medium's placements overlap by construction, and the naive form — one contour per
placement, all in one `fill()` — is not merely slow but quadratic: Canvas 2D resolves a
path's contours against one another, and six thousand of them in one fill measured 155 ms a
frame where the same contours in batches of forty-eight measure 8.4 ms, at an equal vertex
count. So consecutive placements in one filament of the tip become one contour, and the
geometry then earns the right to be split: the filaments tile the tip and are moved by one
affine map of the lateral axis shared by all of them, so their order is preserved and none
can reach into its neighbour, and a streak stops short of where the next streak in that
filament begins. Disjoint contours can be batched; overlapping ones cannot. A stroke that
crosses itself still darkens where it crosses, exactly as `pressure-pen@1` does between
bands, and for graphite that is the right answer rather than a concession.

*(E4.1 replaced the first half of that mechanism. Disjointness was originally earned by
narrowing each mark before moving it, which left a sliver of paper between every pair of
filaments at every stamp — and a sliver present at every stamp is a continuous line down
the length of the stroke. Same guarantee, obtained from monotonicity instead of from a gap.
See D-032.)*

**Deterministic variation is addressed by place, not by index.** The seed is
`fnv1a32(stroke.id)` — already unique, already durable, already round-tripping, and the
right identity for duplication, since `cloneObject` reuses the same `Stroke` and a copied
mark keeps its grain. From it, `brushHash(seed, cellX, cellY, channel)` addresses a
two-dimensional lattice in painted page space through `Math.imul`, `^` and `>>>` only. The
brush-engine design proposed hashing the stamp *index* instead; that would fail twice over.
Overlapping stamps would disagree about where the paper's tooth is, so the gaps would fill
in solid at exactly the coverage where texture matters most. And the stamp count depends on
the rendered scale, so scaling an object would reshuffle every mark in it. A field survives
both: translation and rotation do not rebuild geometry at all, and a scale rebuilds it
against the same field at the same physical tooth size.

Because live drawing has no finalized stroke, the seed is an argument rather than something
read off one: `StrokeRenderer.beginStroke` passes the id `StrokeBuilder` fixed before the
first sample. Without that, live and committed would be different grain, and the
convergence contract would be false for every stamped strategy.

**Consequence:** a strategy's durable authority is the snapshot plus the samples plus the
stroke's own identity, and identity is now load-bearing rather than incidental. Any future
operation that rebuilds a `Stroke` under a new id silently redraws its grain. Nothing does
today — the codec, `cloneObject`, `applyInkStyle` and History all preserve it — and that is
a property to keep rather than a coincidence to rely on.

Grain parameters stay strategy constants. Hardness, grain strength, edge roughness and
spacing were all expected to become durable fields; none did, because no preset varies one
yet, and a durable field with nothing behind it is the mistake `pressureOpacity` and
`brushTextureId` each made once already. The phase that ships per-hardness pencils is the
phase that should add them. Tilt is ignored deliberately: a pencil that reads tilt is
`pencil@2`.


## D-032 — A stamped medium's structure must not be periodic, fixed, or shared across the tip

**Status:** accepted

`pencil@1` shipped correct and unusable to look at. It satisfied every contract in D-028
through D-031 — deterministic, prefix-stable, anchored in the artwork's space, coverage-
driven — and still read as a patterned brush rather than as graphite: a broad stroke came
out as a handful of parallel tracks of rectangular dashes, with a clean geometric edge
around a noisy interior. The architecture was not the problem. Every visible defect was a
regularity in the implementation that the eye could find.

**The rule: any structure a stamped strategy imposes across its tip must vary in the
artwork's space, and any limit it imposes along the stroke must be addressed rather than
counted.** Three corollaries, each of which was a defect first:

- **Divisions at fixed offsets paint rails.** A tip divided into filaments at constant
  lateral offsets repeats those offsets at every stamp, and anything repeated at every
  stamp is a line down the whole stroke — including the *gaps* between filaments, which is
  how the original earned its disjointness. Filament positions now come from two smooth
  fields in the artwork's space, applied as one affine map of the lateral axis shared by
  every filament of a stamp. Shared is what keeps them disjoint: an affine map moves the
  divisions without reordering them, so tiling survives and no gap is needed.
- **A shared limit puts a rung across the stroke.** A firm stroke saturates its core, so
  every filament inks from the same stamp; with one streak-length limit they also all *cut*
  on the same stamp, and the aligned gaps painted a faint rung every dozen page units. Each
  filament draws its own limit and its own phase from the seed.
- **A limit counted from a streak's own length is not a threshold on a field.** Cutting
  after N inked stamps makes the cut depend on how much graphite happened to land, so a
  firm stroke opens gaps a light one does not have — which silently breaks D-031's
  guarantee that pressure only ever reveals more of the same field. Cutting at addressed
  stamp positions restores it exactly: the covered area at a lighter pressure is now a
  strict subset of the area at a firmer one, and there is a test that samples the paper to
  prove it.

**Consequence.** The visual gate is not implied by the correctness gates, and the only way
to find these was to render and look. `pencil@1`'s freeze digests were therefore re-pinned
once, in E4.1, before the strategy had ever reached a release — the single circumstance in
which a shipped-looking identity may change what it draws, because no saved artwork could
yet be looking at it. After a release the same refinement is `pencil@2`, without exception.

Marker divides a wider tip into more of it, and will meet all three corollaries sooner.


## D-033 — A strategy version names its own built-in material resources

**Status:** accepted

A textured medium is made of resources — a nib, a sheet of paper — and a stroke has to name
them across a save. The obvious design puts a resource id in `ResolvedBrushSnapshot`. E4.2A
did not, and the reason generalises past Pencil.

**The rule: built-in material resources are named by the `(strategyId, strategyVersion)`
that reads them, not by a durable field of their own.** A stroke names `pencil@1`;
`pencil@1` names `folio.graphite.hb-tip.v1` and `folio.paper.graphite-tooth.v1`. The
binding is a function in the engine, and it is the entire durable contract.

Three things follow, and each was a cost avoided rather than a benefit invented:

- **No format change.** `.folio` `formatVersion` and snapshot `schemaVersion` both stay at
  1. The renderer field that already round-trips *is* the resource identity, so a whole
  class of material work needs no migration and no compatibility window.
- **No durable promise with nothing behind it.** A per-stroke resource id would be a field
  artwork could vary before any preset can vary it — the mistake `pressureOpacity` and
  `brushTextureId` each made once already. When an artist can genuinely choose a paper,
  that is the phase that should add the field, and it will add it knowing what it means.
- **A version is still the only way it moves.** A Pencil wanting a different nib is
  `pencil@2` naming different ids. That is what a strategy version is for, and it keeps
  resource identity under the same freeze rule as everything else a strategy draws.

**Consequences.** A resource is generated from pinned primitives rather than loaded, so a
build carries it; it is decoded once and shared, because a per-stroke copy of a sheet is as
many copies as there are marks on the page; and an unknown id **fails loudly**. Substituting
a nearby resource would open a project while silently drawing somebody's artwork
differently, which is worse than not opening it. `StrokeStyle.brushTextureId` remains dead
and must not be promoted into this contract: it is an arbitrary legacy string with no
resolver behind it, and giving it semantics now would make old artwork mean something new.


## D-034 — Deposited material is a derived cache the runtime owns

**Status:** accepted

A raster medium produces a great deal that is not artwork: dabs, a tile-to-dab index, field
tiles, deposited alpha. E4.2A settles where all of it lives, and the answer is a boundary
rather than a location.

**The rule: generated material is owned by the renderer/project runtime, and is reachable
from nothing else.** Not `Stroke`, not `PageDocument`, not `SketchbookDocument`, not
History, not `ResolvedBrushSnapshot`, and not the codec. Durable authority stays exactly
what it was: the source samples, the resolved snapshot, and the strategy identity in it.

This is not tidiness. The moment a tile is reachable from any of those, dropping it stops
being free, undo has pixels in it, a save has a cache in it, and a duplicated object shares
mutable state with its original. Every guarantee the material model makes — bounded memory,
free eviction, transient pixels — is a consequence of this one boundary, which is why it is
recorded as a decision rather than left as an implementation detail.

What makes the boundary affordable is **exact independent reconstruction**: one tile
rebuilds alone, in any order, from the index and the snapshot, byte-identical to a full
build, and the live and cold paths run the same equation rather than two that agree by
inspection. A medium with a drawing algorithm and a separate redraw algorithm changes under
the artist the first time a cache is dropped.

**Consequence.** Budgets, eviction, scheduling and cancellation are free to be as aggressive
as they like, because none of them can change a pixel — they change only when one appears.
Marker will deposit into the same lattice and inherits this rule whole.


## D-035 — A deposited medium repaints its tail, not its stroke

**Status:** accepted

Every strategy before Pencil evaluates incrementally and then repaints everything. That is
affordable because what they repaint is contours, which are cheap to re-emit; the live
dirty rectangle grows monotonically and each frame redraws the whole mark clipped to it.
E4.2B found that exact code path in front of the material and it would have made a long
Pencil stroke cost more the longer the artist drew.

**The rule: a strategy whose output is pixels must report which of them changed, and a
frame must repaint only those.** The Pencil accumulator returns the tiles its last append
touched — the settled dabs it added, plus the provisional tail it rolled back — and the
renderer clears and redraws exactly those.

Two corollaries, both of which were needed to make it true rather than approximately true:

- **The cumulative rectangle and the frame rectangle are different things.** They were one
  variable, which is what made the repaint grow. Cancelling a stroke still needs the
  cumulative one, so both are kept and neither is used for the other's job.
- **The provisional tail is undone by region, not by rebuild.** The cells the tail will
  touch are copied out before it is deposited and copied back on the next frame: seven
  bytes per touched cell, for the area the tail covers rather than for every tile it lands
  in. Re-depositing the settled prefix instead would be work proportional to the stroke,
  which is the thing being avoided.

**Consequence.** Every live measurement in the prototype evidence assumes this, so without
it none of those numbers describe the shipped editor. Marker will emit pixels too and
inherits the rule whole.


## D-036 — Deposited material belongs to the artwork, so scale scales it

**Status:** accepted

Folio's Ink transform is scale-compensated: a strategy divides its lengths by the rendered
scale and the compositor multiplies them back, so an enlarged stroke is a longer mark of
the same painted width. That is the right reading for a mark described as geometry, where
width is a property of the instrument.

A deposited medium cannot honour it without giving up something more important. The sheet
is addressed in page space — that is what makes pressure reveal *the same* paper and a
retrace find its own mark — so redepositing at a new scale resamples the sheet, and an
object that was only resized comes back a different drawing.

**The rule: material is deposited once, in the frame the artist drew it in, and an object
transform is applied to the finished material when it is painted.** Translation and
rotation move the marks that were made. Uniform scale scales them, the way scaling a
photograph of a drawing does.

**Consequences.** `pencil@1` ignores `renderedScale` entirely, so its committed geometry is
cached once per stroke rather than once per zoom level, and its freeze digest is the same
at every scale — which is now itself the thing the freeze test pins. Selection frames and
bounds follow automatically, because local bounds are unscaled and the transform is applied
outside them. Pencil and the pens therefore disagree about what scaling an object means,
and that disagreement is deliberate: it is the difference between an instrument and a
material, and the alternative is a medium that changes when it is moved.


## D-037 — A derived cache is keyed by what it was derived from

**Status:** accepted

`applyInkStyle` builds a new `Stroke` with the **same id** and a different width, opacity or
colour. E4.2B keyed the Pencil material cache on the stroke id, so a restyled mark was served
the graphite of the mark it used to be — and width and opacity are both inside the deposited
bytes, so this was wrong material rather than merely a stale tint. It shipped undetected
because no test restyled a Pencil stroke and looked at the pixels.

**The rule: a derived cache is keyed by every input its contents depend on, not by the
identity of the thing it belongs to.** Pencil material is keyed by the stroke id *and* a
digest of the resolved appearance the deposition reads: width, opacity, smoothing and both
pressure responses, plus the strategy version that names the resources.

The corollary is the interesting half. **Colour is deliberately excluded.** Material is
colour-neutral and the tint is applied when a tile is painted, so folding colour into the
material key would throw away expensive graphite to fix a cheap tint. The presentation
records the colour it was built with instead, and a painter that meets one in the wrong
colour rebuilds only that. Two derived things, two keys, each holding exactly what it
depends on.

**Consequence.** Any later cache over resolved appearance — Marker's material, a cached
export, a thumbnail — inherits the same obligation, and identity alone is never sufficient
while `applyInkStyle` preserves it.


## D-038 — A diagnosis is a measurement, and a frame gap is not a long task

**Status:** accepted

E4.2B recorded a ~212 ms frame and attributed it, by reasoning, to seventy presentation
canvases being built in the frame that first painted a committed stroke. E4.2C was opened to
slice that work. Instrumenting it first showed the attribution was wrong in every part: a
whole workload builds twenty-five presentations totalling under five milliseconds, the long
frame happens a second and a half into *drawing* rather than at commit, and committed
geometry — the one step proportional to the whole mark — costs four milliseconds.

Two rules came out of it, and the second is the one that made the first possible.

**Measure before attributing.** A plausible mechanism that scales the right way with the
right input is not evidence. The presentation hypothesis was plausible, scaled with brush
size, and was wrong; ten minutes of counters settled what a paragraph of reasoning could
not.

**A frame gap and a long task are different measurements.** `requestAnimationFrame` is
driven by the compositor, so a gap can open because the GPU process is busy while the main
thread sits idle. Only a long task means JavaScript held the thread. The performance spec
now records both, and any claim that the editor *blocked* has to cite the second.

**Consequence.** The remaining ~230 ms event at twenty-six page units is a major collection:
it registers as a long task, scales with allocation, and vanishes under both a CPU profile
and a timeline trace. It is recorded as a memory-profile characteristic with its evidence,
rather than assigned a cause it has not been shown to have. Removing the two largest
per-frame allocators did not move it, and that is reported as a result rather than omitted.


## D-039 — Abutting tiles are placed on whole device pixels, not on exact coordinates

**Status:** accepted

Two neighbouring material tiles meet exactly in page space, and the deposited alpha runs
across the join without a step. Broad Pencil still showed a pale grid, because neither fact
survives rasterization: **each `drawImage` is antialiased on its own**, so a shared boundary
falling between two device pixels is covered partly by one tile and then partly by the
other, and two partial coverages composited with `source-over` do not add up to one.

Measured with uniform tiles, so that nothing but the compositor could vary: body tone 80,
seam tone 86–118, at exactly `floor(n × pitch)`. It appears wherever the pitch is fractional
— 64 × 1.93 = 123.52 — and, because panning is continuous, at *every* zoom once the camera
sits on a fractional offset. At 0.8 the boundaries that happen to land on whole pixels have
no seam at all, which is the mechanism confirming itself.

**The rule: a tile is placed by whole device pixels, and both neighbours derive their shared
edge from the same page coordinate through the same rounding.** They agree on it exactly, by
construction rather than by luck. Nothing is antialiased and no pixel is left partly covered.

Two consequences worth stating, because both were found by measuring rather than by
reasoning:

- **The snapped rectangle is expressed in device space, under the identity transform.**
  Going back to page space reassociates the arithmetic, and `(l − e) / a + (r − l) / a` is
  not `(r − e) / a` in floating point. In the running editor the page-space form disagreed
  on ten of thirty shared edges at 150%; the device-space form on none at any zoom. The
  disagreement was far too small to rasterize differently, and it was still wrong.
- **It applies only to an upright transform.** Under rotation there is no device axis to
  snap to and the seam is not an axis-aligned line, so the exact rectangle is kept.

What is left is at the level of the paper's own texture: folding the tone across sixteen
offsets inside a tile, the boundary went from the lightest of the sixteen in eleven of twelve
conditions to exceeding the worst ordinary column by at most a tenth of a tone. The residue
is bilinear clamping at a tile's own edge, and the remedy — a one-pixel gutter — would make a
presentation depend on four neighbours' material. That trade is recorded and not taken.

**Consequence.** Any later medium that composites a lattice of separately rasterized tiles,
Marker included, inherits this: abutment in the artwork's coordinates is not abutment on the
screen.

## D-040 — A representation is retired only once its replacement is on screen

**Status:** accepted

A finished Pencil stroke leaves the live ink layer and arrives on the compositor that keeps
it. Finalizing cleared the live layer synchronously while the compositor's repaint was
requested through `requestAnimationFrame`, so the two landed in different frames, and the
mark the artist had just finished was on neither surface in between. Sampling every animation
frame across pointer-up: one frame with nothing, then a frame carrying **46%** of the mark,
then the whole of it about 20 ms later.

**The rule: a completed mark is on one surface or the other in every frame, whole, and on
only one of them.** Two separate causes had to be fixed to make that true, and they are
different kinds of mistake.

**The blank frame was ordering**, and was fixed by ordering — flushing the render the
document change has already asked for, so both surfaces change inside one task and the
browser composites them together. Not a delay, not a held copy: the work that was going to
happen next frame happens in this one. Keeping the live layer's copy until the compositor was
ready would have needed cross-layer lifetime state, could strand a stale copy when the object
is undone or moved, and would composite the mark twice while both were up.

**The partial frame was a good rule meeting the case it was not for.** Building at most eight
presentations a frame protects a cold viewport of a large project, where hundreds want
presenting at once and none is urgent. A mark the artist has this moment finished is the
opposite in every respect — few tiles, material already in hand because it was adopted rather
than rebuilt, and every bare tile a hole in artwork that was whole a moment ago. So the
runtime marks a stroke as *handing over* when it adopts its material, and a stroke handing
over finishes in one frame; the handover ends the first time the mark is painted whole.

**Consequence.** A limit that protects the general case needs to be asked whether the moment
of handoff is the general case. It usually is not: the tiles are few, they are hot, and the
artwork is already on screen. Marker inherits both halves of this.


## D-041 — A tile is placed, cleared and clipped on the same grid, or it is not aligned at all

**Status:** accepted

D-039 put a tile's *destination* on whole device pixels and broad Pencil still showed a
grid while it was being drawn. Alignment is not a property a drawing operation can have on
its own: the live path repaints a tile by clearing it and redrawing it, and the clear and
the clip were still derived from page coordinates. A `clearRect` whose edge falls between
two device pixels is antialiased, so the straddled pixel is *partly* erased — and what is
partly erased is the neighbouring tile's graphite, while the neighbour is not dirty and is
therefore not redrawn.

Measured on the live layer against fifteen ordinary columns of the same mark: **thirty-two
units of graphite short along every tile boundary, nine standard deviations out**, at 300%
and at 664%. It was invisible on the compositor, which redraws whole objects and never takes
the per-tile clear path — which is exactly why the lines changed appearance when the pencil
was lifted, and why that change was the clue rather than a second defect.

**The rule: every operation that participates in repainting a tile — placing it, clearing
it, clipping to it — asks the same thing where the tile goes.** Not three roundings that
agree in most cases, one answer used three times.

**Consequence.** A partial repaint is a contract between a clear and a draw, and any
quantisation applied to one is a change to the other. The same applies to any later medium
that repaints by region.

## D-042 — An experiment that cannot fail has not been run

**Status:** accepted

D-039 was verified with a controlled comparison that rendered tiles of **uniform** material
and found the tiled path pixel-identical to a contiguous reference. Clamping a constant field
returns the same constant, so that experiment could not have detected edge sampling under
any circumstances. It did not confirm the fix; it confirmed that the question had been asked
in a form with one possible answer. The residual it reported as "at the level of the paper's
own texture" was a real defect, and a person found it at 664% after it had been documented
as acceptable.

Repeated with a *varying* field, the same comparison isolates the defect exactly: zero
difference from the reference everywhere, except 10.5 tone units within one pixel of a
boundary, and only once a tile is magnified past 1:1.

**The rule has two halves.** A verification must be able to produce the failing answer —
construct the experiment so that the defect, if present, has somewhere to show. And when a
measurement reports no defect, that is a fact about the measurement until it has been shown
to be sensitive to the thing being measured.

The corollary is uncomfortable and is kept here deliberately: this seam preserves average
tone, so a brightness statistic reads 0.3σ, and it is flanked by flat clamped runs, so an
averaged gradient reads below its own controls. **No statistic available in the running
editor resolves it.** It was settled against ground truth in a fixture, and confirmed by
magnified pictures. A defect that measurement cannot see is still a defect, and the right
response is a better experiment rather than a conclusion that nothing is wrong.

**Consequence.** Where a derived cache is sampled rather than blitted, correctness is
checked against a contiguous rendering of the same data, not against its own neighbours.

## D-043 — A sampled tile carries its neighbours' edge, and depends on them one deep

**Status:** accepted

A tile scaled up is resampled, and a bilinear filter asked for a pixel at the tile's own edge
needs a sample from beyond it. Holding only its own cells, it clamps and repeats the edge
cell, and the texture stops dead along the boundary. So a Pencil presentation is 130 cells
square where its tile is 128, and the painter blits the inner square and lets the filter
reach into the ring. One cell is sufficient and two measure no better, because the filter
never reaches further than one sample.

Three rejected alternatives, each for its own reason. **Expanding the destination rectangle**
would overlap neighbours and composite semi-transparent graphite twice, trading a pale grid
for a dark one. **Repeating the tile's own edge** is the clamp being replaced. **Turning off
image smoothing** removes the seam by replacing the whole resampling with a worse picture,
which is hiding a defect rather than fixing one.

Depending on neighbours has to be paid for honestly. A presentation built while a neighbour
was missing is wrong once it arrives, so the runtime records which directions went short and
drops exactly those; one that found everything is already right and is left alone. **The
dependency is one tile deep in every direction.** The scheduler does the rest by ordering —
a job deposits everything it owes before presenting any of it, because interleaving would
present a tile, invalidate it with the next, and present it again.

Cost: 67,600 bytes a presentation rather than 65,536, 3.1% more, charged to the same budget.

**Consequence.** Marker inherits this with its own material. More generally: a tile that
will be *sampled* rather than blitted is not self-contained, and the cache that owns it is
the only thing that can complete it.
## D-044 — An approved appearance is frozen by pinning what it is

**Status:** accepted

The artist has looked at the production Pencil and approved it, which moves `pencil@1` from
the engine's business to artwork's. The next phase goes after the collection pause, and that
means rewriting allocation, buffer reuse, eviction and scheduling underneath a mark that is
not allowed to change. An agreement not to touch the appearance is not a mechanism; the
mechanism is a pinned value.

What is pinned is the **result**, in page coordinates: a digest of every inked cell of each
of eleven fixtures, the three readings of one path under low, medium and firm pressure, and
the two generated fields the mark is made of. Page coordinates rather than tiles, because
tiling is a cache decision and a later phase may change it without re-pinning the artwork. A
digest per fixture rather than one over the set, because a failure then names the mark that
moved.

What is **not** pinned is every incidental runtime mechanic: scheduler timing, eviction
order, memory layout, allocation strategy, Canvas reuse, queue implementation. Those are the
subject of the next phase, and freezing them would freeze the wrong thing.

The three deposition paths deserve a note of their own. That live, committed and cold
agree **with each other** was already tested, and that test cannot see a change that moves
all three together — which is the exact shape of a memory optimization. So the frozen value
is asserted against the paths rather than between them.

**Consequence.** Every shipped strategy is accounted for by a gate that pins its pixels,
checked by a roster test, so a strategy cannot ship without one. A refinement to an approved
appearance is a new strategy version — `pencil@2` — and never an edit to a pinned digest. The
three strategies that have shipped have never moved; Pencil's were re-pinned twice before
approval, and that is now over.
