# Folio Design System v0.1

This is a **foundation, not a finished specification**. It fixes the principles that
every Folio UI decision must respect, records the current guidance derived from the
implementation as it stands today, and is explicit about the values that are still
open and will be settled per component from exact references.

Three kinds of statement appear throughout, and they are labelled:

- **FIXED** — a principle. Changing it requires an explicit product decision.
- **CURRENT** — today's guidance, derived from the shipped implementation. Follow it
  unless an approved component design deliberately changes it.
- **OPEN** — deliberately unfinalized. Decide per component, from the approved
  reference, and record the decision in `component-inventory.md`.

Companion documents: `concepts-reference.md` (reference policy),
`workspace-layout.md` (spatial responsibility), `component-inventory.md` (tracker).
Engineering constraints live in the repository-root `CLAUDE.md`.

---

## 1. Product Character

**FIXED.** Folio should feel:

professional · creative · direct · calm · lightweight · tactile · canvas-first ·
artist-oriented · efficient · suitable for long drawing sessions

It must **not** feel like:

- a SaaS dashboard
- Office-style productivity software
- a Notion clone
- a OneNote clone
- a generic web admin UI
- a collection of ShadCN cards
- a large modal-driven settings application

Primary UX inspiration is **Concepts**. Folio translates Concepts' professional
spatial-control philosophy into Folio's own lighter visual identity.

---

## 2. Visual Identity

**CURRENT direction:**

- light-neutral workspace
- warm/light paper
- restrained floating surfaces
- muted indigo/violet accent
- neutral typography
- artwork provides most of the visual color
- minimal decorative chrome
- high canvas visibility
- direct manipulation

**FIXED:** Do not imitate Concepts' dark palette directly. The *interaction*
philosophy is Concepts-inspired; the *visual identity* stays Folio's own. Folio ships
both light and dark themes; light is the reference identity and dark is a faithful
translation of it, not a separate design.

---

## 3. Color Roles

Semantic tokens already exist in `apps/desktop/src/styles.css`, defined per theme on
`:root` / `[data-theme="light"]` / `[data-theme="dark"]` and exposed to Tailwind via
`@theme inline`. **Reuse them.** Do not introduce component-level hardcoded colors.

| Role                  | Token                                          |
| --------------------- | ---------------------------------------------- |
| workspace/background  | `--folio-workspace`                            |
| top bar               | `--folio-topbar`                                |
| paper (page)          | `--folio-paper`, `--folio-page`                 |
| area around the page  | `--folio-paper-surround`                        |
| primary surface       | `--folio-surface`                               |
| subtle surface        | `--folio-surface-muted`                         |
| elevated/floating     | `--folio-glass` + `--folio-shadow-floating`     |
| primary text/ink      | `--folio-ink`                                   |
| secondary text        | `--folio-muted`                                 |
| neutral icon          | `--folio-icon-neutral`                          |
| border                | `--folio-border`                                |
| accent                | `--folio-accent`                                |
| accent hover          | `--folio-accent-hover`                          |
| selected background   | `--folio-accent-soft`, `--folio-surface-active` |
| hover background      | `--folio-surface-hover` / `--folio-hover`       |
| selection chrome      | `--folio-selection`                             |

**OPEN.** Folio does not yet have dedicated tokens for every role a mature editor
needs. The following are **required to be defined before the components that need
them are frozen**, and must be added as semantic tokens rather than inline values:

- tertiary text
- strong border
- focus ring (currently drawn from `--folio-accent`)
- destructive / destructive hover
- warning
- success
- disabled foreground and disabled surface

**FIXED distinctions that must never blur:**

- **Artwork color is canonical lowercase hex** and belongs to the document. It is
  never a theme token.
- **Paper color** is a `Page.paper` property, not a theme token and not a Layer.
- **Theme tokens** describe chrome only.

---

## 4. Typography

**CURRENT.** The repository font is **Inter** (`@fontsource-variable/inter`, exposed
as `--font-sans`). Keep it unless a deliberate product decision replaces it.

Define type by role rather than by ad-hoc size:

