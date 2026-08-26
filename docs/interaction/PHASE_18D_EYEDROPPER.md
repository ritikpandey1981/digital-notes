# Phase 18D — Eyedropper

## Scope and ownership

Phase 18D completes the Color & Palette System with a click-only, one-shot artwork Eyedropper inside the existing Full Color Picker. `EditorWorkspace` owns its temporary picker-session state. `CanvasSurface` owns the sampling implementation because it already owns the authoritative base canvas and page geometry.

Eyedropper is not a `ToolRegistry` tool, Tool Dock item, PageObject property, History command, workspace preference, or persistent setting. It does not change the active Pencil, Pen, Marker, Highlighter, or Shape tool. The Quick Color Rail remains Current, active-palette colors, and More Colors only.

## One-shot lifecycle

The lifecycle is:

1. open the existing Full Color Picker for a creation target or selected vector;
2. activate **Pick color from canvas**;
3. click a point inside the rendered paper;
4. sample one committed composited backing pixel;
5. synchronize the picker and preview through the active `ColorTargetAdapter`;
6. leave Eyedropper mode automatically;
7. keep the picker session open for commit, cancellation, or another sample.

An outside-paper miss and a readback failure do not leave the mode. A successful sample restores normal page pointer routing immediately after the owned pointer finishes, so the next normal drawing or selection gesture behaves normally.

## Sampling source and composited meaning

The only source is the `CanvasController`-owned base canvas:

`canvas[data-folio-layer="page"]`

The base renderer paints the opaque workspace, warm paper, page rules, and then the `createPageObjectRenderHook` output for every committed Ink, Line, Rectangle, and Ellipse in canonical document order. The sampled RGB is therefore the visible final artwork pixel, not PageObject metadata.

This deliberately means:

- opaque Ink interiors return their rendered RGB;
- vector interiors/edges return the rasterized stroke pixel;
- a Highlighter over paper or artwork returns the visible composited RGB rather than the Highlighter source Hex;
- overlaps return the final document-order composition;
- anti-aliased edges may return a blended edge pixel;
- blank paper returns the actual warm paper color (`#fffdf8` in the current themes).

The compositor currently paints an opaque base. If an unexpected alpha-bearing pixel is encountered, the sampler resolves it over the compositor's actual opaque workspace backing rather than interpreting transparent black as artwork. Color targets remain six-digit RGB and gain no alpha property.

## Overlay exclusion

Transient presentation is intentionally excluded because it lives outside the base canvas:

- live Ink input and presentation;
- manipulation preview;
- Shape preview;
- vector interaction frames, hover, handles, and rotation affordance;
- generic selection overlay;
- imperative brush cursor;
- Tool Dock, Quick Color Rail, picker, toolbar, tooltip, and context-hint DOM.

The implementation neither screenshots the app nor composites UI layers. Selection and hover can change overlay canvases without changing the sampled base pixel. The Electron test verifies identical base RGB at the same vector coordinate immediately before and after selection.

## Coordinate conversion, DPR, and containment

`ArtworkColorSampler` resolves a client point in two related spaces:

1. client minus the canvas `DOMRect` offset becomes a local CSS coordinate;
2. CSS position maps to logical viewport position for half-open page containment;
3. CSS position maps independently to the backing store with `canvas.width / rect.width` and `canvas.height / rect.height`;
4. the resulting backing coordinate is floored and clamped to the valid final pixel.

The sampler does not assume the backing ratio equals `window.devicePixelRatio`. Pure tests cover ratios equivalent to 1, 1.5, and 2, an unrelated fractional backing ratio, DOM offsets, non-1 logical scale, half-open edges, outside points, and invalid zero-sized geometry.

Only the current `viewport.pageViewportRect` is sampleable. Gray workspace outside paper returns `miss / outside-page` before render flush or readback. It does not preview a target, update Recent, create History, dismiss the picker, or leave Eyedropper mode. Fit Page, 100%, resizing, and manually panned viewport states are covered in Electron.

## Render freshness and pixel policy

Sampling is click-only. Before the 1×1 `getImageData` read, `CanvasController.flushRender()` completes only already-scheduled renderer work. It returns without invalidation when no frame is pending. Sampling does not force a new render, export the canvas, call `toDataURL`, recreate a canvas, remount the editor, or read pixels on pointer move.

The result contract is discriminated:

- `success`: canonical lowercase `#rrggbb`, backing coordinate, and measured readback duration;
- `miss`: `outside-page` or `canvas-unavailable`;
- `error`: `security` or `read-failure`, with duration.

Canonical output uses the Phase 18A `rgbToHex` utility. Normal misses do not throw into UI.

## Picker control, shortcut, and focus

FullColorPicker exposes a restrained Lucide Pipette button with:

