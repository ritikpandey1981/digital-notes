# Folio repository guidance

This file is the repository-wide operating guide for coding agents. Read it before
changing Folio. More specific `AGENTS.md` or `AGENTS.override.md` files, if added
later, may refine these rules for their subtree.

## Product direction

Folio is a Windows-first, offline-first professional sketchbook. The drawing editor
is the platform; learning and AI features are future clients of it, not alternate
document or rendering systems.

Work in narrow, reviewable increments. Preserve the approved product design and the
core architecture. If those conflict, report the conflict instead of silently
redesigning either one.

## Source of truth

Current source code and tests outrank stale documentation. Route questions narrowly:

- Architectural questions: `docs/ARCHITECTURE.md`.
- Non-obvious rationale and constraints: `docs/DECISIONS.md`.
- Current/future implementation status, planning, or scope: `docs/ROADMAP.md`.
- UI work: `docs/design/folio-design-system.md`.
- Drawing-tool work: also read `docs/design/drawing-tool-system.md`.
- Brush-engine work: also read `docs/design/brush-engine-architecture.md`.
- Package internals: read that package's `README.md` and public exports.
- Historical context only: `docs/archive/README.md`.

Never inspect `docs/archive/**` during normal implementation work. Read archived
material only when the user explicitly requests historical information or when an
unresolved contradiction cannot be answered from current source, tests, and active
documentation.

Archived documents, phase reports, screenshots, generated reports, and pitch artifacts
are historical and non-authoritative.

## Protected architecture

- `PageObject` has neither a `layerId` nor a page-ownership field.
- Layers own ordered object IDs.
- `PageDocument` atomically maintains layers and one canonical flattened
  `ObjectCollection`; membership or order drift must remain unrepresentable.
- Array order is canonical render order. Do not add independent Layer z-index state.
- Documents and objects change through immutable replacement.
- Document mutations use commands and History. UI components do not bypass them.
- One logical operation gets one logical History entry; previews do not create one
  entry per frame.
- Active page, active layer, per-page viewport, selection, tool preferences, and
  transient UI remain editor-session state unless a deliberate architecture decision
  says otherwise.
- Keep one viewport authority, one compositor, and the established selection and
  manipulation systems.
- Preserve exact Ink source samples and committed brush snapshots.
- Pointer cancellation never half-commits; page dismissal may continue the same canvas
  action, while workspace-surround dismissal may intentionally consume it.
- Current artwork color stays behind the tool/selection target architecture.
  `EditorColorSystem` owns recents, favorites, and palettes, not a second current
  color.
- The live `SketchbookDocument` is not wired to legacy Notebook persistence; migration
  work must not create a third document authority.
- Future teaching or AI output is transient until the user accepts it through a
  normal command.

## Change discipline

- Start with the requested subsystem, touched files, adjacent interfaces, and nearest
  tests. Do not perform repository-wide analysis for a leaf task.
- Expand scope only when dependency evidence requires it. Do not read every Markdown
  document before implementation.
- Prefer existing controllers, adapters, tokens, and primitives over parallel state.
- Do not add dependencies, widen package responsibilities, or revive legacy code
  without explicit scope.
- Keep editor UI compact, canvas-first, keyboard-accessible, and safe for pointer
  capture and reduced motion.
- A closing surface must stop intercepting pointer events immediately.
- Preserve unrelated working-tree changes. Do not commit or push unless asked.
- Keep active documentation durable: update the canonical guide instead of adding a
  phase-completion report.
- Leave the tree in a working state: it should compile, launch, and keep existing
  behavior at every commit.

## Code conventions

React components and hooks are `PascalCase.tsx` and `useCamelCase.ts`; every other
module is kebab-case. Constants are `UPPER_SNAKE_CASE` and functions are verb-based.

Comments explain intent and the reason a decision was made, not what the next line
does. Prefer recording why an alternative was rejected over restating the code; the
existing model and motion modules are the reference for the expected density.

## Testing tiers

- **Tiny/local:** focused test plus the affected check or typecheck when appropriate.
- **Subsystem:** relevant package/component tests plus the relevant integration or
  Electron test.
- **Architectural:** invariant/API tests first, then broader unit tests, typecheck,
  lint, build, and relevant E2E.
- **Release:** full regression, build, E2E, packaging, and applicable manual-device QA.

Use the commands documented in `README.md`. Start with focused tests. Electron pointer
tests require a foreground window; rerun a
suspected focus failure alone before treating it as a product regression. Automated
checks do not replace visual comparison for UI work. Never run a repository-wide
formatter merely to clean one file.

## Documentation policy

Update canonical documents instead of adding phase or completion reports. Do not keep
implementation chronology as permanent guidance, and do not duplicate inventories
that current source can answer cheaply.
