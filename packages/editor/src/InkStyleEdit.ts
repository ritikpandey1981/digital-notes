import { InkObject, ObjectFactory, type PageObject } from "@folio/document";
import { createResolvedBrushSnapshot, Stroke } from "@folio/ink";

/** Editable appearance of one committed InkObject. */
export interface InkStylePatch {
  readonly color?: string;
  readonly width?: number;
  readonly opacity?: number;
}

/** Resolved appearance read back from a committed InkObject. */
export interface InkStyleValues {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
}

/**
 * Reads one committed stroke's appearance from its resolved brush snapshot.
 *
 * The snapshot is the render authority, so it is also the authority for what the
 * contextual toolbar shows.
 */
export function inkStyleValues(object: InkObject): InkStyleValues {
  return Object.freeze({
    color: object.stroke.brush.color,
    width: object.stroke.brush.size,
    opacity: object.stroke.brush.opacity,
  });
}

function sameValues(first: InkStyleValues, second: InkStyleValues): boolean {
  return (
    first.color === second.color && first.width === second.width && first.opacity === second.opacity
  );
}

/** True when a patch would change the committed appearance of this object. */
export function inkStyleChanges(object: InkObject, patch: InkStylePatch): boolean {
  const current = inkStyleValues(object);
  return !sameValues(current, resolveInkStyle(current, patch));
}

function resolveInkStyle(current: InkStyleValues, patch: InkStylePatch): InkStyleValues {
  return Object.freeze({
    color: patch.color ?? current.color,
    width: patch.width ?? current.width,
    opacity: patch.opacity ?? current.opacity,
  });
}

/**
 * Produces a same-identity InkObject whose committed appearance is replaced.
 *
 * Process data is preserved by reference: `points`, `sourceSamples`, `metrics`,
 * and `statistics` are carried over untouched, so recoloring never disturbs the
 * stroke's captured drawing process. Active tool state and BrushPresets are not
 * involved at any point.
 */
export function applyInkStyle(
  object: InkObject,
  patch: InkStylePatch,
  factory: ObjectFactory,
  modifiedAt: string,
): InkObject {
  const next = resolveInkStyle(inkStyleValues(object), patch);
  if (!Number.isFinite(next.width) || next.width <= 0) {
    throw new RangeError("Ink width must be a positive finite number.");
  }
  if (!Number.isFinite(next.opacity) || next.opacity < 0 || next.opacity > 1) {
    throw new RangeError("Ink opacity must be between zero and one.");
  }
  const source = object.stroke;
  const stroke = new Stroke({
    id: source.id,
    timestamp: source.timestamp,
    points: source.points,
    sourceSamples: source.sourceSamples,
    style: { ...source.style, color: next.color, width: next.width, opacity: next.opacity },
    brush: createResolvedBrushSnapshot({
      ...source.brush,
      color: next.color,
      size: next.width,
      opacity: next.opacity,
    }),
    metrics: source.metrics,
    statistics: source.statistics,
  });
  return factory.createInkObject({
    id: object.id,
    stroke,
    createdAt: object.createdAt,
    modifiedAt,
    visible: object.visible,
    locked: object.locked,
    metadata: object.metadata,
    zIndex: object.zIndex,
    transform: object.transform,
    renderingHints: object.renderingHints,
  });
}

/** Narrows a PageObject to a committed InkObject. */
export function isInkObject(object: PageObject | undefined): object is InkObject {
  return object instanceof InkObject;
}
