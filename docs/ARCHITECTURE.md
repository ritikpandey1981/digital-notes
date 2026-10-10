# Folio architecture

This is the durable description of the implemented Folio system. It describes the
current code, not a proposed end state. Decisions and trade-offs are recorded in
[`DECISIONS.md`](DECISIONS.md); unfinished work is in [`ROADMAP.md`](ROADMAP.md).

## System context

Folio is a pnpm workspace containing an Electron desktop application and focused
TypeScript packages. The renderer is React, while artwork presentation and
interaction use Canvas 2D and imperative controllers.

```text
Electron main/preload
        |
        v
React desktop workspace
        |
        v
@folio/editor  -- orchestration and document commands
   |       |       |        |          |
   v       v       v        v          v
document history  ink   selection  manipulation
   |                         |          |
   +-------------------------+----------+
                    |
                    v
                rendering
```

The diagram shows responsibility, not every package dependency. Package manifests are
the authority for actual import edges.

## Package boundaries

| Area | Responsibility |
| --- | --- |
| `apps/desktop` | Electron lifecycle, React workspace, editor chrome, floating surfaces, and product composition |
| `packages/document` | Live `SketchbookDocument`, pages, layers, and page objects |
| `packages/editor` | Live session, command adapters, editing workflows, tools, color, and UI-facing controllers |
| `packages/history` | Generic command execution, bounded stacks, transactions, notifications, and legacy compatibility |
| `packages/ink` | Immutable strokes, source samples, brush snapshots, input normalization, smoothing, and geometry |
| `packages/rendering` | Canvas controller, camera/viewport, coordinate conversion, render scheduling, and overlays |
| `packages/selection` | Low-level selection state and hit testing for one primary identity |
| `packages/manipulation` | Model-neutral translation, rotation, scale, delete, and duplicate results |
| `packages/domain` | Older notebook model retained for the legacy folder persistence path |
| `packages/persistence` | Canonical `.folio` project codec, plus folder save/load and recovery for the older notebook model |
| `packages/ui` | Shared React UI primitives |

`packages/search`, `packages/shared`, and `packages/testing` currently expose empty or
minimal package shells. They are not part of the live editor architecture.

## Live document model

```text
SketchbookDocument
  ordered Page[]
    Page
      id, name, geometry, paper
      PageDocument
        ordered Layer[]
          Layer owns ordered PageObject IDs
        ObjectCollection
          canonical flattened PageObject[]
```

Each page owns independent content. Page order is the array order. Page geometry holds
width and height; orientation is derived from them. Resizing changes the page boundary
without destructively moving or deleting artwork outside it.

A `PageDocument` exposes layers and a canonical flattened `ObjectCollection` together.
Its constructor validates that every visible layer membership and the flattened order
agree. This prevents a layer tree and renderer order from becoming separate truths.

`PageObject` is the common immutable object boundary. Implemented object kinds are:

- Ink
- Line
- Rectangle
- Ellipse

Objects do not carry page or layer ownership. A `Layer` owns object IDs, and its
position in the layer array plus ID order establishes the flattened bottom-to-top
order. Object `zIndex` is normalized from canonical collection position; it is not a
second ordering authority.

Paper belongs to page state. It is not a PageObject, Layer, workspace theme, or editor
preference. Paper renders beneath artwork and remains page-anchored through viewport
changes.

## Immutability and mutations

Documents, collections, objects, strokes, presets, and command payloads are immutable
at their public boundaries. A mutation produces a validated successor rather than
editing shared state in place.

The live session is `InkDocumentSession`, which implements the generic
`HistoryDocumentSession<SketchbookDocument>` contract. Editor actions flow through a
coordinator and a command:

```text
pointer / keyboard / UI
  -> editor action or manipulation result
  -> command adapter
  -> History controller
  -> immutable SketchbookDocument successor
  -> rendering and UI projections
```

Commands own document-specific validation. The generic History package does not know
about pages, layers, ink, or vectors.

## History

The generic editor History surface stores commands in bounded undo and redo stacks.
Execution, undo, and redo ask a document session to install immutable successor state.
Transactions are non-nested and group several commands into one logical entry. Commit
publishes the group; rollback restores the original state.

Interactive preview is not History. Continuous style edits retain the original object,
install immutable preview replacements, then restore the original at the boundary and
execute one original-to-final command on commit. Cancel restores the original and adds
no entry. This pattern is used for vector and selected-Ink style editing.

