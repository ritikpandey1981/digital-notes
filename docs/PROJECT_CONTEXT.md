# Folio Project Context

## Snapshot

This handoff reflects repository state at commit `578feb3` on branch
`ui/concepts-redesign`, reviewed on 2026-09-08. The working tree was clean before
this file was added. It summarizes current first-party source, tests, package
manifests, and the active documentation; generated dependencies/build output,
historical material under `docs/archive/**`, and the separate pitch artifact under
`docs/genesis-eir-pitch/` are not product sources of truth.

Folio is a Windows-first, offline-first professional sketchbook. The live drawing
editor is the product platform. Learning and AI are future clients of that platform,
not alternative document or rendering systems. The immediate product milestone is
to finish and visually approve the Professional Sketchbook UI/UX v1, then connect
the live document to durable storage before broadening the feature set.

## System map

- `apps/desktop` is the Electron/React application. `electron/main.ts` creates a
  sandboxed window; `preload.ts` exposes only platform/runtime metadata. The renderer
  enters through `src/main.tsx`, then `App`, `ApplicationShell`, `EditorWorkspace`,
  `CanvasHost`, and the large `CanvasSurface` integration component. There
  is currently no file-system IPC or open/save wiring.
- `packages/document` is the live immutable model: `SketchbookDocument` owns ordered
  pages; each `PageDocument` atomically owns layers and one canonical flattened
  `ObjectCollection`; layers own ordered object IDs. Live objects are Ink, line,
  rectangle, and ellipse.
- `packages/editor` owns the in-memory `InkDocumentSession`, active page/layer and
  per-page viewport state, tool/color systems, clipboard, commands, and the bridge
  from editor actions to history. A new session starts with an empty sketchbook on
  each renderer mount.
- `packages/ink` normalizes pointer input, preserves exact source samples, smooths
  derived points, snapshots brush settings, builds geometry, and renders live
  previews and committed ink.
- `packages/rendering` owns the camera/viewport, screen-to-page coordinate authority,
  demand-driven scheduling, canvas compositor, paper, objects, and overlays. Base redraws
  are coalesced, but still clear and repaint the full canvas/object list; dirty regions
  do not yet provide base-pass culling.
- `packages/selection` and `packages/manipulation` provide model-neutral hit testing,
  selection state, bounds, translation, rotation, and scaling. `packages/editor`
  adapts their results into immutable document commands.
- `packages/history` provides bounded undo/redo and atomic transactions. The editor
  coordinator adds bounded page-context metadata so undo/redo can activate the page
  affected by a command.
- `packages/domain` and `packages/persistence` implement an older Notebook/Section/Page
  model plus validated, atomic folder storage, autosave, dirty tracking, and recovery.
  They are not connected to the live `SketchbookDocument`; this is reusable
  infrastructure, not current artwork durability.
- `packages/ui` contains small shared UI utilities. `packages/search`,
  `packages/shared`, and `packages/testing` are presently empty package shells.

## Capability status

| Area | Current status | Important boundary |
| --- | --- | --- |
| Canvas and navigation | Implemented | One camera/converter, pan and anchored zoom, fit page/width, DPR-aware backing store, and a page-recoverability guard. |
| Canvas input | Implemented, hardware-unverified | Mouse, pen, and primary touch use Pointer Events and capture. Coalesced motion, terminal pen-up samples, pressure, tilt, twist, and cancellation are retained; tilt/twist do not affect rendering. |
| Brushes and properties | Partial | Ten concrete presets and two material rendering strategies support color/width/opacity/smoothing. The 45-item library mostly maps to nine shared fallbacks; distinct wet/textured media and direct on-canvas property adjustment are deferred. |
| Color | Implemented in session | Tool/selection owns current color; recents, favorites, palettes, preview/commit/cancel, and canvas eyedropper exist. Preferences are not durable and user palette management is not exposed. |
| Selection and transforms | Implemented | Multi-select, marquee, overlap cycling, move, uniform scale, rotate, line endpoints/midpoint, keyboard movement, clipboard operations, and context menu are present. Non-uniform stretching is absent. |
| Eraser | Partial by design | Gesture deletion is transactional and cancel-safe, but it deletes whole Ink objects only; it does not split strokes or erase vector shapes. |
| Shapes and paper guides | Implemented | Line, rectangle, ellipse, Shift constraints, measurements, selected-shape styling, and blank/grid/ruled/dotted/isometric paper are live. Rulers and alignment guides are absent. |
| Layers | Implemented for supported model | Stack and list share one action model: add, activate, rename, show/hide, lock, opacity, reorder, and delete. Continuous opacity is one history entry and reorder commits once on drop. Grouping, merge, clipping, masks, and effects are out of scope. |
| Pages | Functionally implemented; UI polish remains | Add, duplicate, delete, reorder, rename, switch, thumbnails, size/orientation, paper settings, isolated viewports/layers, and page-aware history exist. The roadmap still calls for navigation/settings polish. |
| Undo/redo | Implemented | Commands and transactions preserve immutable successors and logical-operation granularity. Session-only focus/viewport changes intentionally do not enter history. |
| Persistence and recovery | Package exists; live integration absent | The desktop runtime cannot open, save, autosave, or recover the live sketchbook. Legacy persistence cannot be treated as live support without an explicit migration/adapter decision. |
| Document management and export | Absent | Current top bar has no New/Open/Save, gallery, format, import, or export workflow. Unmounted shell placeholders are not features. |
| Reference/image workflow | Absent in live editor | Legacy image/asset types do not make image import or reference boards available to the live document. |
| Accessibility and shortcuts | Partial | Many controls have ARIA labels, focus states, roving keyboard behavior, shortcuts, and reduced-motion handling. Tablet-only discoverability, touch gestures, and the complete keyboard/screen-reader pass remain unverified. |
| Learning and AI | Planned only | No live lesson or AI workflow exists; generated output must remain transient until accepted through a normal command. |

