# Folio roadmap

This is a capability roadmap, not a phase log. It names gaps verified against the
current repository. Completed implementation detail belongs in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

## Implemented baseline

- Electron/React desktop editor with Canvas 2D page presentation.
- Immutable multi-page, multi-layer `SketchbookDocument` with Ink, Line, Rectangle,
  and Ellipse objects.
- Command-based undo/redo, transactions, clipboard workflows, logical multi-selection,
  marquee, overlap cycling, move/scale/rotate, and vector creation/editing.
- Five configurable drawing slots, radial brush library, property rail, Shapes,
  whole-Ink Eraser, Quick Color Rail, shared picker, Favorites/palettes, and Eyedropper.
- Request-driven rendering, page-scoped viewports, pointer/coalesced input, immutable
  brush snapshots, and exact retained source samples.
- One Layers experience: a Spatial Layers Stack over truthful per-Layer previews, and
  the Layers list for add, rename, visibility, lock, opacity, reorder, and delete.
- Desktop project persistence: a canonical `.folio` file, New/Open/Save/Save As with
  unsaved-change protection, a live project title and dirty marker, background crash
  snapshots, and startup recovery.

This baseline is not a claim that every named brush engine or physical-device
validation is complete, or that file workflows beyond a single open project — recent
files, rename, export, sync — exist.

## Now — finish Professional Sketchbook UI/UX v1

The editor is the product surface, and it is the thing a user judges first. The
remaining UI work is sequenced ahead of the core systems below so that persistence and
the brush engine are built against a frozen workspace rather than a moving one.

### Layers

The Layers experience is complete for the operations the model supports: activate, add,
rename, visibility, lock, opacity, delete, and reorder, reachable from both the Stack
and the List. Remaining Layers work is deliberately deferred rather than unfinished:

- Layer grouping, merge, and bulk operations stay in *Later* below; they need atomic
  `PageDocument`/History commands before any UI.
- Duplicate layer, flatten, blend modes, and masks do not exist in the model and are not
  scheduled.

### Remaining workspace surfaces

- Pages and Page Navigator presentation polish.
- Page Settings visual refinement.
- Top bar and document controls: done. The application menu carries real New, Open,
  Save, Save As and recovery actions, and the title island shows the project's own
  title and whether it has unsaved changes.
- Zoom and viewport navigation control consistency.
- Floating panel and dialog consistency across the surfaces that remain.
- Tooltip, focus, hover, and keyboard-affordance consistency, plus a discoverability
  surface for existing shortcuts.
- Light/dark parity and minimum-window/responsive QA across the whole workspace.

Shapes, selection and transform, and the color system are mature and shipped; they need
consistency review rather than feature work.

### Whole-workspace v1 consistency freeze

Exit condition: one deliberate pass over placement, density, typography, iconography,
states, motion, and light/dark behavior across every surface, followed by explicit user
approval. Automated green is not a freeze.

## After UI v1 — make the live sketchbook durable

### Connect persistence to the live document — done

Delivered for the desktop: a versioned `.folio` project format for `SketchbookDocument`
with pages, layers, vector objects, Ink source samples, paper and metadata; atomic
writes; transactional Open and New behind one unsaved-change guard; content-identity
dirty state with manual checkpoints; background crash snapshots kept separately from
the project file; startup recovery with Recover, Open Original and Discard; and the
application-menu file actions, accelerators, project title and dirty marker that expose
all of it. The older `@folio/domain` folder format was left isolated rather than
migrated.

Exit condition met: a live multi-page, multi-layer sketchbook with Ink and vectors can
be saved, closed, recovered when interrupted, reopened, and compared without semantic
loss.

Deliberately not built, and not planned as part of this: recent files, project rename,
export, printing, cloud sync, and any mobile document provider.

### Validate physical input and rendering budgets

- Perform operator QA with a physical stylus and trackpad; synthetic pen events are
  not a hardware claim.
- Measure sustained high-rate drawing, long pressure-aware outlines, large visible
  documents, mixed-DPI displays, cancellation, and context recovery on target Windows
  hardware.
- Profile before changing retained sample models, fitting, caching, or renderer
  architecture.

Exit condition: supported device behavior and performance limits are evidence-backed
and documented without weakening live/final stroke parity.

### Build the real brush engine

- Give catalogue identities genuinely distinct behavior or reduce/catalogue-group the
  identities that currently share the same underlying preset. The 45-entry catalogue is
  provisional and maps onto nine presets.
- Add rendering behavior only when it is supported end-to-end; watercolor, pastel,
  airbrush, and texture simulation are not currently implemented.
- Replace family-symbol slot glyphs with brush-accurate stroke previews.
- Extend physical-device QA when tilt/twist begin affecting rendering.

### Refine direct tool adjustment

- Evaluate direct manipulation for width, opacity, and smoothing on the Drawing
  Property Rail without duplicating Tool Options state.
- Decide which drawing preferences, palettes, and handedness/layout preferences should
  survive restart, then give them an application-settings boundary.
- Preserve target-adapter and one-command continuous-edit semantics for selected
  artwork.

### Complete exchange workflows

- Define supported import/export formats and security constraints before adding UI.
  Text, image, and PDF page objects do not exist.
- Treat operating-system clipboard exchange as a separate versioned format; the
  current editor clipboard is intentionally session-only.

## Later — broaden editing deliberately

- Evaluate non-uniform vector stretching and a generalized selection inspector.
- Decide vector/segment erasing separately from the current intentional whole-Ink
  eraser behavior.
- Add layer grouping, merge, and bulk operations only through atomic
  `PageDocument`/History commands.
- Revisit visible-object culling and active-outline rebuild cost when profiling proves
  the need.
- Decide whether alignment guides and a precision system are wanted; rotation angle
  snapping exists, guides do not.

## Future — learning and AI clients

- Build lesson, practice, and analysis systems on read-only editor/document/process
  context.
- Keep guidance and overlays transient.
- Convert a suggestion to artwork only after explicit user acceptance through a
  normal command and History.

## Maintenance queue

These are repository hygiene recommendations, not product features:

- Decide whether the empty `search`, `shared`, and `testing` package shells still earn
  workspace membership.
- Split oversized orchestration components only along existing authority boundaries.
- Consolidate the remaining wall-clock assertions in the unit suite behind the
  `FOLIO_PERFORMANCE_BASELINE` flag, so elapsed time is measured where the hardware
  and the load are controlled: `object-collection`, `advanced-selection`,
  `folio-spectrum`, `page-history` and `brush-performance-device-validation`.

Done: the unused shell component (`WorkspaceChrome`), the placeholder data, and the
unused `zustand` dependency were removed once the live file flows replaced them and
reference searches proved nothing reached them.

Maintenance work must be separately scoped; this roadmap does not authorize automatic
dependency or source deletion.