| Role                    | Intent                                                 |
| ----------------------- | ------------------------------------------------------ |
| top/app navigation      | compact, quiet, never a page heading                   |
| panel title             | small, medium weight, clearly subordinate to artwork   |
| control label           | compact, high legibility at small size                 |
| compact metadata        | smallest readable size, secondary color                |
| numeric tool value      | tabular figures, stable width while dragging           |
| menu item               | comfortable hit target, normal weight                  |
| tooltip                 | small, single-line by default                          |
| destructive confirmation| normal weight; emphasis comes from wording, not size   |
| secondary/status        | secondary color, low prominence                        |

**FIXED.** Professional editor typography is compact and highly legible. Avoid
oversized dashboard headings inside the editor. Numeric values that change during a
drag must not reflow their neighbours.

**OPEN.** Exact sizes, weights and line-heights per role are decided per component
from the approved reference.

---

## 5. Spacing

**CURRENT conceptual scale:** `4 · 6 · 8 · 12 · 16 · 24`.

**FIXED:**

- Do not force every component to the same density. Drawing controls may legitimately
  be denser than dialogs.
- The canvas area remains dominant.
- Spacing is a rhythm, not a rule to satisfy — a control cluster that reads correctly
  at 6px must not be padded to 16px for consistency's sake.

---

## 6. Radii

**CURRENT.** Restrained corner radii. `--folio-floating-radius` is `14px` today for
floating surfaces; small controls sit around 8–10px.

Roles:

| Role                  | Intent                                    |
| --------------------- | ----------------------------------------- |
| tiny control          | just enough to soften the corner          |
| drawing-tool control  | small, consistent across the tool cluster |
| compact popup         | between control and panel                 |
| floating panel        | `--folio-floating-radius`                 |
| dialog                | panel radius or slightly larger           |

**FIXED.** Do not turn every rectangle into a pill. Pill geometry is used only when
interaction semantics call for it (a track, a segmented control, a chip) or when the
approved reference uses it.

---

## 7. Elevation

**FIXED hierarchy**, lowest to highest:

```
canvas / workspace  →  floating control  →  panel  →  modal
```

**CURRENT.** Prefer a **subtle border plus a restrained shadow**
(`--folio-shadow-quiet`, `--folio-shadow-floating`) over a heavy drop shadow. Avoid
large web-card shadows; elevation should read as "this floats above the artwork", not
as decoration.

---

## 8. Iconography

**CURRENT.** Lucide React, already used throughout the editor.

**FIXED rules:**

- consistent optical size within a cluster (optical, not just box size — the tool dock
  already carries per-icon optical offsets where a glyph needs them)
- drawing-tool recognizability matters more than decorative novelty
- use text when an icon-only meaning is ambiguous
- custom icons require product justification
- destructive controls must not dominate the normal interface

---

## 9. Motion

**CURRENT baseline**, defined in `apps/desktop/src/motion/`:

- floating surfaces: **160 ms open / 120 ms close**, 5px travel
  (`FLOATING_SURFACE_MOTION`)
- hover 100 ms · press 75 ms · selection 140 ms · tooltip 120 ms · content 150 ms
  (`INTERACTION_MOTION`)
- shared ease `cubic-bezier(0.22, 1, 0.36, 1)`

**FIXED:**

- Preserve these conventions unless an approved component design deliberately changes
  them; one shared treatment is why two panels opened in a row read as one application.
- Prefer subtle translation, opacity, and spatially meaningful motion.
- **Reduced motion means opacity only** — no spatial travel at all, not a shorter
  version of it.
- **Motion must never delay interaction.** An exiting surface drops `pointer-events`
  immediately; a closing panel that still intercepts presses swallows the first stroke
  drawn after it.
- Avoid decorative animation that interrupts drawing.

Direct-manipulation features may later use specialized motion; that is decided per
component.

---

## 10. States

Every interactive component documents its treatment of:

`default` · `hover` · `active` · `selected` · `focused` · `disabled` · `locked` ·
`hidden` · `dragging` · `previewing` · `destructive`

**FIXED:**

- Selected/active artist state uses the restrained indigo/violet language
  (`--folio-accent`, `--folio-accent-soft`).
- **Hover stays quieter than active/selected.** Hover is a neutral wash
  (`--folio-surface-hover`); accent is reserved for real state.
