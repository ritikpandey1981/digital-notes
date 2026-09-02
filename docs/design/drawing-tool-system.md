# Folio Drawing Tool System — Final UX Design Spec v0.1

The **final intended** professional UX for Folio's drawing tool system. This document
describes the product we are building toward, not the product today's engine can
produce.

> **Reading rule.** No statement in Sections 1–25 may be weakened because a capability
> is missing. Current engine reality is recorded once, in §26, and it exists to plan
> implementation — never to edit a design decision.

This is the first component of the broader Final UI Design phase (§29). Claude Design
prototypes against this document; Claude Code implements from it incrementally, much
later, one step at a time.

Companion documents: `folio-design-system.md`, `concepts-reference.md`,
`workspace-layout.md`, `component-inventory.md`. Engineering constraints:
repository-root `CLAUDE.md`.

---

## 0. Status Language

Every statement carries one classification. They are not interchangeable.

| Label                      | Meaning                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **FIXED UX**               | Approved final product behavior. Implement as written; conflicts are reported, not resolved silently.           |
| **OPEN VISUAL**            | Exact dimensions, geometry, or styling still to be determined in Claude Design.                                 |
| **PLACEHOLDER CAPABILITY** | Belongs in the final visual design; needs future implementation. Valid in mockups, never in shipping behavior.   |
| **EXISTING CAPABILITY**    | The current core already has useful underlying support.                                                         |
| **IMPLEMENTATION NOTE**    | Information for future Claude Code work. **Does not constrain the product design.**                             |
| **TEMPORARY**              | Migration-only UI that must disappear before final release.                                                     |

---

## 1. Product Intent — FIXED UX

The Folio Drawing Tool System is **a configurable artist tool kit sitting beside the
canvas** — not a generic software toolbar.

The distinction governs every decision below. A tool kit is *personal, small, and
already set up*. A toolbar is *exhaustive, impersonal, and browsable*. Where the two
pull in different directions the tool kit wins, and the exhaustive catalog moves into
the Brush Library.

The system lets the user:

- switch between favorite drawing presets in one action
- adjust the most common properties without opening a settings panel
- replace a preset from a categorized Brush Library
- reach Select, Eraser and Shapes permanently
- work comfortably with either hand
- keep maximum canvas area
- keep advanced brush settings out of the high-frequency path

**Interaction inspiration: Concepts.** Folio adopts its principles — spatial artist
controls, fast direct manipulation, stroke previews, immediate tool switching, powerful
temporary interfaces, minimal permanent clutter, canvas-first operation — while changing
visual identity, layout geometry, branding, typography, color, some interaction details,
and desktop adaptation.

---

## 2. Overall Tool System Structure — FIXED UX

The permanent primary tool system is **five configurable drawing preset slots**, a small
visual separation, then **three permanent utility tools**.

```
PRIMARY TOOL DOCK          ATTACHED PROPERTY STRIP
┌────────────────────┐  ┌────────────────────┐
│ Drawing Preset 1   │  │ Width              │
│ Drawing Preset 2   │  │ Opacity            │
│ Drawing Preset 3   │  │ Smoothness         │
│ Drawing Preset 4   │  │                    │
│ Drawing Preset 5   │  │ ●  Current Color   │
│                    │  │                    │
│  small separation  │  │ ●                  │
│                    │  │ ●                  │
│ Select             │  │ ●   Recent /       │
│ Eraser             │  │ ●   active palette │
│ Shapes             │  │ ●                  │
└────────────────────┘  │ ●                  │
                        └────────────────────┘
                        → contextual UI opens toward canvas
```

**This ASCII is information hierarchy only. It is not pixel geometry.** Sizes,
proportions, gaps, and control shapes are **OPEN VISUAL**.

What the 5 + 3 structure fixes:

- drawing presets are the top group and the dock's primary content
- the three utilities are a visually separated bottom group
- the property strip is **attached to** the dock, not independently floating, and is
  contextual to whatever is active
- color sits at the bottom of the strip: one current-color control above a compact stack
  of quick colors
- expansion happens **toward the canvas**

> **Do not add more permanent major buttons simply to expose new features** (§18).

Consistent with `workspace-layout.md` §2: the left side answers *"what am I drawing
with?"* and *"how is this tool configured right now?"*

---

## 3. Dock Location and Handedness — FIXED UX

**Default: the tool system docks LEFT.** Most users draw with the right hand and operate
controls with the non-dominant left hand.

The dock may later be moved to the **RIGHT** for left-handed use.

