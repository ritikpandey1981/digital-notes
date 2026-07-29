# Folio

Folio is a Windows-first, offline-first digital notebook focused on a calm and
responsive writing experience.

The repository currently contains the implemented foundation through Phase 13.2:

- Electron/React desktop shell and reusable UI primitives
- immutable notebook domain and folder-based persistence
- Canvas 2D rendering, viewport, and ink infrastructure
- immutable editor document objects
- transform-aware selection and hit testing plus translation, rotation, and scale manipulation
- legacy notebook History plus generic editor undo/redo, transactions, and keyboard integration
- generalized immutable manipulation results and editor adapters for Move, Rotate, Scale, Delete, and Duplicate commands
- one-entry stroke undo/redo, universal Select-tool move/scale/rotate targeting, forgiving bounds selection, deterministic duplicate offset, and Pen-driven selection clearing
- session-scoped copy, cut, paste, duplicate, delete, and Select All workflows with grouped multi-object undo/redo
- fresh paste identities, deterministic repeated-paste offsets, editor-owned logical multi-selection, editing shortcuts, and a capability-aware desktop context menu
- combined logical-selection bounds, grouped move/scale/rotate transactions, manipulation cursors, and constant-width transformed ink
- simplified handle-driven tooling, smooth cached cubic ink paths, rotation-specific cursor feedback, grab/grabbing move feedback, and more usable selection handles
- ESLint, Prettier, Vitest, and Playwright configuration
- Package-oriented project structure

## Prerequisites

- Node.js 22.12 or newer
- pnpm 11 or newer

## Development

```powershell
pnpm install
pnpm dev
```

## Quality checks

```powershell
pnpm format
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
```

## Desktop packaging

```powershell
pnpm package
```

Project requirements and engineering decisions are maintained in `docs/`. See
`docs/architecture/PHASE11_HISTORY_ARCHITECTURE.md` for the current History
architecture and developer guide, and
`docs/architecture/PHASE12_MANIPULATION_FRAMEWORK.md` for the manipulation
extension boundary. Phase 13 clipboard behavior is documented in
`docs/interaction/PHASE13_CLIPBOARD_WORKFLOW.md`; subsequent interaction polish is documented in
`docs/interaction/PHASE13_1_INTERACTION_POLISH.md` and
`docs/interaction/PHASE13_2_FINAL_EDITOR_UX_POLISH.md`.