The package also retains an older notebook `HistoryManager` and snapshot-based command
support for compatibility with `@folio/domain` and `@folio/persistence`. That surface
is not the live sketchbook editor's architecture.

## Session state

The editor session owns state that is important to interaction but is not artwork:

- active page ID;
- active layer per page;
- viewport per page;
- primary and logical multi-selection;
- clipboard and paste ordinal;
- current tool and drawing-slot preferences;
- transient previews, open surfaces, hover, and cursor state.

None of this enters document History. It is currently session-scoped unless a later
decision deliberately defines persistence for a preference.

## Rendering and viewport

`CanvasController` owns the canvas, `Viewport`/camera, renderer, request-driven render
scheduler, overlay layers, device-pixel-ratio handling, resize handling, and context
loss recovery. There is no continuous render loop; invalidation coalesces work onto an
animation frame.

The unified compositor paints page presentation and the canonical mixed-object order.
Viewport zoom is a canvas transform and does not mutate document geometry. The viewport
keeps at least 64 CSS pixels of the page recoverable so users cannot permanently lose
the page by panning.

Coordinate conversion is the single path between screen, canvas, viewport/world, and
page space. Selection and manipulation receive explicit page-coordinate adapters
instead of creating competing transforms.

Committed ink visuals are cached by immutable Stroke identity and object scale. Both
outline and compositor scale caches are bounded. A redraw still scales with visible
object count even when geometry is cached. During an active transform, the transient
overlay is fully cleared on each scheduled frame to prevent preview smearing.

## Preview rendering primitives

Three pure functions in `@folio/editor` draw a page into an arbitrary context at an
arbitrary size. They share one page-fit and clip path, so their output aligns exactly:

| Primitive | Draws |
| --- | --- |
| `renderPageThumbnail` | one complete page: paper, then every layer in canonical order |
| `renderPagePaperPreview` | the page's paper color and pattern only — no layers, no objects |
| `renderPageLayerPreview` | exactly one named Layer's artwork on a transparent surface |

All three reuse the same per-object draw helpers as the live compositor, so a preview
cannot drift from the canvas. They are pure functions of the page: no controller, no
viewport, no History, no document mutation, and no dependence on which Layer or page is
active.

A layer preview paints no paper color, pattern, or background fill, so the surface keeps
real alpha wherever the Layer has no marks. That is what lets several be stacked over one
paper base and reproduce the page instead of each upper layer hiding everything beneath
it. It honors real layer visibility, real layer opacity, and canonical object order, and
it uses the whole page as its coordinate frame so previews of different Layers line up.
Naming a Layer the page does not own throws `LayerMembershipError`; an unknown id is
never treated as "every layer".

Paper stays Page state throughout. These primitives must never be satisfied by
introducing a Background Layer, a Paper Layer, or a synthetic PageObject.

## Spatial Layers

The Layers experience has one entry point and two presentations:

- **Stack** — a modal structural visualization of the active page's Layers as separated
  sheets in perspective, above the page's own paper base. It is the default.
- **List** — the existing `LayersPanel`, an ordinary floating panel for layer
  management. It does not inherit the Stack's modality.

Each sheet is a real canvas painted by the preview primitives above, so the arrangement
shows the artwork the compositor draws rather than an illustration of it.

**Presentation boundary.** The Stack transforms presentation surfaces only. It never
mutates PageObject geometry, `PageDocument`, Layer membership, `ObjectCollection` order,
page geometry, or the canvas viewport. Its geometry model is pure maths over measured
workspace space and owns no DOM, document, or state.

**Session ownership.** The active Layer is session state. The focused sheet is *derived*
from the active Layer id rather than stored, so the two cannot disagree. Whether the
experience is open, which presentation it shows, and where the arrangement sits are all
session state. Nothing the Stack does produces a document History entry.

**Input ownership.** While open or opening, the Stack owns page input: the canvas
beneath it is inert, and sheets accept presses only once they have stopped moving. The
moment it begins closing it stops intercepting pointer events, even though it is still
visibly collapsing, so it cannot swallow the next stroke. A page change ends the Stack
rather than rebuilding it for the new page.

**Navigation.** There is no scroll container, scrollbar, or reserved gutter. The
arrangement is positioned by one offset computed from the focused Layer, so there are no
arbitrary in-between positions. Wheel, click, arrow keys, Home/End, and any external
change to the active Layer converge on one focus path, which makes activation the whole
move. The paper base is structural and is not addressable by navigation.

