import type { PagePoint, ScreenPoint } from "../model/coordinates";
import type { HitTestResult } from "../model/hit-test";
import type { SelectionState } from "../state/selection-state";
import type { HitTestEngine, SelectionObjectSource } from "./hit-test-engine";
import type { SelectionChangeListener, SelectionManager } from "./selection-manager";

/** Pointer phases consumed without depending on browser event classes. */
export type SelectionPointerPhase = "down" | "move" | "up" | "cancel";

/** Normalized editor pointer input expressed in screen coordinates. */
export interface SelectionPointerInput {
  readonly phase: SelectionPointerPhase;
  readonly pointerId: number;
  readonly button: number;
  readonly isPrimary: boolean;
  readonly position: ScreenPoint;
}

/** Injected adapter for the existing screen-to-page viewport pipeline. */
export interface SelectionCoordinateMapper {
  /** Returns null when the screen point lies outside the active page. */
  screenToPage(position: ScreenPoint): PagePoint | null;
}

/** Public editor-facing API for pointer selection and selection queries. */
export interface SelectionController {
  /** Interprets normalized pointer input and selects only completed clicks. */
  handlePointer(input: SelectionPointerInput): HitTestResult | null;

  /** Queries a screen point without changing selection state. */
  hitTest(position: ScreenPoint): HitTestResult | null;

  /** Selects a valid active-page object by identity; invalid IDs are ignored. */
  selectObject(objectId: string): SelectionState;

  /** Clears current editor selection. */
  clearSelection(): SelectionState;

  /** Returns the current immutable state reference. */
  getSelection(): SelectionState;

  /** Reports whether one object is selected. */
  hasSelection(): boolean;

  /** Compares selection with a stable document-object identifier. */
  isSelected(objectId: string): boolean;

  /** Subscribes to state replacement without exposing the manager implementation. */
  subscribe(listener: SelectionChangeListener): () => void;

  /** Releases transient pointer state; document objects remain untouched. */
  destroy(): void;
}

/** Dependencies used to compose an editor selection controller. */
export interface SelectionControllerOptions {
  readonly manager: SelectionManager;
  readonly hitTestEngine: HitTestEngine;
  readonly objectSource: SelectionObjectSource;
  readonly coordinateMapper: SelectionCoordinateMapper;
  readonly clickMovementThreshold?: number;
}
