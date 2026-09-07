# Folio design system

This is the active design contract for the desktop editor. It combines Folio's visual
language, workspace responsibilities, reference policy, motion, accessibility, and UI
implementation rules. Drawing-specific behavior lives in
[`drawing-tool-system.md`](drawing-tool-system.md).

## Product character

Folio should feel like a calm, precise instrument for making marks:

- canvas-first rather than dashboard-first;
- compact rather than sparse or oversized;
- warm and tactile without imitating physical skeuomorphism;
- quiet in neutral states and decisive in selected states;
- professional enough for long sessions, not playful at the cost of control;
- spatial: controls live near the work they affect and transient UI yields to artwork.

Clean does not mean putting every cluster in a large white card. Use hierarchy,
alignment, proximity, and occupied space before adding containers.

## Reference policy

Concepts is the primary professional interaction reference for approved Folio UI work.
It is a source for spatial placement, density, discoverability, and interaction
patterns—not a product dependency or a pixel-for-pixel target.

For each significant component:

1. inspect the existing Folio implementation and architecture;
2. study the exact approved reference or specification;
3. describe the Folio adaptation;
4. obtain product approval when the design is not already approved;
5. implement the approved component in isolation;
6. verify behavior and compare the real Electron UI visually;
7. freeze only after the user accepts the result.

Adapt references to Folio's identity, Windows desktop constraints, page model, input
architecture, and accessibility. Do not copy trademarks, source assets, or imagined
internals. If a reference interaction conflicts with the protected architecture,
report the conflict; the reference does not override document or History correctness.

## Workspace responsibilities

The page is the visual priority. Persistent controls occupy predictable edges so the
center remains a stable artwork region.

| Region | Responsibility |
| --- | --- |
| Top | document identity, navigation, and global/window actions |
| Left | drawing tools and their immediate configuration |
| Center | page, artwork, direct manipulation, and transient measurements |
| Right | organization and color workflows such as Pages, Layers, and quick color |
| Bottom/periphery | viewport/status actions that do not compete with artwork |

Permanent triggers keep stable positions. Opening one feature should not cause nearby
primary tools to jump. Persistent surfaces declare hard occupied zones; transient
surfaces use current workspace geometry to avoid important controls and remain inside
the window.

Non-interactive wrappers pass pointer input through. Interactive surfaces accept it
only within their visible controls. A surface that starts closing stops accepting
pointer events immediately.

## Visual foundations

The canonical runtime tokens are in `apps/desktop/src/styles.css`. Reuse them instead
of introducing component-local color systems.

### Typography

- Primary family: Inter Variable with system sans-serif fallback.
- Labels and control text are compact and legible; avoid display-scale type in editor
  chrome.
- Weight and contrast carry hierarchy before font-size jumps.
- Numeric values align cleanly and retain readable units.

### Color roles

- `folio-workspace`: surround behind the page.
- `folio-topbar`: global chrome.
- `folio-surface` and `folio-surface-muted`: panels and nested controls.
- `folio-ink` and `folio-muted`: primary and secondary chrome content.
- `folio-border`: restrained separation.
- `folio-accent`, `folio-accent-hover`, and `folio-accent-soft`: focus, selection, and
  active emphasis.
- `folio-page*`: page-local presentation that remains stable across shell themes.
- `folio-selection`: artwork selection treatment.

Both light and dark themes are supported. The page is deliberately paper-like in both;
do not reinterpret shell dark mode as dark artwork paper.

### Shape, elevation, and density

- Primary icon buttons use the established 32-pixel chrome-button footprint.
- Floating surfaces use the shared 14-pixel radius and floating shadow.
- Compact surfaces use a 10-pixel radius and quieter shadow.
- Pill shapes are for continuous ranges, compact mode choices, and values—not a
  universal container shape.
- Borders and shadows remain low contrast; active state comes from color and geometry,
  not heavy elevation.

Exact component dimensions come from its approved specification and neighboring live
components. Preserve useful density at small windows.

## Interaction states

Every actionable control defines the states that apply to it:

- default;
- hover;
- pressed;
- selected/active;
- keyboard focus;
- disabled;
- open/expanded when it owns a surface.

Selected and keyboard-focused are distinct. Hover cannot be the only indication of an
available action. Activation feedback must not move layout.

Tooltips are supporting information, not the only label for unfamiliar state. Suppress
the tooltip immediately after activation so it does not cover the resulting surface.
Tooltips remain below dialogs in the layer stack and choose a collision-safe side with
10 pixels of viewport padding and a 12-pixel anchor gap.

## Motion

Use the shared professional easing curve `[0.22, 1, 0.36, 1]` and existing motion
utilities. Current timing roles are:

| Role | Timing |
| --- | ---: |
| Hover | 100 ms |
| Press | 75 ms |
| Selection | 140 ms |
| Generic floating state | 140 ms |
| Tooltip | 120 ms |
| Content transition | 150 ms |
| Floating open / close | 160 ms / 120 ms |
| Palette open / close | 190 ms / 160 ms |

Floating surfaces travel only 5 pixels toward their anchor. Motion explains state
change; it does not decorate routine input. Reversals should continue from the current
position rather than restarting visibly.

When `prefers-reduced-motion` is enabled, remove spatial travel and inertia. Preserve
immediate state clarity with opacity or an effectively instant transition.

## Floating surfaces and dismissal

Floating UI shares an owner-aware, last-opened-first-dismissed stack. Portaled menus or
pickers declare the owning surface rather than relying on one-off selectors.

