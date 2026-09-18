import type { Layer, Page } from "@folio/document";
import {
  InkObject,
  isVectorObject,
  type EllipseGeometry,
  type LineGeometry,
  type ObjectBounds,
  type PageObject,
  type RectangleGeometry,
  type VectorGeometry,
  type VectorObjectType,
  type VectorPageObject,
} from "@folio/document";
import {
  MaterialPriority,
  createStrokeVisual,
  materialTileRect,
  type MaterialPriorityValue,
  type MaterialTileRequest,
  type PencilMaterialRuntime,
  type Stroke,
  type StrokeVisual,
} from "@folio/ink";
import type { OverlayRenderHook, TransformPreviewVisual } from "@folio/rendering";
import type { VectorShapeDraft } from "./VectorShapeCreation";

const MAX_STROKE_VISUAL_SCALE_CACHE_ENTRIES = 8;

interface VectorRenderable {
  readonly type: VectorObjectType;
  readonly geometry: VectorGeometry;
  readonly style: VectorPageObject["style"];
  readonly localBounds: ObjectBounds;
}

export interface VectorShapeVisual extends TransformPreviewVisual {
  readonly bounds: ObjectBounds;
}

/** Creates a lightweight immutable visual for creation and manipulation overlays. */
export function createVectorShapeVisual(
  shape: VectorRenderable,
  renderedScale = 1,
): VectorShapeVisual {
  if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
    throw new RangeError("Vector preview scale must be positive and finite.");
  }
  return Object.freeze({
    bounds: shape.localBounds,
    draw: (context: CanvasRenderingContext2D) => drawVectorGeometry(context, shape, renderedScale),
  });
}

/** Uses the base renderer's ordered hook seam for finalized immutable vector objects. */
export function createVectorObjectRenderHook(
  getObjects: () => readonly unknown[],
): OverlayRenderHook {
  return (context, input) => {
    const objects = getObjects().filter(isVectorObject);
    if (objects.length === 0) return;
    context.save();
    context.beginPath();
    context.rect(
      input.page.rect.x,
      input.page.rect.y,
      input.page.rect.width,
      input.page.rect.height,
    );
    context.clip();
    context.translate(input.page.rect.x, input.page.rect.y);
    for (const object of objects) drawVectorObject(context, object);
    context.restore();
  };
}

/** Layer-derived presentation applied around one object's normal drawing. */
export interface ObjectPresentationResolver {
  readonly renderable: (object: PageObject) => boolean;
  readonly layerOpacity: (object: PageObject) => number;
}

/** Renders every finalized PageObject through one document-ordered compositor. */
export function createPageObjectRenderHook(
  getObjects: () => readonly PageObject[],
  onRenderOrder?: (objectIds: readonly string[]) => void,
  presentation?: ObjectPresentationResolver,
  materialRuntime?: PencilMaterialRuntime | null,
): OverlayRenderHook {
  const strokeVisuals = new WeakMap<Stroke, Map<number, StrokeVisual>>();
  return (context, input) => {
    const objects = getObjects();
    if (objects.length === 0) return;
    // Material a compositor could not paint is collected across the whole frame
    // and asked for once, because the request describes "what is on screen now"
    // and two answers to that cannot both be true.
    const wanted: MaterialTileRequest[] = [];
    const focus = materialRuntime == null ? null : viewportFocus(input);
    context.save();
    context.beginPath();
    context.rect(
      input.page.rect.x,
      input.page.rect.y,
      input.page.rect.width,
      input.page.rect.height,
    );
    context.clip();
    context.translate(input.page.rect.x, input.page.rect.y);
    const renderedObjectIds: string[] = [];
    for (const object of objects) {
      const visible = presentation?.renderable(object) ?? object.visible;
      if (!visible) continue;
      // Every object draw path multiplies into globalAlpha, so seeding it with
      // the Layer opacity yields `layer opacity x object opacity` without any
      // isolated group compositing or offscreen canvas.
      const layerOpacity = presentation?.layerOpacity(object) ?? 1;
      const composited = layerOpacity !== 1;
      if (composited) {
        context.save();
        context.globalAlpha *= layerOpacity;
      }
      if (object instanceof InkObject) {
        const visual = resolveStrokeVisual(strokeVisuals, object, materialRuntime ?? null);
        drawInkObject(context, object, visual);
        collectMaterialRequest(wanted, object, visual, focus, materialRuntime ?? null);
        renderedObjectIds.push(object.id);
      } else if (isVectorObject(object)) {
        drawVectorObject(context, object);
        renderedObjectIds.push(object.id);
      }
      if (composited) context.restore();
    }
    onRenderOrder?.(Object.freeze(renderedObjectIds));
    context.restore();
    materialRuntime?.requestVisible(wanted);
  };
}

