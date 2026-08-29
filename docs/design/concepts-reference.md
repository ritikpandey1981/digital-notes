# Concepts Reference Policy

How Folio uses the Concepts app as a design reference, what it adapts, what it never
copies, and the workflow every referenced feature goes through.

Companion documents: `folio-design-system.md`, `workspace-layout.md`,
`component-inventory.md`. Engineering constraints: repository-root `CLAUDE.md`.

---

## 1. Purpose

**Concepts is the primary professional interaction/UX reference for Folio Sketchbook
Pro.** Folio studies it feature by feature.

The goal is **not blind cloning**. The goal is to reproduce proven professional
interaction principles while adapting them to:

- Folio's visual identity
- Folio's architecture
- Folio's desktop constraints
- Folio's Pages model
- future teaching and AI requirements

---

## 2. What We Learn From Concepts

Study especially:

- spatial placement of artist controls
- drawing-tool organization
- high-frequency parameter access
- color navigation
- Layers hierarchy
- compact professional density
- direct manipulation
- transient versus persistent controls
- precision workflows
- gestures
- minimal interruption of drawing flow
- the relationship between controls and the canvas

The recurring lesson is *spatial*: a control's usefulness comes largely from being
where the thing it changes already is.

---

## 3. What Folio Modifies

Folio may freely change:

- theme and branding
- typography
- colors and accent
- exact geometry
- spacing and density
- desktop-window adaptation (Folio is a desktop Electron application, not a tablet-first
  touch app; pointer, keyboard, and window resizing are first-class)
- behavior required by Folio's architecture
- Folio Pages integration
- future lesson and AI surfaces

---

## 4. What We Do Not Copy

Never copy:

- trademarks
- branded assets
- proprietary artwork
- exact branding
- branded color names or systems presented as Folio property
- features irrelevant to Folio
- unknown implementation internals (we observe behavior, we do not guess at code)

---

## 5. Architecture Translation Rule

Correct:

```
Concepts screenshot → Folio interaction specification → Folio presentation/controller → existing Folio core
```

Incorrect:

```
Concepts screenshot → rewrite Folio document model
```

A reference tells us what an interaction should *feel* like. It has no authority over
`PageObject` ownership, Layer membership, History semantics, color ownership, the
compositor, or the viewport.

---

## 6. Feature Design Workflow

For each component:

1. User provides the exact screenshot/reference.
2. User states what they like about it.
3. User states the requested Folio tweaks.
4. Analyze:
   - geometry
   - information hierarchy
   - interaction
   - state
   - gestures
   - transient behavior
   - keyboard implications
   - pointer implications
5. Propose the Folio adaptation.
6. User approves.
7. Optionally prototype with Claude Design.
8. Claude Code implements **only the approved scope**.
9. Run regression.
10. Inspect in Electron visually.
11. User manually tests.
12. Correct discrepancies.
13. Commit/freeze.

Record the component's progress through these stages in `component-inventory.md`.

---

## 7. Claude Design Stage

Claude Design is the optional visual prototyping stage at step 7:

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

Claude Design does not override the engineering architecture in `CLAUDE.md`, and
Claude Code does not treat a mockup's internals as authoritative implementation
architecture. **The visual output is the reference; the Folio core remains
authoritative underneath.**

---

## 8. Critical Claude Rule

If an approved screenshot or specification exists:

> **Do not substitute a generic web UI because it is easier to implement.**

If implementation constraints conflict with the approved design:

> **STOP and report the conflict. Do not silently redesign.**

Reporting a conflict is a successful outcome. Quietly shipping a different design is
not.

---

## 9. Current Agreed Design Directions

These are **accepted high-level direction, not implemented state**. Exact UI is
reference-driven and still to be designed. Implementation status lives in
`component-inventory.md`.

### Layers

- fixed top-right artwork-utility direction
- Concepts/Procreate-informed, readable Layers panel
- substantial, readable layer rows
- thumbnails eventually
- visibility, name, opacity, lock/actions
- drag reorder
- a Select mode for bulk operations
- bulk Duplicate/Delete first
- Group and Merge **only after** Advanced Layers supports them correctly
- Export/Share **only after** export support exists
- a special Background representation backed by `Page.paper`
- **Background is not a real Layer**

### Drawing Tools

- Concepts-style spatial drawing controls preferred
- high-frequency parameters accessible close to the active tools
- advanced configuration may remain in detailed Tool Options
- final implementation to be designed from exact screenshots

### Color

- Spectrum 1A — the systematic OKLCH-derived model — remains available as underlying
  infrastructure only
- the rejected Spectrum 1B custom cylindrical UI is **not approved** and is not a
  design input
- future color UI will be redesigned from exact Concepts references
- existing canonical color ownership remains unchanged
- RGB and other precision controls must use the existing color targets
- **no duplicate current-color state**

### Top / Document Controls

High-level direction:

- Home/File/document access on the top-left
- document title/status where appropriate
- Undo, Redo, Pages, Page Settings and current-document actions toward the right as
  appropriate

Exact final UI remains reference-driven.

---

## 10. What a Good Reference Submission Contains

To move a component from "not collected" to "reference collected", the submission
should ideally include:

- the screenshot(s), including the states that matter (closed, open, hovered, selected)
- what specifically is liked about it
- the requested Folio deviations
- any interaction that a still image cannot show (gesture, transient timing, what
  dismisses it)

Anything missing becomes an explicit open question rather than an assumption.