- Escape is handled by the topmost eligible surface only.
- A page press may dismiss a floating surface and continue as the same canvas action.
- A workspace-surround press may be dismissal-only when continuing would clear or
  corrupt an editor interaction.
- Tool-dock interactions own their activation/toggle behavior.
- An outgoing surface is visually allowed to finish, but it cannot intercept input.

Placement first tries the preferred relationship to its anchor, then deterministic
above/below/side fallbacks against occupied controls, a 12-pixel gap, and a 12-pixel
window inset.

## Canvas and direct-manipulation rules

- Artwork interaction wins over chrome decoration inside the page.
- Pointer capture remains active for a drag that leaves its starting element.
- The first stroke, selection click, or shape drag after dismissing a surface must not
  be swallowed.
- Control visuals may be screen-space sized, but document geometry is page-space.
- Selection handles stay visible and usable across zoom.
- Temporary measurements and previews never become document objects.
- Cursor changes describe the active affordance and revert on cancellation.

Current Select presentation uses grab/grabbing for interior movement, diagonal resize
cursors for corner scaling, and a rotation cursor with a safe fallback. Its visible
handles are 10 viewport pixels with a 12-pixel hit radius.

## Spatial Layers experience

One Layers trigger opens one experience with two presentations. **Stack** is the
default: a modal structural view of the active page's Layers as separated sheets in
perspective, over the page's own paper base. **List** is the existing Layers panel and
behaves like any other floating panel. The view switch lives inside the experience, not
in the workspace rails.

The Stack is a window onto an arrangement rather than a picture of all of it.
Approximately **three planes carry the composition**: the focused Layer, the neighbor
above, and the neighbor below. Sheets further away fade out of the picture instead of
piling up behind it, and they remain mounted, navigable, and named. Sheets keep their
size whatever the layer count — a deep document gets a taller arrangement, never smaller
previews floating in the middle of the workspace.

- The focused Layer is the active Layer. Navigating brings it onto a lower inspection
  shelf, where its whole surface sits above the fold with the next sheet visible over it.
- Every sheet keeps a visible boundary, including an empty, hidden, or faintly drawn
  one — the outline is what says a Layer is there at all. Inactive edges are quiet; the
  active sheet uses a restrained Folio accent edge.
- The paper base is the one opaque sheet, and it alone earns a page edge and a base
  shadow. It sits further from Layer 1 than Layers sit from each other. Paper is Page
  state and is never presented as a Layer in the document architecture.
- Labels stay upright and untransformed, hang off their sheet's projected lower-right
  corner, and carry hidden and locked markers. A label leaves the composition with its
  sheet.
- There is no scrollbar and no scrollbar gutter. Wheel, click, arrow keys, and Home/End
  all move focus between sheets rather than scrolling to arbitrary positions.

### Frozen Spatial Layers v1

These are intentional UX parameters, not incidental implementation numbers. Retuning any
of them changes the approved look and needs product approval.

| Parameter | Value |
| --- | ---: |
| Tilt | 35° |
| Perspective | 1100 px |
| Plane width ratio, of free workspace | 0.80 |
| Sheet scale, of the largest sheet that fits | 0.84 |
| Layer step / separation, of apparent sheet height | **0.72** |
| Focused sheet's projected bottom shelf | 0.90 of usable workspace height |
| Depth safety cap, of perspective distance | 0.24 |
| Full emphasis held within | ~1.25 gaps of the shelf |
| Emphasis gone by | ~1.7 gaps of the shelf |

The separation is deliberately large. A value small enough to fit ten Layers on screen
would produce the compressed overview this view exists to replace. The depth cap exists
because depth accumulates down the stack; without it a deep document magnifies its
nearest sheet past the workspace.

The Stack owns its own open and close choreography rather than the shared floating
timings: one linear progress value drives every sheet, so a reversal changes direction
from wherever the travel had reached. Navigation settles separately, because its
destination can change while the value is still moving. Reduced motion arrives at the
final geometry immediately, for both opening and navigation.

## Accessibility

- Use native elements and semantic roles before custom keyboard simulation.
- Provide accessible names for icon-only controls and radio semantics for exclusive
  choices.
- Use roving tab stops for the tool dock and Arrow/Home/End navigation.
- Keep focus visible and restore it intentionally after a nested surface closes.
- Preserve text selection inside `input`, `textarea`, and editable content while
  suppressing accidental selection on editor chrome.
- Respect reduced motion and platform high-contrast needs; never encode state by color
  alone.
- Minimum window behavior must preserve access to the page and primary controls.

## Architecture boundary

UI is a projection of existing authorities:

```text
presentation -> controller or target adapter -> command/session -> document
```

Never create a component-local document, History manager, selection authority,
viewport authority, or current-color store. Tool and viewport preferences remain
session state. Selected-artwork changes use continuous editing and one command;
creation-tool preferences remain History-free.

See [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and
[`../DECISIONS.md`](../DECISIONS.md) for the protected engineering model.

## Definition of done for UI work

- The approved scope and reference are named.
- Current neighbors and relevant tests were inspected.
- All applicable states, keyboard behavior, dismissal, pointer capture, and reduced
  motion are implemented.
- Focused tests pass, followed by the proportionate repository gates.
- The real Electron UI is compared at standard and constrained window sizes.
- Placement, dimensions, density, typography, icons, motion, and coexistence with
  nearby surfaces are evaluated explicitly.
- The user performs the final visual approval; automated green alone is not a freeze.
