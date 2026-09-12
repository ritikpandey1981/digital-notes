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

**Status:** accepted

Committed strokes retain exact useful source/process samples, including timing,
pressure, tilt, twist, buttons, and device information. Smoothing and fitted geometry
are derived views. Existing centerline and outline strategies are the rendering
boundary.

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
