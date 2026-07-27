import type {
  SelectionController,
  SelectionControllerOptions,
  SelectionPointerInput,
} from "../interfaces/selection-controller";
import type { SelectionChangeListener } from "../interfaces/selection-manager";
import type { ScreenPoint } from "../model/coordinates";
import type { HitTestResult } from "../model/hit-test";
import type { SelectionState } from "../state/selection-state";

interface ActivePointer {
  readonly pointerId: number;
  readonly origin: ScreenPoint;
  moved: boolean;
}

class SelectionControllerImplementation implements SelectionController {
  private readonly movementThresholdSquared: number;
  private activePointer: ActivePointer | null = null;
  private destroyed = false;

  constructor(private readonly options: SelectionControllerOptions) {
    const threshold = options.clickMovementThreshold ?? 4;
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new RangeError("Click movement threshold must be a finite non-negative number.");
    }
    this.movementThresholdSquared = threshold * threshold;
  }

  handlePointer(input: SelectionPointerInput): HitTestResult | null {
    if (this.destroyed) return null;
    if (input.phase === "cancel") {
      if (this.activePointer?.pointerId === input.pointerId) this.activePointer = null;
      return null;
    }
    if (!input.isPrimary) return null;

    if (input.phase === "down") {
      if (input.button !== 0 || this.activePointer !== null) return null;
      this.activePointer = {
        pointerId: input.pointerId,
        origin: input.position,
        moved: false,
      };
      return null;
    }

    const active = this.activePointer;
    if (active === null || active.pointerId !== input.pointerId) return null;
    if (input.phase === "move") {
      const deltaX = input.position.x - active.origin.x;
      const deltaY = input.position.y - active.origin.y;
      if (deltaX * deltaX + deltaY * deltaY > this.movementThresholdSquared) {
        active.moved = true;
      }
      return null;
    }

    this.activePointer = null;
    if (active.moved) return null;
    const result = this.hitTest(input.position);
    this.options.manager.replaceSelection(result);
    return result;
  }

  hitTest(position: ScreenPoint): HitTestResult | null {
    if (this.destroyed) return null;
    const pagePosition = this.options.coordinateMapper.screenToPage(position);
    return pagePosition === null ? null : this.options.hitTestEngine.hitTest(pagePosition);
  }

  selectObject(objectId: string): SelectionState {
    if (this.destroyed) return this.options.manager.getSelection();
    const object = this.options.objectSource.getObject(objectId);
    return object === undefined
      ? this.options.manager.getSelection()
      : this.options.manager.selectObject({ objectId: object.id, objectType: object.type });
  }

  clearSelection(): SelectionState {
    return this.options.manager.clearSelection();
  }

  getSelection(): SelectionState {
    return this.options.manager.getSelection();
  }

  hasSelection(): boolean {
    return this.options.manager.hasSelection();
  }

  isSelected(objectId: string): boolean {
    return this.options.manager.isSelected(objectId);
  }

  subscribe(listener: SelectionChangeListener): () => void {
    if (this.destroyed) return () => undefined;
    return this.options.manager.subscribe(listener);
  }

  destroy(): void {
    this.activePointer = null;
    this.destroyed = true;
  }
}

/** Composes pointer interpretation, coordinate mapping, hit testing, and state replacement. */
export function createSelectionController(
  options: SelectionControllerOptions,
): SelectionController {
  return new SelectionControllerImplementation(options);
}