/**
 * The page rectangle the camera is actually looking at, and its middle.
 *
 * Used only to rank reconstruction: material in the middle of what the artist
 * is looking at is finished before material at the edge, which is what makes a
 * viewport fill in from where the eye already is.
 */
function viewportFocus(
  input: unknown,
): Readonly<{ x: number; y: number; halfWidth: number; halfHeight: number }> | null {
  const view = (
    input as {
      viewport?: {
        size?: { width: number; height: number };
        camera?: { position?: { x: number; y: number }; zoom?: number };
      };
    }
  ).viewport;
  const page = (input as { page?: { rect?: { x: number; y: number } } }).page;
  const camera = view?.camera;
  if (view?.size === undefined || camera?.position === undefined) return null;
  const zoom = Math.max(camera.zoom ?? 1, 0.0001);
  return Object.freeze({
    x: camera.position.x - (page?.rect?.x ?? 0),
    y: camera.position.y - (page?.rect?.y ?? 0),
    halfWidth: view.size.width / (2 * zoom),
    halfHeight: view.size.height / (2 * zoom),
  });
}

function collectMaterialRequest(
  into: MaterialTileRequest[],
  object: InkObject,
  visual: StrokeVisual,
  focus: Readonly<{ x: number; y: number; halfWidth: number; halfHeight: number }> | null,
  runtime: PencilMaterialRuntime | null,
): void {
  if (runtime === null) return;
  const missing = visual.missingMaterial;
  if (missing.length === 0) return;
  let priority: MaterialPriorityValue = MaterialPriority.VisiblePeripheral;
  if (focus !== null) {
    for (const key of missing) {
      const rect = materialTileRect(key);
      // Tiles in the middle half of the view are what the eye is on, so they
      // are reconstructed before the ones at the edge of it.
      const centerX = object.transform.translation.x + rect.x + rect.width / 2;
      const centerY = object.transform.translation.y + rect.y + rect.height / 2;
      if (
        Math.abs(centerX - focus.x) < focus.halfWidth / 2 &&
        Math.abs(centerY - focus.y) < focus.halfHeight / 2
      ) {
        priority = MaterialPriority.VisibleCenter;
        break;
      }
    }
  }
  into.push(
    runtime.createRequest(
      object.stroke.id,
      object.stroke.points,
      object.stroke.brush,
      missing,
      priority,
    ),
  );
}

function resolveStrokeVisual(
  visuals: WeakMap<Stroke, Map<number, StrokeVisual>>,
  object: InkObject,
  materialRuntime: PencilMaterialRuntime | null = null,
): StrokeVisual {
  let byScale = visuals.get(object.stroke);
  if (byScale === undefined) {
    byScale = new Map<number, StrokeVisual>();
    visuals.set(object.stroke, byScale);
  }
  let visual = byScale.get(object.transform.scale);
  if (visual === undefined) {
    visual = createStrokeVisual(object.stroke, object.transform.scale, materialRuntime);
    if (byScale.size >= MAX_STROKE_VISUAL_SCALE_CACHE_ENTRIES) {
      const oldestScale = byScale.keys().next().value as number | undefined;
      if (oldestScale !== undefined) byScale.delete(oldestScale);
    }
    byScale.set(object.transform.scale, visual);
  }
  return visual;
}

function drawInkObject(
  context: CanvasRenderingContext2D,
  object: InkObject,
  visual: StrokeVisual,
): void {
  const { transform } = object;
  const pivotX = object.stroke.bounds.center.x;
  const pivotY = object.stroke.bounds.center.y;
  context.save();
  context.translate(transform.translation.x, transform.translation.y);
  if (transform.rotation !== 0 || transform.scale !== 1) {
    context.translate(pivotX, pivotY);
    if (transform.rotation !== 0) context.rotate(transform.rotation);
    if (transform.scale !== 1) context.scale(transform.scale, transform.scale);
    context.translate(-pivotX, -pivotY);
  }
  visual.draw(context);
  context.restore();
}

function drawVectorObject(context: CanvasRenderingContext2D, object: VectorPageObject): void {
  const { transform, localBounds } = object;
  const pivotX = localBounds.x + localBounds.width / 2;
  const pivotY = localBounds.y + localBounds.height / 2;
  context.save();
  context.translate(transform.translation.x, transform.translation.y);
  if (transform.rotation !== 0 || transform.scale !== 1) {
    context.translate(pivotX, pivotY);
    if (transform.rotation !== 0) context.rotate(transform.rotation);
    if (transform.scale !== 1) context.scale(transform.scale, transform.scale);
    context.translate(-pivotX, -pivotY);
  }
  drawVectorGeometry(context, object, transform.scale);
  context.restore();
}