- Only two positions exist: **LEFT dock** or **RIGHT dock**.
- **Do not design arbitrary free-floating placement.**
- Preferred interaction: **drag the dock → snap left or snap right.**
- A non-drag mechanism — a Settings `Handedness` option or menu item — **must eventually
  exist**, both for accessibility and because drag-to-snap is undiscoverable alone.

**Mirroring is complete, not partial.** Docked left, contextual UI opens inward toward
the canvas. Docked right, the whole system mirrors and contextual UI *again* opens inward
toward the canvas. This covers the property strip, color expansion direction, Brush
Library anchoring where relevant, and every attached transient control.

Dock side is **workspace/user preference, not document state** (§19).

---

## 4. Five Configurable Drawing Preset Slots — FIXED UX

There are **exactly five** configurable drawing-preset slots. **All five are populated by
default.**

A slot is not a generic tool-category button. Each holds a *configured artistic preset*:

- brush identity
- width
- opacity
- smoothness
- color
- future brush-engine parameters

An illustrative kit: **Soft Pencil · Fountain Pen · Dynamic Pen · Marker · Watercolor**.

> These examples do **not** define the eventual default set. The final defaults are
> chosen later on product balance — a starter kit should span sketching, precise inking,
> expressive inking, broad marking, and color/painting. **OPEN VISUAL / product decision.**

Choosing the defaults is a *product* judgment about what makes a good starting kit. It is
explicitly **not** a question of what the engine currently supports; §26 records the
implementation consequences, and §25 governs what may ship.

---

## 5. Stroke Preview as Slot Identity — FIXED UX

Drawing-preset slots display a **miniature representative stroke** as their primary
visual identity. **Not a generic tool icon.**

The reason is substantive, not decorative: a user must visually recognize *what the
preset draws*. Two presets in the same broad category can behave very differently, and a
kit where three slots are "a pencil icon" fails at the dock's one job.

```
Soft Pencil    → soft graphite stroke sample
Fountain Pen   → pressure-varying ink sample
Marker         → broad marker sample
Watercolor     → textured wash sample
```

A slot may carry secondary identification — tooltip, accessible name, an optional short
label on hover or in an expanded state. **The visible primary cue is the stroke;** text
and icons never replace it.

**OPEN VISUAL:** exact dimensions · orientation · preview padding · stroke-preview
scaling · selected-state treatment · hover treatment · whether the name appears on hover ·
whether the selected slot expands slightly.

---

## 6. Slot Activation — FIXED UX

```
click an INACTIVE drawing slot  → activate that configured preset → draw immediately
click the ACTIVE drawing slot   → open the Brush Library for that slot
```

The active slot is therefore both the activation target and the Brush Library entry
point. It has no nested chevron or secondary hit target. Detailed width, opacity and
smoothness settings are entered through the adjacent Property Rail; color follows the
rail's canonical color control. Every drawing-slot glyph continues to show that slot's
own canonical artwork color when another slot becomes active; utility glyphs keep Folio's
UI accent instead. Stored color changes color only: active state comes from a quiet, flat
slot surface, and a narrow theme-aware neutral silhouette keyline appears only when the
exact stored color has genuinely insufficient contrast against the dock. It never adds a
filled plate, thickens the foreground stroke, or recolors the glyph.

> **Do not add a permanent "Brush Library" workspace button.** The re-click is the
> entry point (§18).

**OPEN VISUAL — desktop convenience.** Right-clicking a slot could open contextual slot
management (Replace Brush · Reset Preset · Duplicate · Rename · Restore default). Whether
this ships, and with which actions, is open. **None of these become permanent workspace
buttons.**

---

## 7. Replacing a Slot's Brush — FIXED UX

```
open Brush Library from the active slot
  → select a different brush
  → that brush replaces the brush in the active slot
  → the slot's stroke preview updates
  → the slot stays active
  → the Brush Library closes
  → the user draws immediately with the new preset
```

This is the **primary replacement workflow**, and the reason no permanent "edit preset"
control is needed.

Sensible current preset properties are retained or adapted where appropriate on
replacement. **Exact replacement semantics for incompatible advanced brush parameters
are determined during Professional Brush Engine design** — deliberately not settled here.

---

## 8. Brush Library — FIXED UX

Re-selecting the active drawing slot opens the Brush Library: a **temporary radial
chooser** anchored to that slot. Its visible brush cells and the visually empty regions
inside each complete ring are one physical interaction surface. A press outside the
radial instrument requests its close while the same pointer action continues to the
underlying canvas; dismissal never requires a sacrificial first stroke.

