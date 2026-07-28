# Folio

Folio is a Windows-first, offline-first digital notebook focused on a calm and
responsive writing experience.

The repository currently contains the implemented foundation through Phase 11:

- Electron/React desktop shell and reusable UI primitives
- immutable notebook domain and folder-based persistence
- Canvas 2D rendering, viewport, and ink infrastructure
- immutable editor document objects
- selection, hit testing, and translation manipulation
- legacy notebook History plus generic editor undo/redo, transactions, and keyboard integration
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
architecture and developer guide.
