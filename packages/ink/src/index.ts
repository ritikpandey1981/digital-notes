export { InkError, type InkErrorCode } from "./errors";
export {
  createBrushPreset,
  createResolvedBrushSnapshot,
  evaluatePressureResponse,
  isSupportedBrushStrategy,
  resolveBrushPreset,
  supportedBrushStrategies,
  type BrushDynamics,
  type BrushFamily,
  type BrushPreset,
  type BrushPresetDefaults,
  type BrushPressureCurve,
  type BrushPressureCurveKind,
  type BrushPressureResponse,
  type BrushRendererDefinition,
  type BrushRendererKind,
  type BrushSmoothing,
  type BrushStrategyId,
  type ResolvedBrushOverrides,
  type ResolvedBrushSnapshot,
} from "./brush-model";
export {
  DEFAULT_INDEX_BUDGET_BYTES,
  DEFAULT_MATERIAL_BUDGET_BYTES,
  MaterialPriority,
  PencilMaterialRuntime,
  SLICE_BUDGET_MS,
  materialTileKey,
  type MaterialPriorityValue,
  type MaterialTileKey,
  type MaterialTileRequest,
  type PencilMaterialRuntimeOptions,
  type PencilMaterialRuntimeStats,
} from "./internal/pencil-material";
export {
  createPencilMaterialRuntime,
  materialTileRect,
  pencilGeometryDiagnostics,
  pencilMaterialCacheId,
} from "./internal/pencil-material-strategy";
export { PointerInputController } from "./pointer-input-controller";
export {
  getStrokeLocalRenderBounds,
  getStrokeRenderedBounds,
  getStrokeTransformPivot,
  getStrokeVisualLocalBounds,
} from "./rendered-stroke-bounds";
export { Stroke, type StrokeData } from "./stroke";
export { StrokeBuilder } from "./stroke-builder";
export { StrokeRenderer } from "./stroke-renderer";
export { StrokeSmoother } from "./stroke-smoother";
export { createStrokeVisual, type StrokeVisual } from "./stroke-visual";
export {
  DEFAULT_STROKE_STYLE,
  type FinalizedStrokeVisual,
  type InkErrorLike,
  type InkPointerType,
  type PointerInputCallbacks,
  type PointerInputControllerOptions,
  type SmoothingHook,
  type StrokeBounds,
  type StrokeBuilderOptions,
  type StrokeCancellation,
  type StrokeMetrics,
  type StrokePoint,
  type StrokePointInput,
  type StrokeRendererOptions,
  type StrokeRendererSnapshot,
  type StrokeSampleOptions,
  type StrokeSmootherOptions,
  type StrokeSmoothingMode,
  type StrokeStatistics,
  type StrokeStyle,
  type StrokeTransform,
  type StrokeUpdate,
} from "./types";