```
┌───────────────────────────────────────────────────────────┐
│ ×   Brushes                                            ⓘ  │
├───────────────────────────────────────────────────────────┤
│                                                           │
│                 LARGE BRUSH PREVIEW                       │
│                                                           │
├───────────────────────────────────────────────────────────┤
│ PENCIL                                                    │
│  stroke  stroke  stroke  stroke  stroke  stroke           │
│  Hard    Soft    HB      2B      4B      Charcoal         │
│                                                           │
│ PEN                                                       │
│  stroke     stroke     stroke     stroke                  │
│  Fountain   Dynamic    Fixed      Marker                  │
│                                                           │
│ COLOR BRUSH                                               │
│  stroke      stroke      …                                │
│  Airbrush    Watercolor                                   │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

Each library item primarily shows a **representative stroke sample**, with supporting
text identifying the brush. The Library holds many brushes **without putting any of them
permanently on the workspace** — that is its entire reason to exist.

### 8.1 Three Major Families — FIXED UX

| Family          | Final intended contents                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ |
| **Pencil**      | Hard Pencil · Soft Pencil · HB · 2B · 4B · 6B · Charcoal Pencil · future pencil types        |
| **Pen**         | Fountain Pen · Dynamic Pen · Fixed Width Pen · Marker · technical/inking variants later      |
| **Color Brush** | Airbrush · Watercolor · future painting brushes                                              |

Several of these are **PLACEHOLDER CAPABILITY** — see §26. They belong in the final
design and in prototypes regardless.

**The library is designed for expansion. Do not hardcode the interface around today's
small brush set.** The layout must remain legible as categories grow and as a fourth
category eventually appears.

Terminology: **"Charcoal Pencil"**, not "Coal Pencil".

**IMPLEMENTATION NOTE.** These are product/library categories. They do not require one
`PageObject` type per brush and do not map one-to-one onto any internal engine
enumeration. The category→engine mapping is a presentation concern. **Do not rewrite the
document architecture to model these UI categories.**

**OPEN VISUAL:** where Highlighter belongs in the three-family scheme — it is a real,
distinct behavior with no obvious home among Pencil / Pen / Color Brush. Options: a
fourth category, a Pen sub-group, or promotion to a utility. Decide from the Concepts
reference.

### 8.2 Library Preview Area — FIXED UX

The Brush Library contains a **prominent preview area** demonstrating the focused or
selected brush. Eventually it should reflect brush behavior, width, opacity, color,
pressure behavior where relevant, and texture where relevant.

**OPEN VISUAL / IMPLEMENTATION:** whether this is a deterministic generated stroke
sample, an interactive scratchpad, or a hybrid. **The final UI reserves the space now**
and the mechanism is chosen later.

### 8.3 Reference Adaptation

The supplied Concepts Brush Library screenshots are strong interaction/layout references:
a large dedicated selection mode · visual stroke previews · category grouping · many
options without workspace clutter · immediate preview · clear active-brush indication.

Folio adapts these into its **light** design system. **Do not copy** the dark theme,
branded assets, exact geometry, Concepts branding, or paid-store presentation.
Downloadable or community brush packs would be a separate future product decision, not an
inherited one.

---

## 9. Quick Property Strip — FIXED UX

Immediately beside the Tool Dock is an **attached contextual property strip**. When a
drawing preset is active it exposes exactly:

1. **Width**
2. **Opacity**
3. **Smoothness**

then, below those:

4. **Current Color**

then, below that:

5. **compact Recent / palette colors**

This information hierarchy is fixed. It is the high-frequency layer:

```
Quick controls answer:   "What do I change repeatedly while drawing?"
Advanced options answer: "How does this brush fundamentally behave?"
```

> **Do not overload the quick strip with future brush-engine parameters** (§17).

---

## 10. Property Control Interaction — FIXED UX

> **Do not design conventional generic web range sliders as the default solution.**

Use Concepts-inspired direct manipulation:

```
drag the control          → the value changes continuously
while adjusting           → numeric feedback becomes prominent
optional exact entry      → available where genuinely useful
```

Illustrative presentation:

```
Width       29.4 px
Opacity     74%
Smoothness  18%
```

Exact numeric entry should eventually be available where it helps, as an escape hatch
rather than the primary path (`folio-design-system.md` §14).

**OPEN VISUAL:** track geometry · orientation · knob style · whether controls are curved
or linear · value position · interaction direction · hover treatment. Claude Design
explores these from the Concepts references.

---

## 11. The Property Strip Is Contextual — FIXED UX

The property system changes **meaningfully** with the selected major tool:

| Active tool      | Quick properties                                        |
| ---------------- | -------------------------------------------------------- |
| Drawing preset   | Width · Opacity · Smoothness · Color                     |
| **Eraser**       | eraser-relevant properties                                |
| **Select**       | **no drawing properties** — show nothing meaningless      |
| **Shapes**       | shape-creation properties                                 |

> **Do not preserve controls merely for visual symmetry.** A strip that shrinks when
> Select is active is correct behavior, not a layout bug.

**OPEN VISUAL:** the exact per-utility property layouts.

---

## 12. Current Color — FIXED UX

A prominent **filled color circle** sits below the drawing properties, representing the
**active preset's current color**.

**Each drawing preset remembers its own color:**

```
Soft Pencil   → graphite
Fountain Pen  → black
Marker        → blue
Watercolor    → teal
```

Switching presets restores that preset's color.

This is **user/editor tool preference state. It does not enter document History** (§19).

**IMPLEMENTATION NOTE.** The existing Folio color-target architecture remains
authoritative during eventual implementation:

```
correct:    preset preference → activate → existing tool/color target → existing core
incorrect:  preset preference → an independent toolbar current-color store
```

> **Do not create a second canonical current-color state** (`CLAUDE.md` §4). The preset
> preference stores *a remembered value*; existing tool state remains the authority on
> what the current color *is*.

---

## 13. Collapsed Recent / Palette Stack — FIXED UX

Below Current Color is a **compact vertical stack of quick colors**, targeting
**approximately six** visible swatches.

- Default source: **Recent Colors.**
- Later, the user may choose another palette to occupy this quick stack.

> **Do not add permanent workspace buttons for Recent / Favorites / Palette 1 /
> Palette 2.** Palette switching belongs inside the expanded color system.

**OPEN VISUAL:** exact swatch count (~6) · spacing · shape treatment · selected and hover
behavior · how the stack's source is switched from Recents to a palette.

**TEMPORARY.** A quick color rail already exists on the **right** side of the workspace.
When this left-side stack becomes functional, the right-side rail is **removed** rather
than left as a duplicate permanent control (`folio-design-system.md` §17). Record it in
the inventory's Temporary UI register at that point.

---

## 14. Expanded Color Entry — FIXED UX

```
click the Current Color circle
  → open the large expanded color interface
  → the interface may cover substantial canvas space (acceptable — the user is not drawing)
  → user chooses a color
  → the active drawing preset's color updates
  → the expanded interface collapses
  → the Current Color circle updates
  → the user immediately resumes drawing
