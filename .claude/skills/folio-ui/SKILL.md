---
name: folio-ui
description: Implement ONE already-approved Folio UI component accurately without damaging the protected core. Use when a Folio UI task has an approved reference, screenshot, or specification and the work is to build that component. Not for exploring designs, not for auditing architecture, not for QA.
---

# Folio UI Implementation

**One responsibility: implement one approved component, accurately, without damaging
the core.**

This skill does not design. If there is no approved reference or specification for the
component, stop and say so — collecting the reference is the user's step
(`docs/design/concepts-reference.md` §6).

---

## 1. Read Before Editing

Read, in this order:

1. The relevant sections of the repository-root `CLAUDE.md` — Protected Folio Core,
   Color Ownership, UI Redesign Rules.
2. `docs/design/folio-design-system.md`
3. `docs/design/concepts-reference.md`
4. `docs/design/workspace-layout.md`
5. The component's row in `docs/design/component-inventory.md`
6. **The exact approved feature specification/reference for this task.**

## 2. Inspect the Existing Implementation

Before writing anything, read the current implementation of the component and its
immediate neighbours. Know what exists, what it is called, which tests cover it, and
which architecture it already participates in. A redesign that does not know what it is
replacing produces duplication.

## 3. The Approved Reference Is Authoritative

For this task, the approved reference/specification wins over your own preferences and
over what is easier to build.

- Do **not** substitute a generic web UI because it is easier to implement.
- Do **not** invent an alternative design while coding.
- **If the approved design conflicts with an implementation constraint: STOP and
  report the conflict.** Do not silently redesign. Reporting a conflict is a successful
  outcome.

## 4. Preserve the Protected Architecture

Never, in a UI task:

- add `layerId` or page ownership to `PageObject`
- change Layer ownership of object IDs
- break `PageDocument`'s atomic Layers + canonical `ObjectCollection` maintenance
- change the canonical flattened render order
- abandon immutable object/document replacement
- bypass command-based History from a component
- create a parallel document state, Layer ownership, History system, selection state,
  viewport authority, or canonical color store
- turn tool or viewport state into serialized document state

Mutations go through the existing commands and controllers. **Use presentation and
controller adapters around existing commands and state** — a new panel is a new view of
existing authority, never a new authority.

Color specifically: route every color interaction through the existing
`ColorTargetAdapter` path (`begin` / `preview` / `commit` / `cancel`). Creation-tool
color stays History-free; selected-object color uses the continuous editing path.

## 5. Stay In Scope

Implement **only** the authorized component. Do not expand into adjacent UI components
without explicit permission, even when an adjacent component is obviously inconsistent
afterwards — note it in the report instead, or add a row/note to the inventory.

## 6. Build It Like Folio

- Reuse the semantic tokens in `apps/desktop/src/styles.css` and the shared primitives
  in `packages/ui`. Do not hardcode component-level colors.
- Do **not** force generic cards or panels if the approved design uses spatial or
  direct controls. Not every cluster is a white card.
- Keep artist UI **compact and canvas-first**. "Clean" does not mean oversized.
- Respect the shared motion treatment (160 ms open / 120 ms close, 5px travel, and
  opacity-only under reduced motion) unless the approved design deliberately changes it.

Respect these existing systems rather than reimplementing them:

- the floating dismissal stack
- occupied zones (`editor-occupied-zones.ts`, `editor-workspace-zones.ts`) — declare any
  new persistent surface as a hard zone
- pointer pass-through on non-interactive wrappers
- pointer capture semantics
- keyboard semantics and roles
- reduced-motion handling
- current History boundaries

**Critical input rule:** an exiting surface drops `pointer-events` immediately. A
closing panel that still intercepts presses swallows the first stroke drawn after it.

## 7. Test

- Add focused unit tests for the component's model/logic (placement, state machine,
  derived rows — the parts that can be tested without a window).
- Add or extend an Electron E2E spec for behavior that only exists in the real window.
- Run the regression gates the task calls for.

## 8. Verify Visually

Run Electron visual QA and **compare the implementation to the approved reference**:
placement, dimensions, proportions, density, spacing, hierarchy, typography, icon size,
control shape, and every state the design specifies.

Report visual discrepancies honestly, including ones you could not resolve.

> **Never declare visual success solely because automated tests pass.**

## 9. Conclusion Rule

> **If the result does not visually and behaviorally match the approved Folio design,
> continue correcting the authorized feature or return NO-GO. Do not declare success
> merely because tests are green.**

## 10. Report

- what was implemented, and the scope boundary you held
- how the approved design was matched, point by point
- any discrepancy, with the reason
- any conflict found between the design and the architecture
- tests added and gate results
- the inventory row you updated
- do not commit or push unless asked
