# Folio

Folio is a Windows-first, offline-first professional sketchbook built with Electron,
React, TypeScript, and Canvas 2D.

The repository contains a live multi-page, multi-layer editor with immutable Ink and
vector objects, command-based undo/redo, selection and manipulation, drawing tools,
color workflows, and Electron integration. Projects are saved to and opened from a
single canonical `.folio` file, with unsaved-change protection and crash recovery. The
folder serialization in the persistence package still serves an older notebook model
and is unrelated to that flow.

## Requirements

- Node.js 22.12 or newer
- pnpm 11 or newer
- Windows for the packaged desktop target

## Start developing

```powershell
pnpm install
pnpm dev
```

## Common checks

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Use `pnpm format` only when a broad formatting rewrite is intentional. Package an
unpacked Windows application with:

```powershell
pnpm package
```

## Repository shape

| Path                    | Purpose                                                       |
| ----------------------- | ------------------------------------------------------------- |
| `apps/desktop`          | Electron host, React workspace, and product UI                |
| `packages/document`     | Live pages, layers, and artwork objects                       |
| `packages/editor`       | Sessions, tools, commands, selection workflows, and color     |
| `packages/history`      | Generic command History and compatibility History             |
| `packages/ink`          | Pointer capture, strokes, brushes, and ink geometry           |
| `packages/rendering`    | Canvas, viewport, compositor, and overlays                    |
| `packages/selection`    | Low-level selection and hit testing                           |
| `packages/manipulation` | Model-neutral object transformations                          |
| `packages/persistence`  | Canonical `.folio` project codec, and the older notebook path |
| `packages/domain`       | Older notebook model behind that legacy path                  |
| `packages/ui`           | Shared React primitives                                       |
| `tests/e2e`             | Playwright Electron tests                                     |

## Documentation

Start with [`AGENTS.md`](AGENTS.md) for repository rules, then route by task:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — implemented system and boundaries
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — durable engineering choices
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — verified gaps and future work
- [`docs/design/folio-design-system.md`](docs/design/folio-design-system.md) — visual,
  spatial, motion, and interaction rules
- [`docs/design/drawing-tool-system.md`](docs/design/drawing-tool-system.md) — drawing
  slots, brushes, properties, shapes, and color behavior
- [`docs/design/brush-engine-architecture.md`](docs/design/brush-engine-architecture.md) —
  brush pipeline, strategy model, and durability contract
- [`docs/archive/README.md`](docs/archive/README.md) — non-authoritative historical
  material

Package-level contracts are summarized in each substantive package's `README.md`.