```

**The interaction above is FIXED UX. The expanded interface's visual design is
explicitly DEFERRED.**

- Exact Concepts color-system screenshots will be supplied separately.
- The **rejected Spectrum 1B cylindrical reel is not a design reference** and must not be
  revived.
- **Spectrum 1A remains underlying palette/model infrastructure only** — data and lookup,
  owning no application state.
- Whatever the expanded UI becomes, it routes through the existing color targets. No
  second canonical current-color store.

Expanded Color is its own future design specification (§29).

---

## 15. Permanent Utility Tools — FIXED UX

Below the five drawing slots, with **clear visual separation**, sit exactly three
permanent utilities:

1. **Select**
2. **Eraser**
3. **Shapes**

They are always available. They are **not** replaceable brush slots and do not consume
drawing-preset slots.

Unlike drawing presets, these use **semantic utility icons** — the contrast is
deliberate:

```
Drawing presets → stroke previews
Utility tools   → semantic utility icons
```

Use current iconography conventions (Lucide) unless the approved Claude Design prototype
establishes a better tool-specific treatment.

---

## 16. Bottom-Center Contextual Mode Tray — FIXED UX

A core Folio interaction rule:

> **The LEFT/RIGHT tool dock chooses the major tool.**
> **The BOTTOM CENTER tray chooses the subtype/mode.**

When a permanent utility tool is active, its major subtype/mode options appear at
**bottom center**, consistently for every utility.

### 16.1 Select Tray — PLACEHOLDER CAPABILITY permitted

The final design may show Concepts-inspired modes such as:

**Lasso · Partial · Ignore · All**

These may remain **PLACEHOLDER CAPABILITY** until implementation exists. The design is
allowed — and expected — to show the desired final modes. A later dedicated **Selection
UX specification** finalizes exact semantics.

### 16.2 Eraser Tray — PLACEHOLDER CAPABILITY permitted

The final design may show modes such as:

**Stroke Eraser · Soft Eraser · Slice · Nudge** · further professionally useful
erase/edit modes

These may remain **PLACEHOLDER CAPABILITY**. A later dedicated **Eraser UX
specification** finalizes semantics.

### 16.3 Shapes Tray — FIXED UX principle

When Shapes is active, the bottom tray exposes shape subtype choices — for example
**Line · Rectangle · Ellipse · Polygon** and future shapes.

Shape styling stays accessible through the contextual property system (§11). Exact final
shape modes are designed later.

---

## 17. Advanced Tool Options — FIXED UX

The quick property strip **does not replace** advanced brush configuration. Two levels
are maintained:

| Level                      | Contents                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Quick controls**         | Width · Opacity · Smoothness · Color                                                                    |
| **Advanced brush settings** | *(future)* pressure curve · taper · tilt · texture · grain · spacing · stabilization detail · brush-engine-specific settings |

This split is what keeps the workspace compact while allowing a powerful future brush
engine.

**OPEN VISUAL:** whether advanced settings live in a floating widget, inside the Brush
Library, or in a distinct Brush Settings surface.

**TEMPORARY.** During migration the existing Tool Options widget may remain reachable
while the new quick strip is incomplete. It must not survive as a permanent duplicate
once the strip covers its high-frequency controls.

---

## 18. No More Permanent Workspace Buttons — FIXED UX RULE

> **Do not solve every future feature by adding another toolbar button.**

Preferred mechanisms, in order:

1. re-clicking the active tool
2. the contextual property strip
3. the bottom subtype tray
4. temporary large interfaces
5. context menus
6. direct manipulation

**Permanent workspace controls must remain scarce.** A proposal that adds one is a design
decision requiring approval, not an implementation convenience.

---

## 19. Preset Ownership and History Boundary — FIXED UX

The five preset slots are **global user/editor workspace preferences**. They are **not**
`SketchbookDocument` state. Opening another sketchbook must not replace the user's
configured tool kit.

```
user/editor preferences
  → drawing preset slots
  → activate preset
  → existing Folio tool state
  → input/stroke pipeline
  → committed Ink
  → History