function drawVectorGeometry(
  context: CanvasRenderingContext2D,
  shape: VectorRenderable | VectorShapeDraft,
  renderedScale: number,
): void {
  context.save();
  context.lineWidth = shape.style.strokeWidth / renderedScale;
  context.strokeStyle = shape.style.strokeColor.hex;
  context.lineCap = "round";
  context.lineJoin = "round";
  // A vector has two alphas, and they are separate durable values: the style
  // carries no object-level opacity, only a stroke colour and a fill colour
  // that each hold their own. Both are therefore applied to the inherited
  // alpha -- the Layer's, which is the object-level one -- rather than to each
  // other. Multiplying the fill by the outline's alpha made a solid fill
  // inside a faint outline impossible to draw, though the model can say it.
  const inheritedAlpha = context.globalAlpha;
  context.beginPath();
  appendVectorGeometryPath(context, shape.type, shape.geometry);
  if (shape.style.fillColor !== undefined) {
    context.save();
    context.fillStyle = shape.style.fillColor.hex;
    context.globalAlpha = inheritedAlpha * shape.style.fillColor.opacity;
    context.fill();
    context.restore();
  }
  context.globalAlpha = inheritedAlpha * shape.style.strokeColor.opacity;
  context.stroke();
  context.restore();
}

/** Editor-internal path builder shared by finalized, preview, hover, and selection visuals. */
export function appendVectorGeometryPath(
  context: CanvasRenderingContext2D,
  type: VectorObjectType,
  geometry: VectorGeometry,
): void {
  switch (type) {
    case "line": {
      const line = geometry as LineGeometry;
      context.moveTo(line.start.x, line.start.y);
      context.lineTo(line.end.x, line.end.y);
      return;
    }
    case "rectangle": {
      const rectangle = geometry as RectangleGeometry;
      context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
      return;
    }
    case "ellipse": {
      const ellipse = geometry as EllipseGeometry;
      context.ellipse(
        ellipse.center.x,
        ellipse.center.y,
        ellipse.radiusX,
        ellipse.radiusY,
        0,
        0,
        Math.PI * 2,
      );
    }
  }
}

/** The centred transform that fits one whole page into a preview box. */
interface PageFit {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Resolves the page-fitting transform shared by every page-scale preview.
 *
 * The frame is the *whole page*, never a layer's content bounds, so previews of
 * different layers of the same page are pixel-aligned with each other and with
 * the full-page thumbnail.
 */
function resolvePageFit(page: Page, size: Readonly<{ width: number; height: number }>): PageFit {
  const scale = Math.min(size.width / page.geometry.width, size.height / page.geometry.height);
  const width = page.geometry.width * scale;
  const height = page.geometry.height * scale;
  return Object.freeze({
    scale,
    width,
    height,
    offsetX: (size.width - width) / 2,
    offsetY: (size.height - height) / 2,
  });
}

/** Clips to the fitted page and installs page coordinates. The caller restores. */
function clipToFittedPage(context: CanvasRenderingContext2D, fit: PageFit): void {
  context.beginPath();
  context.rect(fit.offsetX, fit.offsetY, fit.width, fit.height);
  context.clip();
  context.translate(fit.offsetX, fit.offsetY);
  context.scale(fit.scale, fit.scale);
}

/** Draws the page's ruled, dotted, or isometric paper. Page state, never Layer state. */
function drawPaperPattern(
  context: CanvasRenderingContext2D,
  page: Page,
  fit: PageFit,
  theme: Readonly<{ pageLineColor: string }>,
): void {
  const spacing = page.paper.spacing;
  if (page.paper.type === "blank" || spacing === undefined || spacing * fit.scale < 2) return;
  context.save();
  context.strokeStyle = theme.pageLineColor;
  context.fillStyle = theme.pageLineColor;
  context.lineWidth = 1 / fit.scale;
  context.beginPath();
  if (page.paper.type === "dotted") {
    const radius = Math.min(1.1 / fit.scale, spacing / 6);
    for (let y = spacing; y < page.geometry.height; y += spacing) {
      for (let x = spacing; x < page.geometry.width; x += spacing) {
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, Math.PI * 2);
      }
    }
    context.fill();
  } else {
    for (let y = spacing; y < page.geometry.height; y += spacing) {
      context.moveTo(0, y);
      context.lineTo(page.geometry.width, y);
    }
    if (page.paper.type !== "ruled") {
      for (let x = spacing; x < page.geometry.width; x += spacing) {
        context.moveTo(x, 0);
        context.lineTo(x, page.geometry.height);
      }
    }
    context.stroke();
  }
  context.restore();
}