## Binding constraints

Follow `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`,
`docs/ROADMAP.md`, `docs/design/folio-design-system.md`, and, for drawing work,
`docs/design/drawing-tool-system.md`. In particular: never add page/layer ownership to
`PageObject`; never create a second object order, viewport, compositor, current-color,
or live-document authority; preserve exact Ink samples and committed brush snapshots;
mutate documents only through immutable commands and History; keep one logical
operation to one History entry; keep active page/layer, selection, viewport, tool
preferences, and transient UI as session state; cancellation must not half-commit;
and closing UI must stop intercepting pointers immediately. Do not revive the legacy
Notebook as a competing live model.

## Release blockers and uncertainties

The critical artwork-safety blocker is durable storage for the actual live model,
including layers, exact Ink source samples, vector objects, page settings, and a
versioned file contract. Open/save/autosave/recovery and failure-path UX must be wired
and tested end to end before Folio can credibly protect professional work. Export,
document/gallery management, and reference/image import are also absent user-facing
workflows. Base rendering and hit testing are linear/full-pass and may become a
performance limit on large documents, although scheduling and geometry caches reduce
unnecessary work.

There is minor maintenance drift: some inactive shell placeholders and tests still
use phase-era names, an unused status bar contains fictional saved/page-count copy,
and `packages/domain/README.md` links to an old roadmap heading. These are not live
behavior, but they can mislead future audits unless treated as placeholders.

Brush identity fidelity, real-media feel, and physical input quality remain product
unknowns rather than proven failures. Electron E2E coverage is extensive, but this
review did not launch the app or run Playwright. The approved visual freeze still
requires human review across light/dark themes and the minimum window size. Physical
stylus/trackpad testing is still required for pressure, terminal samples, capture
loss, hover, palm rejection, high DPI, latency, and long-stroke behavior.

Tablet reuse is plausible at the core but not turnkey. The immutable document,
history, selection/manipulation math, and much of the Ink pipeline are portable
TypeScript. The current UI assumes desktop-sized React/Electron surfaces and often
expects hover, keyboard, or right-click affordances; only primary pointers are used,
and there is no multi-touch gesture model. Electron lifecycle, Node file storage,
dialogs, packaging, and minimum-window assumptions need adapters. A versioned live
document format and device-backed storage abstraction should precede any tablet port.

## Recommended next tasks

1. Finish the roadmap's remaining UI-v1 consistency and accessibility pass, then get
   explicit visual approval without changing the protected editor architecture.
2. Define the versioned serialization contract for `SketchbookDocument` and its Ink
   samples/brush snapshots, plus migration and corruption behavior, before wiring UI.
3. Adapt the proven atomic-save/recovery primitives to the live model and add
   Open/Save/Autosave/Recovery with end-to-end crash/failure tests.
4. Establish representative large-document performance fixtures and measure full
   redraw and linear hit-testing before choosing culling or indexing work.
5. Run a physical Windows tablet/stylus test matrix and convert findings into bounded
   fixes; use those results to define touch/tablet portability requirements.

## Verification at this snapshot

`pnpm typecheck` passed for all participating packages, the desktop Electron and
renderer projects, and the E2E TypeScript project. A focused Vitest run passed 184
tests in seven files covering pointer finalization/cancellation, page history,
renderer behavior, persistence save/load and recovery, floating dismissal, and layer
stack behavior. No build, packaging, Playwright, performance benchmark, visual QA, or
physical-device test was run. Re-run checks against the current commit rather than
treating this dated result as permanent.