**Truthful presentation.** Sheets far from the focus position fade out of the
composition, but they stay mounted, navigable, and in the accessibility tree; each
carries its real name and its real hidden/locked state. Sheet size does not depend on
the layer count, so a deep document keeps full-size sheets and a taller arrangement
rather than shrinking into a compressed overview.

**Layer operations.** Both presentations reach one mutation surface, `LayerActions`:
activate, add, rename, visibility, lock, the continuous opacity transaction, delete,
and reorder. The focused sheet carries the stack's controls; the list carries them per
row. Neither view stores a layer field of its own, so switching between them is a
change of presentation and never a change of state. Duplicate, merge, flatten, blend
modes, grouping, and masks do not exist in the model and are therefore offered by
neither view.

**Reorder.** Dragging a sheet is presentation until it is dropped: the candidate
position is transient, and the document sees exactly one `moveLayer` command carrying
the whole move, or none when the destination is unchanged. Display order is mirrored
into canonical storage order by the single resolver the list already uses. Because the
focused sheet is held on a shelf near the bottom of the workspace, some destinations
are off-screen at supported window sizes; holding near a structural edge slides the
arrangement under the held sheet, which is transient exposure that never changes the
active layer and never reaches History.

## Input and ink

`PointerInputController` accepts the primary mouse, pen, or touch pointer, captures it,
and expands coalesced events. It normalizes samples once through the coordinate path.
Mouse uses a fixed pressure fallback of `0.5`.

An accepted stroke retains exact source/process samples, including available timing,
pressure, tilt, twist, buttons, and device type. Derived render points, fitted curves,
and outlines never replace those samples. Tilt and twist are retained data but do not
currently affect rendering.

Input cancellation clears transient work without committing. Covered boundaries
include `pointercancel`, lost capture, an uncaptured leave, tool detach/switch, and
window blur. A completed stroke becomes one immutable Ink object and one History
command.

A committed stroke names its render strategy durably, as `(kind, version)` on its
resolved brush snapshot, and a static registry resolves that identity to the code that
draws it. Four strategies are implemented:

| Strategy | Behavior |
| --- | --- |
| `centerline@1` | constant width from one stroke-wide average; frozen |
| `outline@1` | pressure-aware filled silhouette; frozen |
| `technical-pen@1` | deterministic constant-width stroked path |
| `pressure-pen@1` | pressure-driven variable width and opacity, filled |

`centerline@1` and `outline@1` are compatibility strategies: artwork already saved names
them, so what they draw does not change. A strategy whose appearance must change ships as
the next version of itself. An identity this build cannot draw is refused by name, never
answered with a substitute.

Mouse input can legitimately resolve an expressive `outline@1` preset to centerline
behavior because its pressure is fixed and its silhouette is expensive. The two engine
strategies need no such swap: Technical Pen has no pressure response to downgrade, and
Pressure Pen at a constant synthetic pressure simply draws a constant width and a constant
alpha. There is no device-specific input code anywhere below the pointer boundary.

Pressure reaches appearance only through the durable `pressureSize` and `pressureOpacity`
responses on the snapshot. Width is the brush size times the size response; alpha is the
brush opacity times the opacity response, applied once. Because Canvas has no alpha that
varies along a path, Pressure Pen paints a run of samples at a similar alpha as one closed
shape filled once, and cuts consecutive bands on a shared cross-section so two alphas meet
on an edge instead of overlapping across one.

Both engine strategies evaluate incrementally. Geometry behind a settled watermark is
computed once and reused, so a live frame costs the open tail rather than the stroke, and
the picture a stroke has while it is drawn is the picture it keeps when it commits. The
frozen strategies still rebuild per frame, which is why long strokes remain expensive on
them.

## Selection, manipulation, and editing

`@folio/selection` deliberately remains a small, single-primary-selection and hit-test
foundation. `@folio/editor` adds logical multi-selection, marquee selection, overlap
cycling, combined bounds, and group workflows without widening the lower package.

Alt-click cycles eligible overlapping objects in deterministic topmost-first order.
Invisible and locked objects are excluded. The editor projects the final logical
identity back into the primary selection controller and overlay.