/**
 * Draws one Layer's artwork in canonical order, in page coordinates.
 *
 * The single definition of how a Layer becomes marks. Both the whole-page
 * thumbnail and the single-layer preview go through here, so layer visibility,
 * layer opacity, object visibility, object dispatch and ordering cannot drift
 * between them.
 *
 * Layer opacity multiplies into `globalAlpha`, exactly as the live compositor
 * does. That is Folio's real semantic today -- per-object alpha, not an
 * isolated group composite -- and a preview must show what the canvas shows.
 */
function drawLayerArtwork(context: CanvasRenderingContext2D, page: Page, layer: Layer): void {
  if (!layer.visible) return;
  context.save();
  context.globalAlpha *= layer.opacity;
  // `objectIds` is the Layer's ordered membership, which PageDocument's
  // constructor guarantees is exactly this layer's slice of canonical order.
  for (const objectId of layer.objectIds) {
    const object = page.content.lookup(objectId);
    if (object === undefined || !object.visible) continue;
    if (object instanceof InkObject) {
      drawInkObject(context, object, createStrokeVisual(object.stroke, object.transform.scale));
    } else if (isVectorObject(object)) {
      drawVectorObject(context, object);
    }
  }
  context.restore();
}

/**
 * Paints the page's own surface: paper colour, then paper pattern.
 *
 * The single definition of how Page paper becomes pixels. It leaves the context
 * clipped and in page coordinates, so a caller that also wants artwork can go
 * straight on to drawing layers. The caller owns the surrounding save/restore.
 */
function drawPaperSurface(
  context: CanvasRenderingContext2D,
  page: Page,
  fit: PageFit,
  theme: Readonly<{ pageLineColor: string }>,
): void {
  // Filled before the clip is installed, which is the order the thumbnail has
  // always used; keeping it means the page edge rasterises identically.
  context.fillStyle = page.paper.color;
  context.fillRect(fit.offsetX, fit.offsetY, fit.width, fit.height);
  clipToFittedPage(context, fit);
  drawPaperPattern(context, page, fit, theme);
}

/**
 * Draws one complete page into a thumbnail context.
 *
 * This deliberately reuses the same per-object draw helpers the live compositor
 * uses, so thumbnails cannot drift from the canvas. It is a pure function of the
 * page: no controller, no viewport, and no second rendering engine.
 */
export function renderPageThumbnail(
  context: CanvasRenderingContext2D,
  page: Page,
  size: Readonly<{ width: number; height: number }>,
  theme: Readonly<{ pageLineColor: string }>,
): void {
  const fit = resolvePageFit(page, size);
  context.clearRect(0, 0, size.width, size.height);
  context.save();
  drawPaperSurface(context, page, fit, theme);
  for (const layer of page.content.layers) drawLayerArtwork(context, page, layer);
  context.restore();
}

/**
 * Draws only the page's paper: colour and pattern, and no artwork at all.
 *
 * The structural counterpart to {@link renderPageLayerPreview}. Paper is Page
 * state rather than Layer state, so the spatial stack shows it as its own base
 * sheet beneath every transparent layer plane -- it is not, and must never
 * become, a Layer.
 *
 * Shares `resolvePageFit`, `clipToFittedPage` and the paper drawing with the
 * whole-page thumbnail, so the base sheet and the layer planes above it land on
 * exactly the same fitted page frame.
 */
export function renderPagePaperPreview(
  context: CanvasRenderingContext2D,
  page: Page,
  size: Readonly<{ width: number; height: number }>,
  theme: Readonly<{ pageLineColor: string }>,
): void {
  const fit = resolvePageFit(page, size);
  context.clearRect(0, 0, size.width, size.height);
  context.save();
  drawPaperSurface(context, page, fit, theme);
  context.restore();
}

/**
 * Draws exactly one Layer's artwork onto a transparent surface.
 *
 * Paper is Page state, not Layer state, so this paints no paper colour, no
 * paper pattern and no background fill: the surface keeps real alpha wherever
 * the layer has no marks. That is what lets several of these be stacked over a
 * single paper base and reproduce the page, instead of each upper layer's
 * opaque paper hiding everything beneath it.
 *
 * The coordinate frame is the whole page rather than the layer's content
 * bounds, so previews of different layers line up exactly.
 *
 * Pure: it reads the page and draws. No History, no document mutation, no
 * session state, and no dependence on which Layer happens to be active -- the
 * caller names the Layer, because a stack renders many of them at once.
 *
 * @throws LayerMembershipError when the page owns no Layer with this id. An
 * unknown id is never treated as "every layer".
 */
export function renderPageLayerPreview(
  context: CanvasRenderingContext2D,
  page: Page,
  layerId: string,
  size: Readonly<{ width: number; height: number }>,
): void {
  const layer = page.content.requireLayer(layerId);
  const fit = resolvePageFit(page, size);
  context.clearRect(0, 0, size.width, size.height);
  context.save();
  clipToFittedPage(context, fit);
  drawLayerArtwork(context, page, layer);
  context.restore();
}
