# @folio/rendering

Model-neutral Canvas 2D presentation, viewport control, scheduling, coordinate
conversion, diagnostics, and editor overlays.

`CanvasController` owns the canvas lifecycle, camera/Viewport, Renderer,
RenderScheduler, overlay layers, device-pixel-ratio backing size, resize observation,
and context loss/recovery. Rendering is request-driven and animation-frame coalesced;
there is no continuous loop.

## Coordinates and viewport

`CoordinateConverter` is the single conversion path among screen, canvas, viewport,
world, and page spaces. Viewport operations include pan, zoom, Fit Page, and Fit Width.
At least 64 CSS pixels of the page remain recoverable after panning.

Device pixel ratio affects raster backing and transforms, not canonical page geometry
or logical brush width.

## Rendering and overlays

The base Renderer paints page presentation. The editor supplies the unified
mixed-object compositor through the controller boundary. Selection, translation, and
transform preview renderers are overlays and do not mutate document state.

An active transform overlay clears its full transparent canvas on each scheduled frame
to prevent compensated-width previews from smearing. Overlay sizes may remain stable in
screen space while targets stay in page coordinates.

## Rules

- Rendering consumes immutable snapshots; it does not own documents or History.
- New presentation invalidates the scheduler rather than creating a new render loop.
- Consumers use the coordinate converter rather than duplicating transform math.
- Page paper is rendered beneath artwork and remains page-anchored.

See [`../../docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#rendering-and-viewport).
