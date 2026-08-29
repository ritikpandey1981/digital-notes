# Folio — Engineering Constitution

This file is the project's engineering source of truth. It is deliberately short.
Detailed visual and interaction rules live in `docs/design/`; repeatable Claude
workflows live in `.claude/skills/`.

Read this file before any Folio task. Read the design documents before any UI task.

---

## 1. What Folio Is

Folio is a professional digital sketchbook and editor for the desktop. It will
later gain structured drawing education and AI coaching, but those are future
clients of the editor, not replacements for it.

Product strategy, in order:

1. Preserve and finish the professional drawing/editor core.
2. Redesign the professional UI/UX.
3. Implement missing Sketchbook Pro capabilities.
4. Validate a standalone Sketchbook Pro release.
5. Build learning and practice systems.
6. Build AI drawing analysis and coaching.

> **The professional sketchbook is the platform.**
> Teaching and AI are future clients of that platform.

The legacy `docs/01_Product_Vision.md` … `docs/07_Development_Standards.md` volumes
describe Folio's earlier "digital notebook" framing. They remain useful history and
still hold accurate engineering standards, but for the UI redesign the authoritative
documents are `docs/design/*`, and for the core architecture they are
`docs/architecture/*` plus this file.

---

## 2. Repository Shape

| Path                                                                        | Responsibility                                                    |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/desktop`                                                              | Electron + React shell, editor workspace, all product UI          |
| `packages/document`                                                         | `SketchbookDocument`, `Page`, `PageDocument`, `Layer`, objects    |
| `packages/history`                                                          | Generic history manager and the editor history stack              |
| `packages/editor`                                                           | Editor foundation, commands, sessions, color model, tool registry |
| `packages/ink`                                                              | Stroke capture, `sourceSamples`, ink processing                   |
| `packages/rendering`                                                        | Compositor, camera/viewport, overlay renderers                    |
| `packages/selection`, `packages/manipulation`                               | Selection and transform systems                                   |
| `packages/persistence`, `packages/domain`, `packages/shared`, `packages/ui` | Support layers                                                    |
| `tests/e2e`                                                                 | Playwright Electron end-to-end specs                              |

---

## 3. Protected Folio Core

The current drawing/editor architecture is the protected platform underneath the
new UI. The document hierarchy is:

```
SketchbookDocument
  └── ordered Pages
        └── Page  (geometry + paper + content)
              └── PageDocument
                    └── Layers  +  canonical flattened ObjectCollection
```

### Non-negotiable invariants

- `PageObject` has **no** `layerId`.
- `PageObject` has **no** page-ownership field.
- **Layers own ordered `PageObject` IDs.**
- `PageDocument` atomically maintains Layers and the canonical flattened
  `ObjectCollection`; a state where membership and flattened order disagree is
  rejected by the constructor and must remain unrepresentable.
- **One canonical mixed-object flattened render order is authoritative.** `zIndex`
  is derived from canonical array position, never stored on a Layer.
- **Immutable object/document replacement** remains the mutation model.
- **History remains command-based.**
- Page-level mutations are lifted into `SketchbookDocument` History where appropriate.
- One logical user mutation produces the intended logical History operation —
  not zero, not one per pointer frame.
- **Undo/Redo must not be bypassed by UI components.**

### Session/editor state stays outside document History

- active Page
- active Layer
- per-page viewport
- selection
- tool preferences
- transient UI state
- color-panel presentation state
- future teaching overlays (by default)
- future AI guidance (by default)

Tool and viewport state must not silently become serialized document state.

### Preserve as-is unless a dedicated phase says otherwise

- the unified compositor
- renderer ownership boundaries
- pointer/input controller architecture
- exact Ink `sourceSamples` / process data
- the existing selection and manipulation systems
- the existing viewport authority
- Page presentation and invalidation boundaries
- clipboard and serialization boundaries

> **UI adapts to the Folio core. The Folio core must not be mutated merely because
> a reference application appears to implement a feature differently.**

---

## 4. Color Ownership

Application artwork colors are canonical lowercase hex. Existing color ownership
remains authoritative.

`EditorColorSystem` (`packages/editor/src/foundation/color-system.ts`) owns
Recent Colors, Favorites, and palettes. **It is not the canonical current-color
store.** Current color remains behind the existing tool/selection target
architecture.

Preserve:

- History-free color targets for creation tools
- continuous color editing for selected objects
- `ColorTargetAdapter` ownership and lifecycle (`begin` / `preview` / `commit` / `cancel`)
- Full Picker transaction semantics
- Eyedropper isolation
- cancel/commit semantics

Never introduce a parallel current-color store — no `SpectrumCurrentColor`, no
`activeSpectrumColor`, no second `selectedColor`.

Future color UI must be:

```
new presentation → existing color target/controller → existing core
```

not:

```
new presentation → new independent color state
```

**Spectrum status.** Spectrum 1A (`packages/editor/src/foundation/folio-spectrum.ts`,
`oklch-color.ts`) is available as pure systematic palette/model infrastructure: data
and lookup only, owning no application state. **The rejected Spectrum 1B custom
cylindrical color UI is not an approved design** and must not be treated as one. It
lives only in a git stash, which must remain untouched.

---

## 5. UI Redesign Rules

**Concepts is the primary professional interaction/UX reference** for the Folio
Sketchbook Pro redesign. This does not mean pixel-for-pixel cloning — see
`docs/design/concepts-reference.md`.

The workflow is:

```
Concepts reference
  → analyze interaction
  → define Folio adaptation
  → user approval
  → optional Claude Design prototype
  → Claude Code implementation
  → automated QA
  → manual visual QA
  → correction
  → freeze
