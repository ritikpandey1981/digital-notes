# Phase 17C — Professional Brush UX

## Scope and architecture decision

Phase 17C completes the product-facing Pencil, Pen, Marker, and Highlighter experience on the accepted Phase 17A/17B model and renderer. It does not introduce another brush store, renderer, sidebar, pointer pipeline, or History path.

`DEFAULT_BRUSH_PRESETS` remains the single immutable catalog. `BrushToolStateStore` owns one independent `ActiveToolState` for each family. A new stroke still freezes one `ResolvedBrushSnapshot` at pointer-down, so later catalog or settings changes cannot reinterpret historical ink.

The desktop layer maps the four dock tools to their brush family and projects the existing store into the descriptor-driven options widget. Native color drag events retain the existing once-per-animation-frame latest-value coalescing.

## Catalog and defaults

Default selection is explicit rather than dependent on catalog order:

| Family | Preset | ID | Color | Size | Opacity | Smoothing | Renderer capability | Pressure size |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Pencil | HB | `pencil-hb` | `#343434` | 2 px | 78% | 20% | outline | 0.65×–1.25× |
| Pencil | 2B | `pencil-2b` | `#343434` | 3 px | 86% | 18% | outline | 0.55×–1.35× |
| Pencil | 4B | `pencil-4b` | `#343434` | 5 px | 90% | 16% | outline | 0.45×–1.50× |
| Pencil | Mechanical Pencil | `pencil-mechanical` | `#343434` | 1.2 px | 85% | 12% | centerline | disabled |
| Pen | Fineliner | `pen-fineliner` | `#111111` | 2 px | 100% | 20% | centerline | disabled |
| Pen | Technical Pen | `pen-technical` | `#111111` | 1.5 px | 100% | 30% | centerline | disabled |
| Pen | Brush Pen | `pen-brush` | `#111111` | 6 px | 100% | 18% | outline | 0.35×–1.65× |
| Marker | Felt Marker | `marker-felt` | `#1f2937` | 8 px | 90% | 22% | centerline | disabled |
| Marker | Broad Marker | `marker-broad` | `#1f2937` | 16 px | 82% | 25% | centerline | disabled |
| Highlighter | Default Highlighter | `highlighter-default` | `#facc15` | 12 px | 34% | none | centerline | disabled |

The default IDs are HB, Fineliner, Felt Marker, and Default Highlighter. Switching presets retains the current family color and resets size, opacity, and smoothing to the selected definition. Switching tools retains every family’s complete independent state. Settings changes do not create document History entries.

## Tool Dock and settings lifecycle

The dock order is Select, separator, Pencil, Pen, Marker, Highlighter, Eraser, separator, Shapes. The Draw menu mirrors the four brush families.

An inactive brush click activates it without opening settings. Clicking the active brush toggles its existing floating options widget. Outside click, Escape, or switching tools dismisses it. Shapes retains its accepted special activation behavior.

The compact brush panel uses existing property descriptors and controls:

- preset dropdown when a family has more than one preset;
- frame-coalesced native color input and shared color system;
- Size and Opacity continuous sliders;
- Smoothing for Pencil, Pen, and Marker;
- no redundant preset dropdown or Smoothing control for Highlighter.

The preset dropdown is a native semantic select, so keyboard traversal, selection, focus, and screen-reader naming follow the platform control contract. Existing sliders retain Arrow, Shift+Arrow, wheel, numeric entry, and focus-ring behavior.

## Smoothing semantics

Smoothing is a real geometry-stage control. The immutable `Stroke.sourceSamples` and `ProfessionalInkPath.sourcePoints` remain the raw pointer samples, including pressure, tilt, twist, time, velocity, and process metadata.

For a nonzero smoothing amount, the professional path derives coordinate-only geometry samples using a deterministic symmetric triangular moving average. Amount controls both blend strength and a bounded one-to-four-sample radius. Endpoints are fixed. A turn-angle retention factor suppresses smoothing at handwriting corners, and every derived coordinate remains a convex weighted average plus bounded interpolation, preventing overshoot.

