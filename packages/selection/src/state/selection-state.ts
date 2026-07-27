import type { PageObjectType } from "@folio/document";

/** Lightweight immutable editor state containing object identities only. */
export interface SelectionState {
  readonly selectedObjectId: string | null;
  readonly selectedObjectIds: readonly string[];
  readonly selectedObjectType: PageObjectType | null;
  readonly selectionTimestamp: number | null;
  readonly selectionVersion: number;
}

export function createSelectionState(
  selectedObjectId: string | null,
  selectedObjectType: PageObjectType | null,
  selectionTimestamp: number | null,
  selectionVersion: number,
): SelectionState {
  return Object.freeze({
    selectedObjectId,
    selectedObjectIds: Object.freeze(selectedObjectId === null ? [] : [selectedObjectId]),
    selectedObjectType,
    selectionTimestamp,
    selectionVersion,
  });
}