```

Claude Code must **not** invent major alternative UI when an approved
reference/specification exists. For major UI tasks the responsibility is:

> "Implement the approved Folio design accurately without breaking the protected core."

not:

> "Invent a different design while coding."

**If an approved design conflicts with current implementation constraints: STOP and
report the conflict. Do not silently redesign the requested interaction.**

Visual and interaction detail is not repeated here. See:

- `docs/design/folio-design-system.md` — product character, tokens, foundations, states
- `docs/design/concepts-reference.md` — reference policy and per-feature workflow
- `docs/design/workspace-layout.md` — spatial responsibility of each region
- `docs/design/component-inventory.md` — living UI migration tracker

---

## 6. One Component At A Time

Every significant UI component is implemented separately. A normal UI milestone is:

1. inspect the exact current implementation
2. read the approved reference/specification
3. implement only that component
4. add focused tests
5. run regression
6. run Electron visual QA
7. user manually evaluates it
8. make scoped corrections
9. freeze/commit
10. move to the next component

Do not combine unrelated UI redesigns into one implementation task unless explicitly
authorized.

---

## 7. Future AI Boundary

No AI code is to be implemented now. The architecture must simply stay ready for it.

Future teaching/AI state is **transient by default**. AI must never directly and
silently mutate `PageObject` or document state. The preferred pattern is:

```
editor/document/process context
  → analysis
  → transient guidance/overlay
  → optional suggested action
  → user explicitly accepts
  → normal Folio command
  → History
```

Transient by default: construction suggestions, visual guides, critique annotations,
lesson goals, practice overlays, coaching messages, measurement feedback. These enter
artwork and History only when explicitly converted into real document content.

---

## 8. Development Workflow

Work arrives as numbered, scoped briefs. Honour the stated scope exactly. Do not pull
deferred items forward. Do not commit or push unless asked — the working tree is the
deliverable and is reviewed before it becomes history.

### Gates

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

Plus `git diff --check`, and `pnpm package` when a brief asks for it.

Notes:

- `docs/` is in `.prettierignore`; never run a repository-wide formatter to fix a
  documentation file.
- Electron pointer E2E specs need foreground window focus. Re-run a failing pointer
  spec on its own before calling it a regression.
- The reorder performance test is the one wall-clock unit assertion; do not chain it
  behind lint/typecheck on a loaded machine.

A pass is either green or it is a **NO-GO**. Report a NO-GO honestly rather than
stretching to reach green.

### Testing expectations

- Unit/integration: Vitest, colocated in each package's `__tests__`.
- End-to-end: Playwright against real Electron, in `tests/e2e`.
- Every significant UI component gets focused tests for its model/logic, plus an
  Electron spec for behavior that only exists in the real window.
- Automated green is necessary but **never sufficient** for a visual freeze.

---

## 9. Project-local Claude Skills

- `.claude/skills/folio-ui` — implement one approved UI component without damaging the core
- `.claude/skills/folio-architecture-review` — read-only architectural audit
- `.claude/skills/folio-ui-qa` — visual/behavioral QA of one implemented component before freeze

---

## 10. Hard Rules Summary

- Do not change the `PageObject` / Layer / `PageDocument` ownership model.
- Do not bypass command-based History from UI.
- Do not create a second canonical current-color store.
- Do not create a parallel renderer, selection system, or viewport authority.
- Do not restore or apply the rejected Spectrum 1B experiment.
- Do not silently redesign an approved design — stop and report the conflict.
- Do not declare visual success because tests are green.
- Do not commit or push unless explicitly asked.
