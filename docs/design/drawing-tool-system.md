# Drawing tool system

This document is the active product contract for Folio's drawing tools. “Current”
describes implemented behavior verified in the repository. “Future” items are gaps and
do not authorize implementation without a scoped brief.

## Current tool dock

The dock is one logical toolbar presented as two compact capsules:

- five stable drawing slots;
- Select;
- Eraser;
- Shapes.

The seeded drawing slots are Pencil, Pen, Brush Pen, Marker, and Highlighter. A slot is
a stable physical position, not a permanent brush family: any catalogue brush may
replace the brush in any slot.

The toolbar uses roving tab stops. Arrow keys move among tools; Home and End move to
the first and last tool. Each control has an accessible name and selected state.

## Slot activation

- Pressing an inactive drawing slot activates it and makes it ready to draw.
- Pressing the already-active drawing slot toggles its Radial Brush Library.
- Replacing a brush keeps the slot position and adopts the selected brush's family,
  tool identity, and preset defaults.
- The slot's current color is retained when its brush changes.
- A slot's settings belong to the editor session, not the document or History.

Slot glyphs currently communicate brush family. They are an honest interim symbol,
not a rendered preview of the exact configured stroke.

## Frozen dock and rail baseline

This presentation is approved and frozen. It is the result of rolling back a
Concepts-inspired selected-region experiment, so a future change that reintroduces any
of the removed treatments is a regression, not a refinement.

- Five generic configurable drawing slots, plus Select, Eraser, and Shapes.
- All five drawing glyphs display their own stored canonical drawing color, including
  while inactive. Inactive slot colors are never neutralized or desaturated.
- The selected slot uses Folio's standard selected-control treatment: the ordinary dock
  button on the soft accent background, and nothing else.
- No contrast backplate behind the glyph.
- No glyph keyline, halo, or frame, and no luminance-driven contrast metadata.
- No drawing-slot chevron.
- Tool Dock to Drawing Property Rail seam: approximately 3 pixels. The two read as one
  instrument rather than two panels.
- Property Rail width: 46 pixels.
- Icon-to-value spacing inside a rail row: approximately 2 pixels.
- Numeric values are deliberately stronger than the quieter property icons.

### Pending, not implemented

One deferred visual refinement is approved in principle and does **not** exist in the
code today:

- the selected drawing slot gains an approximately 2-pixel indicator on its **left edge
  only**, drawn in that slot's exact stored canonical drawing color.

Do not describe this as shipped, and do not implement it as a side effect of other dock
work.

## Slot state and History

Each drawing slot independently holds its brush identity and resolved creation
settings, including color, width, opacity, and smoothing. Changing a creation slot is a
preference change and creates no History entry. A stroke captures an immutable brush
snapshot at commit, so later slot changes do not alter old artwork.

When a selected object is the property target, the same UI must use the selected-
artwork continuous edit boundary. Preview remains temporary; commit produces one
command; cancel restores the exact prior object.

## Radial Brush Library

The current library is a transient radial chooser anchored to the active slot.

- Opening Tool Options closes the library, and opening the library closes Tool Options.
- Concentric rings rotate through brush identities with drag momentum/inertia.
- Reduced motion disables inertia while preserving full selection behavior.
- Cells expose radio semantics and descriptive accessible names.
- Escape participates in the shared last-opened-first-dismissed stack.
- A page press dismisses the library without consuming the intended canvas action.
- Lost pointer capture cancels an incomplete ring drag.

The catalogue exposes 45 named pencil/pen/marker identities but currently maps them
onto nine materially implemented presets. Several identities therefore draw
identically. Highlighter has no radial-library entry. The renderer supports centerline
and pressure-aware outline behavior; watercolor, pastel, airbrush, chalk, and textured
media are deliberately absent because those engines do not exist.

### Frozen radial contracts

The library is frozen. These are the product contracts and the settled values behind
them; the rest of the polar geometry is implementation detail in the model module and is
not restated here.

| Parameter | Value |
| --- | ---: |
| Hub radius | 90 px |
| Ring thickness | 64 px |
| Target cell width along the mid-radius | 72 px |
| Rings currently formed by the 45-entry catalogue | 4 |
| Ring drag threshold | 4 px |
| Open / close | 320 ms / 210 ms |
| Per-ring stagger along the open timeline | 26 ms |

Ring count is derived from the catalogue rather than configured, so the outer radius
follows from the hub, the thickness, and how many rings the entries fill. Only three
rings introduce a gap; the outermost inherits all three.

Durable behavior that must survive any retune:

- The axle is fixed at the selected drawing slot, which is what makes the wheel belong
  to that slot rather than to the workspace.
- Rings share one rigid rotation. They never turn independently.
- Gaps propagate outward deterministically: a ring inherits every gap introduced inside
  it and may add its own, so the empty space reads as a radial channel rather than being
  paved over by the next ring.
