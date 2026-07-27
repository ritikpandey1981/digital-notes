export { createSelectionController } from "./controller/selection-controller";
export { createHitTestEngine } from "./hit-testing/hit-test-engine";
export type {
  HitTestEngine,
  HitTestEngineOptions,
  SelectionObjectSource,
} from "./interfaces/hit-test-engine";
export type {
  SelectionController,
  SelectionControllerOptions,
  SelectionCoordinateMapper,
  SelectionPointerInput,
  SelectionPointerPhase,
} from "./interfaces/selection-controller";
export type {
  SelectionChangeListener,
  SelectionManager,
  SelectionManagerOptions,
  SelectionTarget,
} from "./interfaces/selection-manager";
export { createSelectionManager } from "./manager/selection-manager";
export type {
  PagePoint,
  ScreenPoint,
  SelectionCoordinateSpace,
  SelectionPoint,
  ViewportPoint,
} from "./model/coordinates";
export {
  DEFAULT_HIT_TEST_CONFIGURATION,
  type HitTestConfiguration,
  type HitTestResult,
} from "./model/hit-test";
export type { SelectionState } from "./state/selection-state";
