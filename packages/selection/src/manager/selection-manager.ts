import type {
  SelectionChangeListener,
  SelectionManager,
  SelectionManagerOptions,
  SelectionTarget,
} from "../interfaces/selection-manager";
import type { HitTestResult } from "../model/hit-test";
import { createSelectionState, type SelectionState } from "../state/selection-state";

class SelectionManagerImplementation implements SelectionManager {
  private readonly now: () => number;
  private readonly listeners = new Set<SelectionChangeListener>();
  private stateValue = createSelectionState(null, null, null, 0);

  constructor(options: SelectionManagerOptions) {
    this.now = options.now ?? Date.now;
  }

  selectObject(target: SelectionTarget): SelectionState {
    if (target.objectId.trim().length === 0) return this.stateValue;
    if (
      this.stateValue.selectedObjectId === target.objectId &&
      this.stateValue.selectedObjectType === target.objectType
    ) {
      return this.stateValue;
    }

    const timestamp = this.now();
    if (!Number.isFinite(timestamp)) {
      throw new RangeError("Selection timestamps must be finite numbers.");
    }
    return this.replaceState(
      createSelectionState(
        target.objectId,
        target.objectType,
        timestamp,
        this.stateValue.selectionVersion + 1,
      ),
    );
  }

  replaceSelection(result: HitTestResult | null): SelectionState {
    return result === null
      ? this.clearSelection()
      : this.selectObject({ objectId: result.objectId, objectType: result.objectType });
  }

  clearSelection(): SelectionState {
    if (!this.hasSelection()) return this.stateValue;
    const timestamp = this.now();
    if (!Number.isFinite(timestamp)) {
      throw new RangeError("Selection timestamps must be finite numbers.");
    }
    return this.replaceState(
      createSelectionState(null, null, timestamp, this.stateValue.selectionVersion + 1),
    );
  }

  getSelection(): SelectionState {
    return this.stateValue;
  }

  hasSelection(): boolean {
    return this.stateValue.selectedObjectId !== null;
  }

  isSelected(objectId: string): boolean {
    return this.stateValue.selectedObjectId === objectId;
  }

  subscribe(listener: SelectionChangeListener): () => void {
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  private replaceState(state: SelectionState): SelectionState {
    const previousState = this.stateValue;
    this.stateValue = state;
    for (const listener of [...this.listeners]) listener(state, previousState);
    return state;
  }
}

/** Creates an isolated selection manager with no global or document state. */
export function createSelectionManager(options: SelectionManagerOptions = {}): SelectionManager {
  return new SelectionManagerImplementation(options);
}