Adaptive filtering, corner detection, and cubic fitting consume the derived geometry. Source progression and pressure association remain indexed against the raw source timeline. Live and committed rendering both call the same `createBrushRenderGeometry` function. Smoothed centerline brushes use the accepted scheduled region redraw; unsmoothed centerline brushes retain the Phase 17B incremental path. Amount 0 bypasses derivation and produces the accepted Phase 17B points, segments, progression, and endpoint refs.

## Renderer resolution and device behavior

Preset renderer identity is a capability; the renderer frozen into each stroke remains authoritative:

- expressive Pencil and Brush Pen presets resolve to centerline for mouse/trackpad because mouse pressure is the accepted synthetic constant 0.5;
- expressive Pencil and Brush Pen presets retain outline for pen/stylus and touch input;
- Mechanical Pencil, Fineliner, Technical Pen, Marker, and Highlighter use centerline;
- Highlighter remains fixed-width, pressure-disabled, `source-over`, and model-opacity-capped;
- historical brush snapshots are never resolved again against the current catalog.

No pressure formula, outline builder, bounds policy, selection path, Eraser path, manipulation path, or persistence model changed.

## Brush cursor

Pencil, Pen, Marker, and Highlighter use one imperative DOM ring owned by `CanvasHost`. Native pointer listeners update its transform and visibility directly; React state is not updated on pointer move.

The CSS diameter is `max(7 px, nominal brush size × viewport zoom)`. Device-pixel ratio is deliberately ignored because the overlay is CSS-space UI. The ring uses a white inner edge and dark outer edge for contrast. It is limited to the visible page region and is hidden for touch input, non-brush tools, viewport pan, pointer cancel, page exit, and canvas leave. It stays visible during an active mouse/stylus draw while the pointer remains over the page. Size and zoom updates recenter the existing pointer position without waiting for another React pointer event.

Eraser, Shapes, selection, manipulation, and native editing cursors keep their accepted policies.

## Verification coverage

Unit coverage includes the exact ten-preset catalog, explicit defaults, immutable catalog/state separation, four-family state independence, color-retaining preset switches, per-preset renderer and pressure capabilities, JSON-safe historical snapshots, no-op updates, cross-family rejection, descriptor contents/omissions, widget lifecycle, cursor sizing/page hit rules, mouse/stylus renderer resolution, zero-smoothing baseline parity, low/high distinction, source immutability, determinism, endpoint/corner safety, and live/final geometry parity.

The Phase 17C Electron scenario covers exact dock order, inactive/active brush click behavior, preset selection, family diagnostics, Highlighter omissions, four persisted family strokes, smoothing changes, 7 px minimum cursor at 100%, 40 px cursor at 200%, page-exit hiding, touch suppression, console cleanliness, and all required screenshots.

## Visual QA artifacts

- [Pencil active](screenshots/phase-17c/01-pencil-active.png)
- [Pencil settings](screenshots/phase-17c/02-pencil-settings.png)
- [Brush Pen settings](screenshots/phase-17c/03-brush-pen-settings.png)
- [Marker settings](screenshots/phase-17c/04-marker-settings.png)
- [Highlighter settings](screenshots/phase-17c/05-highlighter-settings.png)
- [All four brush families](screenshots/phase-17c/06-all-families-strokes.png)
- [Small cursor at 100%](screenshots/phase-17c/07-small-cursor-100.png)
- [Large cursor at 200%](screenshots/phase-17c/08-large-cursor-200.png)

## Phase boundary

Phase 17C does not add texture, grain, tilt/twist rendering, angled nibs, stamps, scatter, pressure-opacity dynamics, partial erasing, brush management, WebGL, persistence schema changes, or device-specific calibration. Physical stylus validation remains Phase 17D work; Phase 17D has not begun.