- accessible name **Pick color from canvas**;
- `aria-pressed` for inactive/active state;
- visible focus styling;
- title **Pick color from canvas (I)**.

`I` toggles Eyedropper only while FullColorPicker is mounted and the key is unmodified, non-repeating, and not owned by an input, textarea, select, or content-editable element. Hex and RGB entry therefore retain normal keyboard ownership. There is no global editor `I` shortcut.

After a successful sample or mode Escape, focus returns to the Pipette button. Closing/cancelling the picker restores its normal anchor focus behavior. The status text uses a polite live region.

## Picker synchronization and targets

A successful sample is fed into the existing picker preview path. Current, SV, Hue, Hex, RGB, Favorite-star derivation, and active-palette match presentation update together. Previous remains the color captured when the picker session began. Grayscale samples reuse the existing session-local meaningful-hue rule and do not leak hue between sessions.

Creation targets remain History-free:

- Pencil, Pen, and Marker update only their own active brush-family color;
- Highlighter updates RGB while preserving its separately owned opacity;
- Shapes updates only `ShapeToolState` creation color;
- cancellation restores Previous and commit retains the sample.

Selected Line, Rectangle, and Ellipse targets continue through `ContinuousVectorStyleEdit`. One or many sampled previews in one picker session produce at most one final History command. Cancellation restores the exact original object with zero commands. Shape creation defaults and every brush family remain isolated. Selected Ink remains unsupported.

## History, Recent, Favorites, and palettes

Eyedropper mode and sampling never create a History command.

Sampling alone does not add Recent. A creation sample enters Recent only after artwork is actually committed with that color. A selected-vector session adds only the final committed recolor once; intermediate samples and cancellation add nothing.

Sampling does not mutate Favorites, `activePaletteId`, palette definitions, or palette order. The Current star and palette match state are derived from the sampled canonical Hex. Explicit Favorite operations remain independent of picker cancellation.

## Input arbitration and floating dismissal

CanvasSurface's existing single capture-phase pointer boundary checks the temporary sampling lease before viewport, ToolRegistry, Ink, Shape, selection, or manipulation routing. While active, it consumes the pointer sequence, wheel navigation, and context-menu gesture. A sample click therefore cannot simultaneously draw, create a Shape, select another object, manipulate a selection, pan, or open the canvas context menu.

The existing floating scope/owner protocol represents the canvas host as picker-owned only while sampling is active. `useFloatingWidgetDismissal` accepts an optional caller-owned scope ID, a small generic extension that avoids picker-specific selectors or canvas exceptions. Page and workspace clicks remain inside that ownership lease; normal dismissal behavior resumes after one-shot success.

The cursor is an ordinary crosshair over the rendered page and the native default outside it. Cursor presentation observes pointer location at the CanvasHost ancestor capture boundary, before CanvasSurface consumes the target event. The brush cursor is hidden only during Eyedropper mode and normal tool presentation is restored afterward.

## Escape hierarchy and lifecycle cleanup

Escape is topmost-first:

1. an open palette dropdown closes itself;
2. the next Escape leaves Eyedropper and keeps the picker transaction alive;
3. the next Escape cancels the picker, restores Previous, and closes it.

One event cannot cascade through multiple levels. Tool/target invalidation, window blur, picker cancellation/commit, and component unmount destroy the temporary mode; it is never remembered across sessions.

## Failure and future-image security contract

`SecurityError` and unexpected read failures are contained. The target, History, Recent, Favorites, and palette state remain unchanged; the picker stays open and shows the restrained message **This color can't be sampled.** The mode remains retryable and escapable. A later success removes the stale failure state. Raw exception details are not displayed and browser canvas security is not weakened.

Images are not implemented in Phase 18. Future sampleable images must reach the compositor from application-owned local files, blobs, data URLs, or remote resources with valid sample-safe CORS configuration. A source that taints the canvas must remain unsampleable.

## Tests and performance evidence

Unit coverage includes sampler geometry, 1/1.5/2 and fractional backing ratios, exact solid/paper RGB, alpha fallback, outside-page no-read behavior, unavailable context, SecurityError, unexpected failure, and pending-render-only flush semantics. Existing ColorTargetAdapter, Recent, Favorite, hue-memory, and picker tests remain active.

The focused Electron scenario covers creation cancellation and commit, normal input recovery, Recent, selected-vector isolation and one-command History, exact Undo/Redo, overlay exclusion, composited Highlighter/Ink, paper in both themes, Fit Page, 100% plus pan, responsive placement, `I`, text-input ownership, three-level Escape, outside misses, cursor state, SecurityError and recovery, and zero console errors. It captures eight actual application frames and records representative click-readback durations.

## Phase completion

Phase 18D is the final implementation subphase of Phase 18. No Layers, persistence, selected-Ink editing, image support, user-palette CRUD, global Eyedropper tool, magnifier, or renderer redesign is included.