`@folio/manipulation` calculates discriminated translation, rotation, scale, delete,
and duplicate results. The editor converts those results to document commands. For a
duplicate, insertion occurs above the source when it is on the active layer; otherwise
the clone appends to the active layer.

The Select tool supports moving from the interior, scaling from corner handles, and
rotation from the top handle. Selection handle presentation remains constant in screen
space: the visible handle is 10 viewport pixels and the forgiving hit radius is 12.
Line editing uses endpoints plus a midpoint rather than a rectangular transform box.
Shift-constrained rotation uses absolute 15-degree increments.

Clipboard data is private to one editor session and contains ordered immutable object
references. Copy creates no History entry. Cut, paste, duplicate, and delete group
their object commands into one transaction. Paste uses fresh identities and applies a
common deterministic 20-page-unit offset per paste ordinal. The operating-system
clipboard is not involved.

## Vector creation and style editing

One Shapes utility chooses Line, Rectangle, or Ellipse. Pointer-down begins a draft;
pointer-up commits one insert command. Cancel commits nothing, and the chosen shape
kind remains armed. Shift constrains a line to 45-degree directions and rectangles or
ellipses to squares or circles.

Measurements are transient editor presentation: line length and mathematical
counter-clockwise angle, rectangle/ellipse width and height, and circle radius/diameter.
Vector width supports the implemented `0.5` to `40` page-unit range. Style changes on
a selected object use continuous command boundaries rather than per-frame commands.

## Tools and color

The desktop presents five stable drawing slots and three permanent utilities: Select,
Eraser, and Shapes. A slot is a physical location; any catalogue brush may occupy it.
Slot preferences are session state and do not enter History.

Artwork colors cross the editor boundary as canonical lowercase six-digit RGB hex.
The current color belongs to the active creation tool or selected-object target.
`EditorColorSystem` separately owns recent colors, favorites, palette definitions, and
the active palette. Recents have a capacity of 10; favorites have a defensive maximum
of 256. These collections do not own the current color and do not enter History.

All picker and eyedropper work uses a target adapter lifecycle:
`begin -> preview -> commit | cancel`. Creation-tool changes remain History-free;
selected-object commits produce one command. The eyedropper samples the composited
page, contains canvas read failures, and never weakens browser canvas security.

See [`design/drawing-tool-system.md`](design/drawing-tool-system.md) for the current UI
contract and known presentation gaps.

## Floating UI and accessibility

Floating surfaces share an ownership and dismissal stack. Escape dismisses the
topmost eligible surface. A press on the rendered page may dismiss a surface and
continue to the canvas; a press on the workspace surround is dismissal-only when that
is required to protect selection. Portaled descendants identify their owning surface.

An exiting surface disables pointer events immediately. Shared floating motion is
160 ms open, 120 ms close, 5 pixels of travel, with the professional easing curve
`[0.22, 1, 0.36, 1]`. Reduced motion keeps opacity-only presentation and disables
inertial brush-ring movement.

Tool navigation uses roving tab stops and Arrow/Home/End keys. Interactive text fields
retain text selection while editor chrome suppresses accidental label selection.

## Persistence

The live sketchbook has an end-to-end open/save flow, built on `SketchbookDocument`
rather than on the older `@folio/domain` Notebook model. The folder serialization in
`@folio/persistence` still serves that older model and is unrelated to the paths
below; the project codec in the same package is what the desktop editor uses.

### The project file

`.folio` is one canonical JSON document, discriminated by `format: "folio-project"`
and `formatVersion`, holding project metadata and the whole sketchbook: pages, layers,
objects, ink with its pressure dynamics, and paper. It is platform-neutral. Nothing
about where a file lives, what it is called, or which window opened it appears in it,
so the same bytes mean the same project on any host.

### Ownership

```text
ProjectSession        one project's lifetime: metadata, its document session,
                      and its content-identity/checkpoint state
ProjectRuntimeHost    one active project and at most one inert candidate,
                      swapped by a prepare -> arm -> commit -> dispose activation
```

A replacement is transactional. The candidate is prepared and armed before the
authority changes, and the outgoing project is disposed only once the incoming one is
live, so a failure anywhere along the way leaves the current project exactly as it
was.

### Dirty state and checkpoints

Every committed document state has a runtime-only content identity. A project is dirty
when its current identity differs from the last identity a durable write or load
actually confirmed, which is why undoing back to a saved state is clean again and
redoing is dirty again. Those identities never reach disk; they describe this run.

