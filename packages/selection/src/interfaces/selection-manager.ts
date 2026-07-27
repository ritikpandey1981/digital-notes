import type { PageObjectType } from "@folio/document";
import type { HitTestResult } from "../model/hit-test";
import type { SelectionState } from "../state/selection-state";

/** Identity resolved by the editor without copying its document object. */
export interface SelectionTarget {
  readonly objectId: string;
  readonly objectType: PageObjectType;
}

/** Receives immutable state only when the logical selection changes. */
export type SelectionChangeListener = (
  state: SelectionState,
  previousState: SelectionState,
) => void;

/** Sole owner of the active session selection state. */
export interface SelectionManager {
  /** Selects an already-resolved object identity. */
  selectObject(target: SelectionTarget): SelectionState;

  /** Replaces selection from a hit result, or clears it for an empty hit. */
  replaceSelection(result: HitTestResult | null): SelectionState;

  /** Clears the current selection without modifying any document object. */
  clearSelection(): SelectionState;

  /** Returns the current immutable state reference. */
  getSelection(): SelectionState;

  /** Reports whether one object is currently selected. */
  hasSelection(): boolean;

  /** Compares selection by stable object identifier. */
  isSelected(objectId: string): boolean;

  /** Subscribes to logical selection changes and returns an unsubscribe function. */
  subscribe(listener: SelectionChangeListener): () => void;
}

/** Injectable dependencies used to create an isolated manager. */
export interface SelectionManagerOptions {
  readonly now?: () => number;
}
