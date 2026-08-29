# Folio Workspace Layout v0.1

This document defines **spatial responsibility**, not final pixel positions. It says
what each region of the editor is *for*, so that a new control has an obvious home and
a misplaced one is identifiable as misplaced.

Exact geometry is decided per component from the approved reference. Companion
documents: `folio-design-system.md`, `concepts-reference.md`,
`component-inventory.md`.

```
┌──────────────────────────────────────────────────────────────┐
│  TOP  —  application / document navigation and actions       │
├──────┬────────────────────────────────────────────┬──────────┤
│ LEFT │                                            │  RIGHT   │
│      │             CENTER — artwork               │          │
│ what │                                            │ how it's │
│ I    │        (canvas is the priority)            │ organized│
│ draw │                                            │ + color  │
│ with │                                            │          │
├──────┴────────────────────────────────────────────┴──────────┤
│  BOTTOM / PERIPHERAL — low-priority viewport & status        │
└──────────────────────────────────────────────────────────────┘
```

---

## 1. Top

**Purpose:** application/document navigation plus document-level actions.

Potential contents:

- Folio / Home
- File
- document title and status
- Undo
- Redo
- Pages
- Page Settings
- future application actions

**Rule:** drawing controls do not migrate into the top bar merely because space
exists there. The top bar answers *"which document am I in, and what can I do to the
document?"*

---

## 2. Left

**Purpose:** creation and drawing.

Future responsibilities:

- selection
- drawing tools
- eraser
- shapes
- brush/tool presets
- high-frequency parameters
- Concepts-inspired tool controls

The left side answers two questions:

> "What am I drawing with?"
> "How is this tool configured right now?"

The second question is the one Folio's redesign most needs to answer better — a
high-frequency parameter that requires opening a panel is in the wrong place.

---

## 3. Center

**Purpose:** artwork. This is the priority region.

Contains:

- the workspace
- the Page
- the artwork
- selection chrome
- drawing preview
- manipulation preview
- precision overlays
- future teaching overlays
- future transient AI overlays

**Canvas interaction remains the highest priority in the application.** Any conflict
between a chrome affordance and a canvas interaction resolves in favour of the canvas.

---

## 4. Right

**Purpose:** artwork organization plus color/material context.

Future hierarchy may include:

- Layers
- the color system
- artwork utilities

The right side answers:

> "How is my artwork organized?"
> "What color/material context am I using?"

---

## 5. Bottom / Peripheral

**Purpose:** low-priority viewport and status utilities.

Examples:

- zoom
- Fit Page
- hints
- lightweight status

**Do not overload this area.** It is where things go when they must be reachable but
must not compete for attention. It is not an overflow bin for controls that did not
fit elsewhere.

---

## 6. Transient UI

Transient surfaces may appear spatially near the relevant action:

- context menus
- tool detail controls
- transform values
- color expansions
- precision values
- temporary menus

These must use the existing occupied-zone/placement architecture
(`editor-occupied-zones.ts`, `editor-workspace-zones.ts`) rather than ad-hoc
positioning, and must register with the shared floating dismissal stack. A surface
that is not declared as an occupied zone will be landed on by the next surface.

---

## 7. Canvas-First Rule

**The UI frames the canvas.** The canvas must not become a small region surrounded by
permanent controls.

Practical consequence: a new permanent control competes for canvas area and must
justify itself against a transient or spatially-anchored alternative.

---

## 8. Stability Rule

Permanent triggers must not relocate simply because nearby transient content appears
or disappears, unless the approved interaction explicitly requires it.

A trigger that moves when its own panel opens breaks the "click twice to toggle"
muscle memory that professional users rely on.

---

## 9. Current Implementation Note

As of this document, the shipped editor already follows this division: document
controls along the top, a left tool dock, the artwork utility rail and color rail on
the right, and viewport controls peripheral. The redesign refines *how* each region
works — it is not expected to relocate a region's responsibility. A proposal that moves
a responsibility between regions is a design decision requiring explicit approval, not
an implementation detail.
