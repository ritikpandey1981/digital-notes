# Folio

Folio is a Windows-first, offline-first digital notebook focused on a calm and
responsive writing experience.

This repository currently contains the Phase 1 application foundation:

- Electron desktop runtime
- React 19 and TypeScript
- Vite development and production builds
- Tailwind CSS
- shadcn-compatible UI primitives
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
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

## Desktop packaging

```powershell
pnpm package
```

Project requirements and engineering decisions are maintained in `docs/`.
