import type { PageObject } from "@folio/document";
import type { SelectionObjectSource } from "../interfaces/hit-test-engine";
import type { PagePoint } from "../model/coordinates";
import { isWithinExpandedBounds } from "./geometry";

/** Private broad-phase strategy seam for future spatial indexes. */
export interface HitTestCandidateStrategy {
  query(position: PagePoint, tolerance: number): Iterable<PageObject>;
}

class LinearHitTestCandidateStrategy implements HitTestCandidateStrategy {
  constructor(private readonly objectSource: SelectionObjectSource) {}

  *query(position: PagePoint, tolerance: number): Iterable<PageObject> {
    for (const object of this.objectSource.getObjects()) {
      if (object.visible && isWithinExpandedBounds(position, object.bounds, tolerance)) {
        yield object;
      }
    }
  }
}

export function createLinearHitTestCandidateStrategy(
  objectSource: SelectionObjectSource,
): HitTestCandidateStrategy {
  return new LinearHitTestCandidateStrategy(objectSource);
}
