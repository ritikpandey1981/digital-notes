import type { ObjectBounds, PageObject } from "@folio/document";
import type {
  ManipulationResult,
  ManipulationState,
  RotationManipulationResult,
  ScaleManipulationResult,
  TranslationManipulationResult,
} from "@folio/manipulation";
import type { EditorSelectionGeometrySnapshot } from "./EditorSelectionGeometry";

export interface EditorGroupManipulationPlan {
  readonly id: string;
  readonly description: string;
  readonly results: readonly ManipulationResult[];
}

/** Expands one group-level interaction into existing immutable per-object results. */
export function createEditorGroupManipulationPlan(
  source: ManipulationResult,
  selection: EditorSelectionGeometrySnapshot,
): EditorGroupManipulationPlan {
  if (selection.objects.length < 2 || source.objectId !== selection.primaryObject.id) {
    throw new TypeError("Grouped manipulation requires the active logical selection group.");
  }
  if (source.kind === "delete" || source.kind === "duplicate") {
    throw new TypeError("Only transform manipulations can be expanded as a group.");
  }
  const results = selection.objects.flatMap((object) =>
    createObjectResults(source, object, selection.bounds),
  );
  if (results.length === 0) {
    throw new Error("Grouped manipulation did not produce any document transformations.");
  }
  const label =
    source.kind === "translation" ? "Move" : source.kind === "rotation" ? "Rotate" : "Scale";
  return Object.freeze({
    id: `group-${source.kind}-${source.sessionId}`,
    description: `${label} ${selection.objects.length} selected objects`,
    results: Object.freeze(results),
  });
}

/** Produces the transient axis-aligned group overlay for the current interaction state. */
export function transformGroupBounds(bounds: ObjectBounds, state: ManipulationState): ObjectBounds {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  if (state.kind === "translation") {
    return Object.freeze({
      x: bounds.x + state.translation.translationX,
      y: bounds.y + state.translation.translationY,
      width: bounds.width,
      height: bounds.height,
    });
  }
  if (state.kind === "scale") {
    const factor = state.scale.factor;
    const width = bounds.width * factor;
    const height = bounds.height * factor;
    return Object.freeze({
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    });
  }
  if (state.kind === "rotation") {
    const cosine = Math.abs(Math.cos(state.rotation.deltaRadians));
    const sine = Math.abs(Math.sin(state.rotation.deltaRadians));
    const width = bounds.width * cosine + bounds.height * sine;
    const height = bounds.width * sine + bounds.height * cosine;
    return Object.freeze({
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    });
  }
  return bounds;
}

function createObjectResults(
  source: TranslationManipulationResult | RotationManipulationResult | ScaleManipulationResult,
  object: PageObject,
  groupBounds: ObjectBounds,
): readonly ManipulationResult[] {
  if (source.kind === "translation") return [createTranslation(source, object)];
  const groupCenter = Object.freeze({
    x: groupBounds.x + groupBounds.width / 2,
    y: groupBounds.y + groupBounds.height / 2,
  });
  const objectCenter = Object.freeze({
    x: object.bounds.x + object.bounds.width / 2,
    y: object.bounds.y + object.bounds.height / 2,
  });
  if (source.kind === "rotation") {
    const rotatedCenter = rotatePoint(objectCenter, groupCenter, source.rotation.deltaRadians);
    return appendTranslation(
      createRotation(source, object),
      source,
      object,
      rotatedCenter.x - objectCenter.x,
      rotatedCenter.y - objectCenter.y,
    );
  }
  const scaledCenter = Object.freeze({
    x: groupCenter.x + (objectCenter.x - groupCenter.x) * source.scale.factor,
    y: groupCenter.y + (objectCenter.y - groupCenter.y) * source.scale.factor,
  });
  return appendTranslation(
    createScale(source, object),
    source,
    object,
    scaledCenter.x - objectCenter.x,
    scaledCenter.y - objectCenter.y,
  );
}

function createTranslation(
  source: TranslationManipulationResult,
  object: PageObject,
): TranslationManipulationResult {
  return createObjectTranslation(
    source,
    object,
    source.translation.translationX,
    source.translation.translationY,
    "move",
  );
}

function createRotation(
  source: RotationManipulationResult,
  object: PageObject,
): RotationManipulationResult {
  return Object.freeze({
    kind: "rotation",
    sessionId: `${source.sessionId}:${object.id}:rotate`,
    objectId: object.id,
    rotation: source.rotation,
    initialObjectRotation: object.transform.rotation,
    finalObjectRotation: object.transform.rotation + source.rotation.deltaRadians,
    sessionTimestamp: source.sessionTimestamp,
  });
}

function createScale(source: ScaleManipulationResult, object: PageObject): ScaleManipulationResult {
  return Object.freeze({
    kind: "scale",
    sessionId: `${source.sessionId}:${object.id}:scale`,
    objectId: object.id,
    scale: source.scale,
    initialObjectScale: object.transform.scale,
    finalObjectScale: object.transform.scale * source.scale.factor,
    sessionTimestamp: source.sessionTimestamp,
  });
}

function appendTranslation(
  transform: RotationManipulationResult | ScaleManipulationResult,
  source: RotationManipulationResult | ScaleManipulationResult,
  object: PageObject,
  deltaX: number,
  deltaY: number,
): readonly ManipulationResult[] {
  if (Math.abs(deltaX) <= Number.EPSILON && Math.abs(deltaY) <= Number.EPSILON) {
    return [transform];
  }
  return [transform, createObjectTranslation(source, object, deltaX, deltaY, "reposition")];
}

function createObjectTranslation(
  source: ManipulationResult,
  object: PageObject,
  deltaX: number,
  deltaY: number,
  suffix: "move" | "reposition",
): TranslationManipulationResult {
  const initialObjectTranslation = object.transform.translation;
  const finalObjectTranslation = Object.freeze({
    x: initialObjectTranslation.x + deltaX,
    y: initialObjectTranslation.y + deltaY,
  });
  return Object.freeze({
    kind: "translation",
    sessionId: `${source.sessionId}:${object.id}:${suffix}`,
    objectId: object.id,
    translation: Object.freeze({
      translationX: deltaX,
      translationY: deltaY,
      totalDistance: Math.hypot(deltaX, deltaY),
      movementVector: Object.freeze({ x: deltaX, y: deltaY }),
    }),
    initialObjectTranslation,
    finalObjectTranslation,
    sessionTimestamp: source.sessionTimestamp,
  });
}

function rotatePoint(
  point: Readonly<{ x: number; y: number }>,
  pivot: Readonly<{ x: number; y: number }>,
  radians: number,
): Readonly<{ x: number; y: number }> {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localX = point.x - pivot.x;
  const localY = point.y - pivot.y;
  return Object.freeze({
    x: pivot.x + localX * cosine - localY * sine,
    y: pivot.y + localX * sine + localY * cosine,
  });
}
