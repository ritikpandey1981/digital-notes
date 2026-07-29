export {};
export {
  EDITOR_PRESET_COLORS,
  createEditorColorSystem,
  type EditorColorSystem,
  type EditorColorSystemOptions,
  type EditorColorSystemSnapshot,
} from "./foundation/color-system";
export {
  DEFAULT_PEN_PRESETS,
  EDITOR_STROKE_WIDTHS,
  createPenPresetStore,
  type BrushType,
  type DrawingToolKind,
  type PenPreset,
  type PenPresetPatch,
  type PenPresetStore,
  type PenPresetStoreSnapshot,
  type PenPressureSettings,
} from "./foundation/pen-presets";
export {
  createDefaultPropertyDescriptorRegistry,
  createInkPropertyProvider,
  createPropertyDescriptorRegistry,
  type EditablePropertyConstraints,
  type EditablePropertyDescriptor,
  type EditablePropertyProvider,
  type EditablePropertyType,
  type PropertyDescriptorRegistry,
} from "./foundation/property-descriptors";
export {
  createEditorToolRegistry,
  type EditorTool,
  type EditorToolContext,
  type EditorToolKeyboardPhase,
  type EditorToolPointerPhase,
  type EditorToolRegistry,
  type EditorToolRegistrySnapshot,
} from "./tools/editor-tool-registry";
export {
  CanvasSurface,
  type CanvasDrawingStyle,
  type CanvasInteractionMode,
  type CanvasSurfaceProps,
  type ObjectLifecycleActions,
} from "./CanvasSurface";