- Below the drag threshold a press is a selection; past it the gesture is a rotation and
  can no longer commit a cell.
- Release inertia is a bounded coast, not a spin: a slow scrub stops, a flick coasts and
  settles quickly, and a capped flick travels well under a quarter turn.
- Opening and closing traverse one choreography in opposite directions using a single
  curve, so interrupting an open continues from the current position instead of snapping.
- Reduced motion removes inertia and arrives at final geometry, without weakening
  selection, keyboard access, or dismissal.

## Drawing Property Rail

The current rail exposes four properties for the active drawing target:

- width;
- opacity;
- smoothing;
- color.

Width, opacity, and smoothing activate the existing Tool Options surface. Color opens
the Full Color Picker. This is routing through one state authority, not a duplicated
rail store.

Direct on-rail manipulation is a future refinement. Any such work must preserve the
same target, continuous-edit, and History rules.

## Tool Options

The options surface is descriptor-driven. It edits the active tool or selected artwork
through the corresponding adapter. Range input supports pointer, keyboard, wheel,
numeric, and accessibility/programmatic paths with explicit commit/cancel boundaries.

For selected vector or Ink style, one deliberate gesture must yield one History entry.
Pointer cancellation, Escape, blur, selection invalidation, object deletion, tool
switch, and unmount cancel the edit and restore the original.

## Brush model

Brush definitions are immutable and versioned. A committed Stroke stores the resolved
snapshot it used, independent of the mutable session preference that selected it.

Stroke source samples preserve:

- page position;
- timing;
- pressure;
- available tilt and twist;
- buttons and device type.

Rendering derives filtered points, fitted cubics, centerlines, and outlines without
replacing source data. Tilt and twist are captured but currently do not affect visual
output. Mouse pressure is fixed at `0.5` and must not drive expression: an expressive
`outline@1` preset resolves to its centerline fallback, and an engine strategy keeps its
own strategy but resolves its pressure responses off, so the mark is the brush exactly as
configured.

A stroke names its render strategy durably. Four exist. `centerline@1` and `outline@1`
are frozen so that artwork already saved keeps its appearance. `technical-pen@1` is a
deterministic constant-width solid stroke that ignores pressure for appearance while
keeping every pressure sample. `pressure-pen@1` drives both width and opacity from
pressure: width is the brush size times the `pressureSize` response, alpha is the brush
opacity times the `pressureOpacity` response, and the silhouette is filled rather than
stroked because a Canvas line has one width. Both engine strategies evaluate incrementally,
so a stroke looks the same while it is drawn as it does once committed. Two presets use
them — `pen-technical` and `pen-brush` — and every other preset is still on a frozen
legacy strategy.

Canvas has no alpha that varies along a path, so Pressure Pen paints a run of samples at a
similar alpha as one closed shape filled once. Consecutive bands are cut at the midpoint of
a span and share that cut cross-section exactly, so two alphas meet on an edge rather than
overlapping across one; a deadband and a minimum band length bound how many fills a stroke
costs. A hit test reads the variable-radius centerline the same geometry carries, so a
light start is not caught by a heavy end's width.

Nonzero smoothing derives coordinates with a deterministic symmetric triangular moving
average. The amount controls blend strength and a bounded one-to-four-sample radius;
endpoints stay fixed and corner retention limits smoothing through handwriting turns.
Pressure remains associated with monotonic source progression, including at
self-crossings. Centerline and outline strategies use fitted paths; an outline is one
filled path so joins do not accumulate opacity within a stroke.

Live rendering is frame-coalesced while useful input samples are retained. Long
outline strokes can exceed a 60 Hz frame at extreme point counts; preserve live/final
parity unless profiling justifies a different architecture.

One imperative brush cursor is limited to the visible page and does not update React
on pointer movement. Its CSS diameter is `max(7 px, nominal size × viewport zoom)`; DPR
does not affect the CSS overlay. It has contrasting inner/outer edges and hides for
touch, non-brush tools, pan, cancellation, or page exit.

## Select

Select is the universal editing tool.

- Drag an object's interior to move it (`grab` / `grabbing`).
- Drag a corner handle to scale.
- Drag the top handle to rotate.
- Hold Shift while rotating for absolute 15-degree increments.
- Alt-click cycles overlapping eligible objects in deterministic topmost-first order.
- Invisible and locked objects are excluded.

Visible selection handles remain 10 viewport pixels with a 12-pixel hit radius so
zoom does not make them unusable.

For a selected Line, endpoints edit the line while the opposite endpoint stays fixed;
the midpoint moves it. Rectangles and ellipses use their oriented transform frame.
Ink and multi-object selections use axis-aligned combined bounds.

## Shapes