```

### Zero document History

- selecting a preset slot
- replacing a slot's brush
- changing preset width, opacity, smoothness
- changing preset color **when no selected artwork is being edited**
- moving the dock left/right
- opening/closing the Brush Library
- selecting a utility subtype
- opening the expanded color interface

### Document History

- a committed stroke
- any artwork mutation
- selected-object style mutation **through the existing continuous editing path**
- Shape creation and edit
- every other existing document-changing command

The document records the resulting committed artwork and process data — **not the user's
toolbar arrangement**.

> **Do not alter these semantics to match Concepts.** If a Concepts interaction appears
> to require preference changes to be undoable, that is a conflict to report
> (`concepts-reference.md` §8), not a boundary to move.

---

## 20. Preference Shape — Conceptual Only

**This is documentation, not a schema.** Do not create these types in source, do not
define serialization, do not touch `SketchbookDocument`.

```
DrawingToolWorkspacePreferences
  dockSide                left | right
  presetSlots[5]          ordered DrawingPresetPreference
  activePresetSlotId
  (optionally, later)     last utility tool and its subtype

DrawingPresetPreference
  id
  brushDefinitionId
  width
  opacity
  smoothness
  color
  (later)                 references to future brush parameters
```

**OPEN VISUAL / product:** whether the last active utility tool and subtype are
remembered at all — restoring a user into Eraser mode on launch may be unwelcome.

---

## 21. Future Preset Sets — FUTURE POSSIBILITY ONLY

Recorded so the idea is not lost, **explicitly excluded from the current interface
specification**:

Users may eventually save named tool kits — *Sketching · Inking · Watercolor ·
Architecture · Custom* — and switch between them.

**Do not add this to the current design, the current prototype, or the current
interface.**

---

## 22. Accessibility

Expectations for the eventual implementation.

**Drawing slots.** Accessible names identify the actual preset/brush. Selected state is
exposed. The stroke preview must not be the *only* semantic identifier — a canvas with no
accessible name is invisible to assistive technology.

**Utility tools.** Icon plus accessible name; active state exposed.

**Quick properties.** Keyboard-adjustable; numeric value available to assistive
technology; visible focus.

**Docking.** A non-drag alternative must exist (§3).

**Brush Library.** Category semantics; keyboard navigation; selected-brush state; **no
tab-stop explosion** as the catalog grows — composite-widget semantics with arrow-key
traversal (`folio-design-system.md` §15).

**Bottom subtype tray.** Clearly identifies the current mode.

---

## 23. Minimum Window Behavior

The dock must not make the canvas unusable at the minimum supported size.

- The property strip opens toward the canvas.
- The contextual tray remains usable.
- Temporary large surfaces — Brush Library, expanded color — **may** cover the canvas,
  because they represent explicit mode changes the user chose.
- Actionable controls take priority over decorative preview content.

> **Do not solve minimum-window concerns by arbitrarily shrinking the Page or canvas.**

**OPEN VISUAL:** exact minimum supported window size and per-element collapse order,
consistent with `folio-design-system.md` §16.

**IMPLEMENTATION NOTE.** Use the existing occupied-zone and floating-dismissal
architecture; declare each persistent surface as a hard zone.

---

## 24. Pointer and Drawing Safety

Correctness requirements for the eventual implementation, not polish. These are the first
things `.claude/skills/folio-ui-qa` tests:

- clicking a tool **never** creates a canvas mark
- dismissing transient UI **must not swallow the first intended stroke** — the exiting
  surface drops `pointer-events` immediately
- the Brush Library and color expansion own pointer interaction **only while open**
- visual gaps inside a radial ring remain radial-owned material, not canvas holes
- a pointer outside the radial instrument dismisses it without blocking that pointer's
  normal drawing, selection, or viewport action
- closing a temporary interface restores immediate canvas drawing
- **dock drag must not accidentally start a canvas stroke** — the drag is unambiguously
  owned by the dock before it begins
- pointer capture ownership is explicit at every stage

---

## 25. Placeholder Rule — FIXED

Placeholders are **allowed** in:

- design documentation
- Claude Design prototypes
- static visual mockups
- implementation planning

Placeholders are **not allowed to masquerade as working production features.**

During later production implementation:

```
supported control    → connect for real
unsupported control  → intentionally disabled / marked development-only,
                       OR omitted from the shipping configuration until implemented