- `locked` and `hidden` are Layer/object semantics, not styling moods — they must be
  legible without color alone.
- `previewing` (a live continuous edit) must be visually distinguishable from a
  committed value, because the two differ in History semantics.

---

## 11. Direct Manipulation

**FIXED.** Prefer *adjust where the feature lives* over *open a large generic settings
dialog*.

- tool settings near the drawing tools
- layer operations in the Layers UI
- color operations in the color controls
- transform controls near or around the selection
- precision values close to the parameter being manipulated

---

## 12. UI Density

**FIXED.** Professional drawing software is allowed to be compact. "Clean" does not
mean oversized. Optimize for:

- high canvas occupancy
- short pointer travel
- readable controls
- quick repetitive use

---

## 13. Floating Surfaces

**FIXED.** Not every control cluster should become a large white card. Concepts often
succeeds because controls are spatially related to what they manipulate.

Use a floating surface only when it improves hierarchy or interaction. When one is
used it must participate in the existing architecture:

- the shared floating dismissal stack
- the occupied-zone placement model (`editor-occupied-zones.ts`,
  `editor-workspace-zones.ts`) — declare the surface as a hard zone
- pointer pass-through for the non-interactive wrapper
- the shared floating motion treatment

---

## 14. Numeric Precision

**FIXED.** Where a parameter benefits from precision:

```
direct manipulation first → numeric feedback → optional exact entry
```

Do not force text input for ordinary artist workflows. Exact entry is an escape
hatch, not the primary path.

---

## 15. Accessibility

Final components support, where meaningful:

- keyboard operation
- visible focus
- correct roles
- correct state semantics (`aria-pressed`, `aria-expanded`, `aria-selected`)
- adequate hit targets
- state communicated by more than color alone
- reduced motion
- screen-reader structure **without** excessive noisy tab stops — a dense artist
  toolbar should be one composite widget with arrow-key traversal, not forty tab stops

---

## 16. Minimum Window / Responsive Editor

**FIXED.** The editor remains canvas-first. At constrained window sizes:

- drawing remains possible
- actionable UI is protected before decorative UI
- placement fallback is deterministic, not first-fit-by-accident
- the existing occupied-zone architecture is respected
- decorative elements must not push important controls into bad placement

**OPEN.** The exact minimum supported window size and the per-component collapse
order are decided per component and recorded in the inventory.

---

## 17. Temporary UI

**FIXED.** Temporary compatibility UI must be explicitly documented — in this
repository that means a row in `component-inventory.md` marked as temporary, with the
component it is waiting on.

Once an approved replacement becomes functional, **remove the obsolete temporary UI**.
Do not leave duplicate permanent controls for the same action indefinitely.

---

## 18. Component Lifecycle

**FIXED.** Every significant UI component follows:

```
reference → analysis → Folio adaptation → approved specification
  → implementation → automated QA → visual QA → user manual QA
  → correction → freeze
```

No major component skips the design step. The skills that operate each stage are
`.claude/skills/folio-ui` (implementation) and `.claude/skills/folio-ui-qa`
(validation), with `.claude/skills/folio-architecture-review` auditing that the core
survived.

---

## 19. Claude Design in the Loop

Claude Design may be used as the **visual prototyping stage** between an approved
reference and implementation:

```
Concepts screenshot + user requested changes + Folio Design System
        ↓
Claude Design prototype/mockup
        ↓
user approves visual direction
        ↓
Claude Code implementation
        ↓
Electron comparison
        ↓
user final QA
```

**FIXED boundaries:**

- Claude Design does **not** override the engineering architecture in `CLAUDE.md`.
- Claude Code does **not** treat generated mockup internals — its component
  structure, state handling, or styling approach — as authoritative implementation
  architecture.
- **The visual output is the reference. The Folio core remains authoritative
  underneath.**

---

## 20. Open Questions

Decide these only when exact Concepts references are provided:

- final type scale values per role
- the missing semantic tokens listed in §3
- exact radii per control class
- exact minimum supported window size and per-component collapse order
- whether any direct-manipulation gesture needs motion outside the shared treatment
- the visual language for future teaching/AI overlays, which must remain visually
  distinct from artwork