Shapes is one permanent utility with three kinds:

- Line;
- Rectangle;
- Ellipse.

Rectangle is the initial kind. The last chosen kind is remembered when switching away
and back. Pointer-down begins a transient draft; pointer-up commits one insert command.
Commit or cancel leaves Shapes and its kind armed for the next object.

Shift may change during the gesture:

- Line snaps to 45-degree directions.
- Rectangle becomes a square.
- Ellipse becomes a circle.

Transient measurements show line length and mathematical counter-clockwise angle,
rectangle/ellipse width and height, or circle radius and diameter. They are editor UI,
not document content. Supported vector width is `0.5` through `40` page units.

The selected-vector toolbar is placed deterministically above, below, or beside the
selection while avoiding editor controls, using a 12-pixel gap and inset. Style edits
use continuous one-command History; Duplicate and Delete reuse the common session
actions.

## Eraser

The current Eraser deletes whole eligible Ink objects. A continuous gesture may erase
several strokes inside one History transaction, so one Undo restores them together.
Vector/segment erasing is intentionally not implemented.

## Color system

Canonical artwork color is lowercase six-digit RGB hex (`#rrggbb`). Color and opacity
remain separate. The active creation tool or selected object owns current color;
`EditorColorSystem` does not.

`EditorColorSystem` owns:

- 10 most-recently-used artwork colors, newest first;
- ordered Favorites, capped defensively at 256;
- immutable built-in/user/lesson palettes;
- the active palette.

Recents update from successfully committed artwork usage, not from previews, Undo,
Redo, deletion, or picker browsing. Favorites do not reorder on use. These collections
are runtime preferences and create no document History.

The Quick Color Rail appears at workspace right-center for drawing slots and Shapes;
it is hidden for Select and Eraser. It contains Current, up to seven active-palette
swatches, and More Colors. Short windows reduce the deterministic swatch capacity
rather than scrolling. Favorites and Recents stay out of the Rail to preserve spatial
muscle memory.

The Full Color Picker is shared by the Rail, Tool Options color row, and the selected
artwork toolbar. It contains saturation/value, hue, fixed Previous and live Current,
Hex and RGB input, up to ten Recents, Favorites, the active palette, and the built-in
Basic/Sketch/Monochrome selector. Hex and RGB drafts reach the target only when valid;
gray/black edits preserve the last meaningful session hue. Its body scrolls when a
minimum-size window cannot fit its natural height, and placement avoids authoritative
occupied zones and selected artwork where possible.

The Quick Color Rail and Full Color Picker adapt to a `ColorTargetAdapter`:

```text
begin -> preview -> commit
                 -> cancel (restore previous)
```

Creation-tool commits are History-free. Selected-object color uses one continuous
style command. Picker hue memory is local to the picker session, not global color
state.

Favorite add/remove is immediate preference state and is independent of the current
picker transaction: cancelling target color does not undo an explicit Favorite
change. Switching palettes changes the Rail without changing Current, Previous,
Favorites, Recents, tool state, or History. User-palette CRUD is not exposed.

The eyedropper samples the fully composited rendered page, including paper and alpha
blending, while excluding editor overlays. Sampling outside the page changes nothing.
Canvas security/read failures are contained and leave the picker open for retry or
cancel. Future remote images must remain unsampleable unless they are loaded through a
sample-safe application/CORS path.

Eyedropper is one-shot and available from the picker (including shortcut `I` when text
input does not own it). A successful sample previews the target, exits sampling mode,
and leaves the picker open for commit, cancel, or another sample. Escape closes an open
palette menu first, then exits Eyedropper, then cancels the picker on a later press.

## Floating behavior

Drawing surfaces use the shared owner-aware dismissal stack.

- Nested menus close before their parent.
- A page press can dismiss a surface and continue to drawing or selection.
- A workspace-surround press can be dismissal-only.
- Exiting surfaces drop pointer handling immediately.
- Floating open/close uses 160/120 ms and 5 pixels of travel.
- Palette open/close uses 190/160 ms.
- Reduced motion removes spatial travel and radial inertia.

## Current limitations and future decisions

- Catalogue names outnumber materially distinct rendering presets. Forty-five identities
  still map onto nine presets, and only `pen-technical` has a strategy of its own.
- Slot icons are family glyphs, not brush-accurate live previews.
- The Drawing Property Rail routes to other surfaces rather than supporting direct
  value manipulation.
- Tool, palette, and layout preferences do not survive application restart.
- Physical stylus and trackpad behavior still need operator hardware validation.
- Tilt/twist are retained but not rendering inputs.
- Textured/wet-media engines are not implemented.

Track work for these gaps in [`../ROADMAP.md`](../ROADMAP.md). Do not describe them as
implemented and do not add a phase report when they change; update this document and
the architecture instead.
