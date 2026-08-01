import { Transform, type LineGeometry, type VectorPageObject } from "@folio/document";
import type {
  ManipulationResult,
  RotationManipulationResult,
  ScaleManipulationResult,
  TranslationManipulationResult,
} from "@folio/manipulation";
import type { PagePoint } from "@folio/selection";

export type LineHandle = "start" | "end" | "midpoint";
export type LineEndpoint = Exclude<LineHandle, "midpoint">;

export interface LineHandleHit {
  readonly handle: LineHandle;
  readonly cursor: "crosshair" | "grab";
}

export interface LineEndpointResultInput {
  readonly objectId: string;
  readonly sessionId: string;
  readonly sessionTimestamp: number;
  readonly initialTransform: Transform;
  readonly finalTransform: Transform;
}

type LineObject = Extract<VectorPageObject, { readonly type: "line" }>;

const LINE_HANDLE_HIT_RADIUS_PIXELS = 10;
const MINIMUM_LINE_LENGTH = 0.5;
const VALUE_EPSILON = 1e-9;

/** Resolves screen-stable endpoint and midpoint handles for one selected line. */
export function resolveLineHandleHit(
  object: LineObject,
  position: PagePoint,
  zoom: number,
): LineHandleHit | null {
  if (
    position.coordinateSpace !== "page" ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(zoom) ||
    zoom <= 0
  ) {
    return null;
  }
  const geometry = lineWorldGeometry(object);
  const handles = [
    { handle: "start", point: geometry.start, cursor: "crosshair" },
    { handle: "end", point: geometry.end, cursor: "crosshair" },
    {
      handle: "midpoint",
      point: midpoint(geometry.start, geometry.end),
      cursor: "grab",
    },
  ] as const;
  const radius = LINE_HANDLE_HIT_RADIUS_PIXELS / zoom;
  const hit = handles
    .map((handle) => ({ ...handle, distance: distance(position, handle.point) }))
    .filter(({ distance: hitDistance }) => hitDistance <= radius)
    .sort((first, second) => first.distance - second.distance)[0];
  return hit === undefined ? null : Object.freeze({ handle: hit.handle, cursor: hit.cursor });
}

/** Calculates one immutable absolute transform while keeping the opposite endpoint anchored. */
export function transformLineEndpoint(
  object: LineObject,
  endpoint: LineEndpoint,
  current: PagePoint,
): Transform | null {
  if (
    current.coordinateSpace !== "page" ||
    !Number.isFinite(current.x) ||
    !Number.isFinite(current.y)
  ) {
    return null;
  }
  const movingLocal = object.geometry[endpoint];
  const fixedLocal = object.geometry[endpoint === "start" ? "end" : "start"];
  const pivot = linePivot(object);
  const fixedWorld = object.transform.applyToPoint(fixedLocal, pivot);
  const localDelta = {
    x: movingLocal.x - fixedLocal.x,
    y: movingLocal.y - fixedLocal.y,
  };
  const targetDelta = { x: current.x - fixedWorld.x, y: current.y - fixedWorld.y };
  const localLength = Math.hypot(localDelta.x, localDelta.y);
  const targetLength = Math.hypot(targetDelta.x, targetDelta.y);
  if (localLength <= VALUE_EPSILON || targetLength < MINIMUM_LINE_LENGTH) return null;

  const scale = targetLength / localLength;
  const rotation =
    Math.atan2(targetDelta.y, targetDelta.x) - Math.atan2(localDelta.y, localDelta.x);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const fixedPivotX = (fixedLocal.x - pivot.x) * scale;
  const fixedPivotY = (fixedLocal.y - pivot.y) * scale;
  const transformedFixedX = fixedPivotX * cosine - fixedPivotY * sine;
  const transformedFixedY = fixedPivotX * sine + fixedPivotY * cosine;
  return new Transform({
    translation: {
      x: fixedWorld.x - pivot.x - transformedFixedX,
      y: fixedWorld.y - pivot.y - transformedFixedY,
    },
    rotation,
    scale,
  });
}

/** Adapts an endpoint interaction into existing immutable transform results. */
export function createLineEndpointManipulationResults(
  input: LineEndpointResultInput,
): readonly ManipulationResult[] {
  const results: ManipulationResult[] = [];
  const initial = input.initialTransform;
  const final = input.finalTransform;
  if (!nearlyEqual(initial.rotation, final.rotation)) {
    const rotation: RotationManipulationResult = Object.freeze({
      kind: "rotation",
      sessionId: `${input.sessionId}-angle`,
      objectId: input.objectId,
      rotation: Object.freeze({
        deltaRadians: normalizedRadians(final.rotation - initial.rotation),
      }),
      initialObjectRotation: initial.rotation,
      finalObjectRotation: final.rotation,
      sessionTimestamp: input.sessionTimestamp,
    });
    results.push(rotation);
  }
  if (!nearlyEqual(initial.scale, final.scale)) {
    const scale: ScaleManipulationResult = Object.freeze({
      kind: "scale",
      sessionId: `${input.sessionId}-length`,
      objectId: input.objectId,
      scale: Object.freeze({ factor: final.scale / initial.scale }),
      initialObjectScale: initial.scale,
      finalObjectScale: final.scale,
      sessionTimestamp: input.sessionTimestamp,
    });
    results.push(scale);
  }
  const deltaX = final.translation.x - initial.translation.x;
  const deltaY = final.translation.y - initial.translation.y;
  if (!nearlyEqual(deltaX, 0) || !nearlyEqual(deltaY, 0)) {
    const translation: TranslationManipulationResult = Object.freeze({
      kind: "translation",
      sessionId: `${input.sessionId}-anchor`,
      objectId: input.objectId,
      translation: Object.freeze({
        translationX: deltaX,
        translationY: deltaY,
        totalDistance: Math.hypot(deltaX, deltaY),
        movementVector: Object.freeze({ x: deltaX, y: deltaY }),
      }),
      initialObjectTranslation: initial.translation,
      finalObjectTranslation: final.translation,
      sessionTimestamp: input.sessionTimestamp,
    });
    results.push(translation);
  }
  return Object.freeze(results);
}

export function lineWorldGeometry(object: LineObject, transform = object.transform): LineGeometry {
  const pivot = linePivot(object);
  return Object.freeze({
    start: transform.applyToPoint(object.geometry.start, pivot),
    end: transform.applyToPoint(object.geometry.end, pivot),
  });
}

function linePivot(object: LineObject): Readonly<{ x: number; y: number }> {
  return Object.freeze({
    x: object.localBounds.x + object.localBounds.width / 2,
    y: object.localBounds.y + object.localBounds.height / 2,
  });
}

function midpoint(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 });
}

function distance(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>,
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function nearlyEqual(first: number, second: number): boolean {
  return Math.abs(first - second) <= VALUE_EPSILON;
}

function normalizedRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}
