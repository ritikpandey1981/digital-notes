import { InkObject, type PageObject } from "@folio/document";

/** Selects the topmost eligible ink candidate without changing general editor hit testing. */
export function firstErasableInkCandidate(
  candidates: readonly PageObject[],
  excludedObjectIds: ReadonlySet<string>,
): InkObject | null {
  return (
    candidates.find(
      (object): object is InkObject =>
        object instanceof InkObject &&
        object.visible &&
        !object.locked &&
        !excludedObjectIds.has(object.id),
    ) ?? null
  );
}