```

Two presets that differ only in width and opacity are two configurations of one brush,
not two brushes, and must not be presented as distinct media. **No fake completeness.**

> **Before Sketchbook Pro 1.0: ZERO unresolved fake controls.**

---

## 26. Final Design / Implementation Mapping

**This section exists only to plan implementation.** It is an appendix, not an input to
the design.

> **Never rewrite a design decision because the implementation column says "missing."**

Audited read-only against the working tree at commit `a6f7c4f`.

| Final UX capability                  | Design status          | Current implementation                                                                                      | Future work                                                       |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Five configurable preset slots       | FIXED UX               | **Missing.** Drawing state is keyed by brush *family* (`pencil`/`pen`/`marker`/`highlighter`), not by slot — two Pencil slots with different widths would collide. | Slot-keyed preference layer above the existing brush store          |
| Preset-specific width                | FIXED UX               | Per-family width exists (0.5–40 px, step 0.1)                                                                 | Re-key to slot                                                      |
| Preset-specific opacity              | FIXED UX               | Per-family opacity exists (floor 0.1; Highlighter clamped to 0.45 with display remapping)                      | Re-key to slot                                                      |
| Preset-specific smoothness           | FIXED UX               | Amount 0–1 with modes none/average/catmull-rom/bezier                                                          | Re-key to slot                                                      |
| Preset-specific color                | FIXED UX               | Per-family working color already persists across preset switches — the same idea, keyed by family              | Re-key to slot, via existing color targets                          |
| Preferences surviving restart        | FIXED UX               | **Nothing persists anywhere in the application** — not tool state, not dock side, not the theme                | Application preferences system (infrastructure, not UI)             |
| Stroke-preview slot identity         | FIXED UX               | A canvas2d bezier preview exists but draws with plain color/width/opacity — **not brush-accurate**              | Brush-accurate preview rendering                                    |
| Brush Library surface                | FIXED UX               | **Missing.** The brush catalog and per-family preset lists exist; the browsing surface does not                 | New UI only                                                         |
| Large live brush preview             | FIXED UX               | Partial — see stroke preview                                                                                   | New preview mechanism (deterministic / scratchpad / hybrid)         |
| Hard Pencil · Soft Pencil            | FIXED UX               | Partial — graphite grades (HB/2B/4B/Mechanical) differ by size, opacity, smoothing, pressure range              | Genuine hardness/grain behavior                                     |
| HB · 2B · 4B                         | FIXED UX               | **Exists**                                                                                                     | —                                                                   |
| 6B                                   | PLACEHOLDER CAPABILITY | Missing                                                                                                        | Softer grade; trivial once grain exists                             |
| **Charcoal Pencil**                  | PLACEHOLDER CAPABILITY | **Missing**                                                                                                    | Grain/texture rendering — Professional Brush Engine                 |
| Fountain Pen                         | FIXED UX               | Partial — pressure-driven width via the outline renderer (Brush Pen)                                            | True fountain-pen response curve: tuning plus possible engine work  |
| Dynamic Pen                          | FIXED UX               | Partial — pressure→size dynamics with linear/power curves                                                       | Velocity and taper dynamics                                         |
| Fixed Width Pen                      | FIXED UX               | **Exists** — Fineliner / Technical Pen                                                                          | —                                                                   |
| Marker                               | FIXED UX               | **Exists** — Felt and Broad Marker                                                                              | —                                                                   |
| Highlighter                          | FIXED UX               | **Exists** — distinct behavior with its own opacity ceiling                                                     | Library placement is an OPEN VISUAL question (§8.1)                 |
| **Airbrush**                         | PLACEHOLDER CAPABILITY | **Missing** — no spray/density rendering                                                                        | Professional Brush Engine                                           |
| **Watercolor**                       | PLACEHOLDER CAPABILITY | **Missing** — no wet/blending/absorption model                                                                  | Professional Brush Engine                                           |
| Color Brush family (populated)       | FIXED UX               | **No supported members exist**                                                                                  | Blocked on the two rows above                                       |
| Pressure→opacity dynamics            | FIXED UX               | Model exists but is disabled on every shipped preset                                                            | Enable and tune per brush                                           |
| Select tool                          | FIXED UX               | **Exists** — click, rectangular marquee, overlap cycling, full transform                                        | —                                                                   |
| Select tray: Lasso/Partial/Ignore/All| PLACEHOLDER CAPABILITY | **Missing** — rectangular marquee is the only selection mode                                                    | Selection engine work + dedicated Selection UX spec                 |
| Eraser tool                          | FIXED UX               | **Exists** — whole-stroke erase, own size (4–120 px), independent of brush families                             | —                                                                   |
| Eraser tray: Soft/Slice/Nudge        | PLACEHOLDER CAPABILITY | **Missing** — only whole-stroke erase                                                                           | Eraser engine work + dedicated Eraser UX spec                       |
| Shapes tool                          | FIXED UX               | **Exists** — line, rectangle, ellipse with color, width, opacity                                                | —                                                                   |
| Shapes tray subtypes                 | FIXED UX               | Partial — an armed shape kind already exists in state; only presentation and placement change                    | Presentation only; Polygon and further shapes are new                |
| Shape fill / fill opacity            | PLACEHOLDER CAPABILITY | **Missing** — shape style carries stroke color/width/opacity only                                               | Shape engine work                                                   |
| Bottom-center subtype tray framework | FIXED UX               | **Missing**                                                                                                     | New UI only                                                         |
| Dock left/right handedness           | FIXED UX               | **Missing** — layout is statically left                                                                         | Presentation mirroring; remembering it needs preferences            |
| Quick property direct manipulation   | FIXED UX               | Partial — continuous slider components exist, but not the Concepts-style direct-manipulation treatment           | New interaction design and implementation                           |
| Recent Colors                        | FIXED UX               | **Exists** — capacity 10, owned by `EditorColorSystem`                                                          | —                                                                   |
| Collapsed quick-color stack (~6)     | FIXED UX               | Partial — a right-side rail shows the **active palette** with adaptive count, not Recents on the left            | Reposition, re-source, and remove the old rail (**TEMPORARY**, §13) |
| Palette switching in the stack       | FIXED UX               | Partial — palettes and an active-palette concept exist                                                          | Source-switching UI inside the expanded color system                |
| Expanded color interface             | Deferred (§14)         | A full picker with correct transaction semantics exists                                                          | Its own design milestone from Concepts references                   |
| Color target architecture            | EXISTING CAPABILITY    | **Exists** — `ColorTargetAdapter` begin/preview/commit/cancel; History-free creation targets; continuous editing | Reuse; do not replace                                               |
| Occupied zones & dismissal stack     | EXISTING CAPABILITY    | **Exists** — shared placement model and floating dismissal stack                                                | Reuse; do not replace                                               |

### 26.1 Headline implementation findings

1. **Nothing persists.** Every "remembered" behavior in this spec is blocked on a
   preferences system that does not exist. The tool kit is still worth building without
   it — it simply resets on restart until that lands.
2. **The slot model is new state architecture**, not a re-skin of the current dock. This
   is why Tool System 1A exists as its own step (§30).
3. **The Color Brush family has no supported members.** Designing and prototyping it is
   correct; *shipping* a populated Color Brush category is governed by §25.
4. **The existing stroke preview is not brush-accurate** and cannot be reused as-is for
   slot identity.

None of the above changed a single decision in §§1–25.

---

## 27. Claude Design Handoff

Claude Design will receive:

1. this specification
2. `folio-design-system.md`
3. `concepts-reference.md`
4. `workspace-layout.md`
5. the supplied Concepts screenshots

Claude Design produces a **light-theme Folio interpretation**. The prototype must
include:

**Primary Tool Dock**

- 5 stroke-preview drawing preset slots
- clear visual separation
- Select
- Eraser
- Shapes

**Attached Property Strip**

- Width
- Opacity
- Smoothness
- Current Color
- approximately 6 quick colors

**Brush Library**

- large temporary overlay
- large preview region
- Pencil · Pen · Color Brush categories
- stroke-preview brush items

**Utility Context**

- an example Select bottom tray
- an example Eraser bottom tray
- an example Shapes bottom tray

**Handedness**

- the default left dock
- a mirrored right-docked example

Claude Design should **not** design the expanded color system — no color reference has
been supplied yet (§14).

---

## 28. Claude Design Constraints

### 28.1 Visual requirements

The prototype must remain recognizably Folio:

- light-neutral workspace
- warm paper
- muted indigo/violet selection accent
- compact professional density
- minimal unnecessary chrome
- spatial/direct controls
- restrained shadows
- restrained radii
- **no generic SaaS cards**
- **no giant conventional settings panel**

The interaction inspiration may be strongly Concepts-like; the resulting visual
composition must still read as Folio.

### 28.2 Claude Design must not over-engineer

Claude Design determines **appearance and interaction only**. It must **not** determine:

- document architecture
- History architecture
- `PageObject` ownership
- color state ownership
- renderer architecture
- persistence schema

Those remain governed by `CLAUDE.md`. Per `folio-design-system.md` §19: **the visual
output is the reference; the Folio core remains authoritative underneath**, and mockup
internals are never implementation architecture.

---

## 29. Position in the Final UI Design Phase

The Drawing Tool System is the **first** component of a broader Final UI design phase.
Expected subsequent design work:

1. Expanded Color System
2. Layers
3. Top Bar / File UX
4. Selection
5. Transform
6. Eraser
7. Shapes
8. Pages
9. Precision / Guides
10. Menus
11. Dialogs
12. Notifications
13. Persistence / file UX
14. Advanced brush settings
15. Complete workspace integration
16. Responsive / minimum window
17. Accessibility
18. Final visual consistency

**Only after the professional UI/UX is comprehensively designed does the large
production migration begin.**

---

## 30. Production Implementation Philosophy — FUTURE

**This is not the current task.** Recorded so the eventual order is deliberate.

Implementation remains incremental. **Do not implement the full visual prototype in one
Claude Code task.** Likely sequence:

| Step               | Scope                                                          |
| ------------------ | ---------------------------------------------------------------- |
| **Tool System 1A** | Dock / preferences shell and slot-keyed state architecture       |
| **1B**             | Preset slots and stroke-preview presentation                     |
| **1C**             | Property controls                                                |
| **1D**             | Brush Library                                                    |
| **1E**             | Replacement workflow                                             |
| **1F**             | Handedness / docking                                             |
| **1G**             | Utility tray framework                                           |

then additional component implementations.

Two ordering notes worth respecting:

- **Preference persistence** is application infrastructure, not UI, so it is not a Tool
  System step. Every step above works without it; several are only *complete* with it.
- **1G should build the framework** and apply it where real modes exist, per §25.

---

## 31. Open Visual Decisions Summary

Carried forward for Claude Design or a later screenshot review:

1. Slot dimensions, orientation, preview padding, stroke-preview scaling,
   selected/hover treatment, label visibility, whether the selected slot expands.
2. Geometry, orientation, knob style, drag axis and value presentation for the
   Width / Opacity / Smoothness controls.
3. Exact quick-swatch count (~6), spacing, and shape treatment.
4. How the collapsed color stack switches between Recents and a palette.
5. Where Highlighter belongs in the three-family library scheme (§8.1).
6. The factory default five presets (§4).
7. Whether the right-click slot context menu ships, and with which actions.
8. Whether the last active utility tool/subtype is remembered.
9. Brush Library preview mechanism: deterministic, scratchpad, or hybrid (§8.2).
10. Exact minimum supported window size and per-element collapse order.
11. Exact Select and Eraser tray modes, pending their dedicated UX specifications.
12. The expanded color interface in its entirety — deferred to its own milestone (§14).
13. Whether any new semantic tokens are required; none are added now — record them as
    OPEN VISUAL when the design identifies them.
