import { InkObject, type PageObject } from "@folio/document";

function defaultErasable(object: PageObject): boolean {
  return object.visible && !object.locked;
}

/**
 * Selects the topmost eligible ink candidate without changing general editor
 * hit testing.
 *
 * The eligibility predicate is injected so Layer rules stay defined in one
 * place instead of being restated here.
 */
export function firstErasableInkCandidate(
  candidates: readonly PageObject[],
  excludedObjectIds: ReadonlySet<string>,
  isErasable: (object: PageObject) => boolean = defaultErasable,
): InkObject | null {
  return (
    candidates.find(
      (object): object is InkObject =>
        object instanceof InkObject && isErasable(object) && !excludedObjectIds.has(object.id),
    ) ?? null
  );
}
