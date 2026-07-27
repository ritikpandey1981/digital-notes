import type { InkObjectView, PageObject } from "@folio/document";
import type { HitTestEngine, HitTestEngineOptions } from "../interfaces/hit-test-engine";
import type { PagePoint } from "../model/coordinates";
import { DEFAULT_HIT_TEST_CONFIGURATION, type HitTestResult } from "../model/hit-test";
import {
  createLinearHitTestCandidateStrategy,
  type HitTestCandidateStrategy,
} from "./candidate-strategy";
import { distanceToInkGeometry, isValidPagePoint } from "./geometry";

function resolveConfiguration(options: HitTestEngineOptions): number {
  const tolerance = options.configuration?.tolerance ?? DEFAULT_HIT_TEST_CONFIGURATION.tolerance;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("Hit-test tolerance must be a finite non-negative number.");
  }
  return tolerance;
}

function compareTopMost(first: HitTestResult, second: HitTestResult): number {
  const zOrder = second.objectReference.zIndex - first.objectReference.zIndex;
  return zOrder === 0 ? first.objectId.localeCompare(second.objectId) : zOrder;
}

function isAbove(candidate: PageObject, current: PageObject): boolean {
  if (candidate.zIndex !== current.zIndex) {
    return candidate.zIndex > current.zIndex;
  }
  return candidate.id.localeCompare(current.id) < 0;
}

function createResult(
  object: PageObject,
  position: PagePoint,
  distance: number,
  tolerance: number,
): HitTestResult {
  const hitPosition: PagePoint = Object.freeze({
    x: position.x,
    y: position.y,
    coordinateSpace: "page",
  });
  return Object.freeze({
    objectId: object.id,
    objectType: object.type,
    objectReference: object,
    hitPosition,
    hitDistance: distance,
    hitConfidence:
      distance === 0 ? 1 : Math.max(0, Math.min(1, 1 - distance / Math.max(tolerance, 1))),
  });
}

class HitTestEngineImplementation implements HitTestEngine {
  private readonly tolerance: number;
  private readonly candidateStrategy: HitTestCandidateStrategy;

  constructor(options: HitTestEngineOptions) {
    this.tolerance = resolveConfiguration(options);
    this.candidateStrategy = createLinearHitTestCandidateStrategy(options.objectSource);
  }

  hitTest(position: PagePoint): HitTestResult | null {
    if (!isValidPagePoint(position)) return null;
    let topMostObject: PageObject | null = null;
    let topMostDistance = Number.POSITIVE_INFINITY;
    for (const object of this.candidateStrategy.query(position, this.tolerance)) {
      const distance = this.distanceToObject(position, object);
      if (
        distance !== null &&
        distance <= this.tolerance &&
        (topMostObject === null || isAbove(object, topMostObject))
      ) {
        topMostObject = object;
        topMostDistance = distance;
      }
    }
    return topMostObject === null
      ? null
      : createResult(topMostObject, position, topMostDistance, this.tolerance);
  }

  queryNearby(position: PagePoint, radius = this.tolerance): readonly HitTestResult[] {
    if (!isValidPagePoint(position) || !Number.isFinite(radius) || radius < 0) {
      return Object.freeze([]);
    }
    const results: HitTestResult[] = [];
    for (const object of this.candidateStrategy.query(position, radius)) {
      const distance = this.distanceToObject(position, object);
      if (distance !== null && distance <= radius) {
        results.push(createResult(object, position, distance, radius));
      }
    }
    results.sort(compareTopMost);
    return Object.freeze(results);
  }

  private distanceToObject(position: PagePoint, object: PageObject): number | null {
    if (object.type !== "ink") return null;
    return distanceToInkGeometry(position, object as InkObjectView);
  }
}

/** Creates a deterministic vector hit-test engine backed by a replaceable linear query. */
export function createHitTestEngine(options: HitTestEngineOptions): HitTestEngine {
  return new HitTestEngineImplementation(options);
}
