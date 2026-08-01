import { isVectorObject, type PageObject, type VectorPageObject } from "@folio/document";
import type {
  HitTestEngine,
  HitTestResult,
  PagePoint,
  SelectionObjectSource,
} from "@folio/selection";
import { createHitTestEngine } from "@folio/selection";

const EDITOR_BOUNDS_HIT_TOLERANCE = 2;
const EDITOR_VECTOR_HIT_TOLERANCE = 6;

function distanceToBounds(position: PagePoint, object: PageObject): number {
  const bounds = object.bounds;
  const deltaX = Math.max(bounds.x - position.x, 0, position.x - (bounds.x + bounds.width));
  const deltaY = Math.max(bounds.y - position.y, 0, position.y - (bounds.y + bounds.height));
  return Math.hypot(deltaX, deltaY);
}

function compareTopMost(first: HitTestResult, second: HitTestResult): number {
  const zOrder = second.objectReference.zIndex - first.objectReference.zIndex;
  return zOrder === 0 ? first.objectId.localeCompare(second.objectId) : zOrder;
}

function createResult(
  object: PageObject,
  position: PagePoint,
  distance: number,
  tolerance: number,
): HitTestResult {
  return Object.freeze({
    objectId: object.id,
    objectType: object.type,
    objectReference: object,
    hitPosition: Object.freeze({
      x: position.x,
      y: position.y,
      coordinateSpace: "page" as const,
    }),
    hitDistance: distance,
    hitConfidence:
      distance === 0 ? 1 : Math.max(0, Math.min(1, 1 - distance / Math.max(tolerance, 1))),
  });
}

function isInsideVector(position: PagePoint, object: VectorPageObject): boolean {
  if (object.type === "line") return false;
  const pivot = {
    x: object.localBounds.x + object.localBounds.width / 2,
    y: object.localBounds.y + object.localBounds.height / 2,
  };
  const local = object.transform.invertPoint(position, pivot);
  if (object.type === "rectangle") {
    const { x, y, width, height } = object.geometry;
    return local.x >= x && local.x <= x + width && local.y >= y && local.y <= y + height;
  }
  const { center, radiusX, radiusY } = object.geometry;
  return ((local.x - center.x) / radiusX) ** 2 + ((local.y - center.y) / radiusY) ** 2 <= 1;
}

class EditorSelectionHitTestEngine implements HitTestEngine {
  readonly #vectorEngine: HitTestEngine;

  constructor(private readonly objectSource: SelectionObjectSource) {
    this.#vectorEngine = createHitTestEngine({
      objectSource: {
        getObjects: () =>
          this.objectSource
            .getObjects()
            .filter(
              (object): object is VectorPageObject =>
                object.visible && !object.locked && isVectorObject(object),
            ),
        getObject: (objectId) => {
          const object = this.objectSource.getObject(objectId);
          return object !== undefined && object.visible && !object.locked && isVectorObject(object)
            ? object
            : undefined;
        },
      },
      configuration: { tolerance: EDITOR_VECTOR_HIT_TOLERANCE },
    });
  }

  hitTest(position: PagePoint): HitTestResult | null {
    return (
      this.query(position, EDITOR_BOUNDS_HIT_TOLERANCE, EDITOR_VECTOR_HIT_TOLERANCE)[0] ?? null
    );
  }

  queryNearby(position: PagePoint, radius = EDITOR_BOUNDS_HIT_TOLERANCE): readonly HitTestResult[] {
    if (
      position.coordinateSpace !== "page" ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(radius) ||
      radius < 0
    ) {
      return Object.freeze([]);
    }
    return this.query(position, radius, radius);
  }

  private query(
    position: PagePoint,
    inkTolerance: number,
    vectorTolerance: number,
  ): readonly HitTestResult[] {
    const inkResults = this.objectSource
      .getObjects()
      .filter((object) => object.visible && !object.locked && object.type === "ink")
      .map((object) => ({ object, distance: distanceToBounds(position, object) }))
      .filter(({ distance }) => distance <= inkTolerance)
      .map(({ object, distance }) => createResult(object, position, distance, inkTolerance));
    const vectorResults = this.#vectorEngine.queryNearby(position, vectorTolerance);
    const interiorResults = this.objectSource
      .getObjects()
      .filter(
        (object): object is VectorPageObject =>
          object.visible &&
          !object.locked &&
          isVectorObject(object) &&
          isInsideVector(position, object),
      )
      .map((object) => createResult(object, position, 0, vectorTolerance));
    const resultsById = new Map<string, HitTestResult>();
    for (const result of [...inkResults, ...vectorResults, ...interiorResults]) {
      const current = resultsById.get(result.objectId);
      if (current === undefined || result.hitDistance < current.hitDistance) {
        resultsById.set(result.objectId, result);
      }
    }
    const results = [...resultsById.values()];
    results.sort(compareTopMost);
    return Object.freeze(results);
  }
}

/** Creates the editor's forgiving bounds-oriented selection policy. */
export function createEditorSelectionHitTestEngine(
  objectSource: SelectionObjectSource,
): HitTestEngine {
  return new EditorSelectionHitTestEngine(objectSource);
}

/** Package-internal exact candidate query matching the editor's asymmetric ink/vector tolerances. */
export function queryEditorSelectionCandidates(
  engine: HitTestEngine,
  position: PagePoint,
): readonly HitTestResult[] {
  return Object.freeze(
    engine
      .queryNearby(position, EDITOR_VECTOR_HIT_TOLERANCE)
      .filter(
        (result) =>
          result.objectType !== "ink" || result.hitDistance <= EDITOR_BOUNDS_HIT_TOLERANCE,
      ),
  );
}
