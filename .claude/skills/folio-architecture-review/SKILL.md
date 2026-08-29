---
name: folio-architecture-review
description: READ-ONLY audit of whether Folio's protected core architecture survived recent work — document/Layer ownership, History semantics, session state, color ownership, rendering, input, and the future AI boundary. Use after UI work, before a freeze, or when something feels architecturally off. Never fixes anything.
---

# Folio Architecture Review (Read-Only)

**One responsibility: determine whether the protected Folio core is still intact.**

## Rules of Engagement

- **This skill does not modify files.** Not a rename, not a comment, not a "trivial"
  fix. Fixes require a separate, explicitly authorized task.
- Read code, not summaries. A claim about an invariant must cite the file and line that
  proves or disproves it.
- Do not audit product taste, naming style, or visual design — that is
  `folio-ui-qa`'s job.
- Report what is true. An audit that finds nothing is a valid result; so is an audit
  that finds an S0.

The invariants being audited are defined in the repository-root `CLAUDE.md`
(§3 Protected Folio Core, §4 Color Ownership, §7 Future AI Boundary). That file is the
authority; this skill is the checklist.

---

## Audit Areas

### Document

- `PageObject` ownership unchanged — **no `layerId`**, **no page-ownership field**
- Layers still own ordered object IDs
- `PageDocument` still maintains Layers and the canonical `ObjectCollection` atomically,
  and still rejects membership/order drift in its constructor
- Immutable object/document replacement preserved
- Canonical mixed-object flattened ordering preserved; `zIndex` still derived from
  canonical position

### History

- Document mutations go through commands
- One logical user operation yields the intended History semantics — not zero, not one
  entry per pointer frame
- Preview/continuous edits do not spam History
- Cancel restores the exact prior state
- Undo/Redo remains coherent across the affected feature
- Session/presentation changes do **not** incorrectly enter History

### Session State

Confirm each of these remains editor/session state and has not drifted into the
document or into serialization:

- active Page
- active Layer
- viewport
- selection
- tool preferences
- transient UI state

### Color

- No duplicate canonical current-color state anywhere
- Selected-object edits use the established continuous editing path
- Creation-tool color remains History-free
- Picker target isolation preserved (`begin` / `preview` / `commit` / `cancel`)
- Eyedropper remains compatible with the target architecture
- `EditorColorSystem` still owns recents/favorites/palettes only

### Rendering

- Unified compositor preserved
- Page-presentation invalidation correct
- No unauthorized parallel renderer
- No UI layer writing directly into rendering internals

### Input

- UI dismissal does not swallow the first canvas action
- Pointer capture remains coherent
- Wheel/pointer ownership remains intentional

### UI Boundary

- Presentation components do not directly mutate core objects
- Controllers/adapters mediate every mutation

### AI / Teaching Future

- Transient AI or teaching data remains separate from artwork unless the user has
  explicitly accepted it into the document through a normal command

---

## Severity

| Level                  | Meaning                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| **S0 Critical**        | A protected invariant is broken. Data model, History coherence, or canonical ordering is compromised. |
| **S1 Major**           | Architecture is bypassed or duplicated in a way that will corrupt state or block a planned phase.     |
| **S2 Moderate**        | A boundary is blurred: presentation reaching into core, state in the wrong layer, missing mediation.  |
| **S3 Minor**           | Local inconsistency with the documented architecture; low blast radius.                               |
| **Upgrade suggestion** | Not a defect. An opportunity to strengthen the architecture, offered for the user's judgment.         |

Rank findings most severe first. For each finding give: the invariant, the file and
line, what actually happens, and the concrete consequence.

---

## Output

1. **Verdict** — `CORE INTACT` or `CORE COMPROMISED`.
2. **Findings**, ranked, with severity, location, and consequence.
3. **Areas audited and found clean** — say so explicitly; silence is not evidence.
4. **Anything you could not verify**, and why.

**Do not fix issues during a read-only audit.** Recommend, and stop.
