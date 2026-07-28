import type { PageObject } from "@folio/document";
import type {
  HitTestEngine,
  HitTestResult,
  PagePoint,
  SelectionObjectSource,
} from "@folio/selection";

const EDITOR_BOUNDS_HIT_TOLERANCE = 2;

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

class EditorSelectionHitTestEngine implements HitTestEngine {
  constructor(private readonly objectSource: SelectionObjectSource) {}

  hitTest(position: PagePoint): HitTestResult | null {
    return this.query(position, EDITOR_BOUNDS_HIT_TOLERANCE)[0] ?? null;
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
    return this.query(position, radius);
  }

  private query(position: PagePoint, tolerance: number): readonly HitTestResult[] {
    const results = this.objectSource
      .getObjects()
      .filter((object) => object.visible)
      .map((object) => ({ object, distance: distanceToBounds(position, object) }))
      .filter(({ distance }) => distance <= tolerance)
      .map(({ object, distance }) => createResult(object, position, distance, tolerance));
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