Only a confirmed Save or Open sets a checkpoint. A save captures artwork and identity
together, so editing that continues during the write stays dirty afterwards, and a
result Folio cannot confirm leaves the previous checkpoint standing.

Dirtiness is separate from risk. An untouched blank sketch is not dirty and is not at
risk; a project whose file could not be confirmed is not dirty but is at risk. New,
Open and Close consult risk, and the title marker shows dirtiness.

### Lifecycle and protection

One guard covers every destructive replacement -- New, Open, Close and recovery --
offering Save, Discard or Cancel. Discard is permission to replace, never an
instruction to clear anything: the current project survives until its replacement
actually commits. A save that cannot be confirmed blocks the replacement rather than
assuming the disk took it. Window close runs the same guard through an asynchronous
handshake with the main process.

### Crash recovery

A background snapshot of unsaved work is kept under the application data directory in
its own `folio-recovery` envelope, which embeds the canonical project payload. It
never writes to the user's `.folio`, never changes the checkpoint, dirty state, or
backing target, and is excluded during live preview gestures. At startup those records
are discovered, validated and offered; a valid record is never deleted for being old,
and is consumed only after the replacement it produced has committed. Recovered
artwork is deliberately detached -- no file, no checkpoint -- so the next save asks
where to put it and the original it was rescued from is never silently overwritten.

What recovery can protect is bounded and says so. The envelope ceiling is derived
from the project ceiling, so a snapshot that is accepted can always be read back; a
project past it is refused as `TOO_LARGE` and the artist is told their work is no
longer being kept a copy of, rather than the copy quietly failing. Discovery keeps
summaries only and decodes nothing, a record whose filename disagrees with what it
contains is not that record, and anything that is not a regular file is ignored.

Two separate questions decide when a snapshot is taken, and merging them would make
the wrong thing true in both directions.

*Is this state safe to serialize?* is settlement, and it is a question about the
document. A live preview gesture or an open History transaction means the document is
showing something a release of the pointer may take back, so it is not written.

*Should the renderer begin this work now?* is foreground activity, and it is a
question about the person. Encoding a project is hundreds of milliseconds of
synchronous work on the drawing thread, and a mark being drawn is not in the document
at all -- so a project stays perfectly safe to serialize for exactly as long as
someone is drawing it, which is exactly when serializing it is felt. A press on the
editor surface is therefore tracked on its own, separately from anything about
content, and a capture that comes due during one is held back rather than started.

Holding back never drops the requirement. The timer stays armed, the pending change
keeps the age it already had, and the capture runs at the first moment the hand is
free: promptly when the press committed nothing, and otherwise on the newer state's
own debounce, so a burst of marks still produces one snapshot of the latest state. The
age limit that stops continuous editing from starving recovery is a deadline for the
next safe moment rather than a licence to encode wherever it falls -- and it could
never fire inside a single mark anyway, because nothing is committed until the mark
is finished.

The cost is bounded and real: what a long interaction delays is the snapshot of content
committed just before it began, so a crash inside a long mark can lose the mark before it. The
bound is one interaction plus the settle. Once encoding has started it runs to completion;
this is scheduling, and the encoder itself is not preemptible.

## Electron boundary

The Electron main and preload code provide the desktop host. The React renderer owns
the live editor composition.

Paths live in main. The renderer holds opaque capability ids for a save target and a
recovery record, and the preload surface exposes only the operations those ids name:
it cannot list a directory, read an arbitrary file, or learn where anything is. Writes
are atomic -- a temporary file in the destination directory, then a rename -- so a
failed or interrupted write never destroys the previous good file.

Every file and recovery channel answers one sender: the trusted application document,
in the main frame of the window that registered it. A child frame, another window, or
the same window showing anything else is refused, and the channels stop answering once
that document navigates away, its renderer is gone, or the window is destroyed.

End-to-end tests launch the real Electron application. Screenshot output defaults to
Playwright's ignored test output; documentation screenshots are written only when an
explicit output directory is supplied.

## Future learning and AI boundary

Learning goals, analysis, guides, critique, and coaching remain transient by default:

```text
document/process context
  -> analysis
  -> transient guidance or suggested action
  -> explicit user acceptance
  -> normal Folio command
  -> History
```

No future system may silently mutate artwork or create parallel document, selection,
viewport, rendering, or History state.
