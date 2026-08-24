export {};
export {
  EDITOR_PRESET_COLORS,
  createEditorColorSystem,
  type EditorColorSystem,
  type EditorColorSystemOptions,
  type EditorColorSystemSnapshot,
} from "./foundation/color-system";
export {
  DEFAULT_BRUSH_PRESETS,
  DEFAULT_BRUSH_PRESET_IDS,
  DEFAULT_PEN_PRESETS,
  EDITOR_STROKE_WIDTHS,
  createBrushToolStateStore,
  createPenPresetStore,
  type ActiveToolState,
  type ActiveToolStatePatch,
  type BrushToolStateStore,
  type BrushToolStateStoreSnapshot,
  type DrawingToolKind,
  type PenPreset,
  type PenPresetPatch,
  type PenPresetStore,
  type PenPresetStoreSnapshot,
  type ResolvedDrawingBrush,
} from "./foundation/pen-presets";
export {
  createDefaultPropertyDescriptorRegistry,
  createInkPropertyProvider,
  createPropertyDescriptorRegistry,
  createVectorPropertyProvider,
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
  type ShapeEditingActions,
  type ShapeEditingSnapshot,
  type ShapeStylePatch,
} from "./CanvasSurface";
export {
  DEFAULT_EDITOR_VIEWPORT_SNAPSHOT,
  EDITOR_VIEWPORT_ZOOM_PRESETS,
  editorViewportWheelZoom,
  formatEditorViewportZoom,
  nextEditorViewportZoom,
  type EditorViewportSnapshot,
  type ViewportActions,
} from "./EditorViewport";
