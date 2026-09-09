export {
  DocumentObjectError,
  LayerMembershipError,
  ObjectValidationError,
  type LayerMembershipErrorCode,
} from "./errors";
export {
  createDefaultLayer,
  DEFAULT_LAYER_NAME,
  Layer,
  type LayerData,
  type LayerPatch,
} from "./layer";
export { PageDocument, type LayerRange } from "./page-document";
export {
  createEditableColor,
  createEditableStyle,
  normalizeHexColor,
  type EditableBlendMode,
  type EditableColor,
  type EditableColorInput,
  type EditableLineStyle,
  type EditableRgbColor,
  type EditableShadow,
  type EditableStyle,
  type EditableStyleInput,
} from "./editable-style";
export { InkObject } from "./ink-object";
export {
  EllipseObject,
  LineObject,
  RectangleObject,
  isVectorObject,
  vectorGeometryBounds,
} from "./vector-object";
export {
  deserializeVectorObject,
  serializeVectorObject,
  type SerializedVectorObject,
} from "./vector-serialization";
export { ObjectCollection } from "./object-collection";
export {
  ObjectFactory,
  cloneObject,
  createEllipseObject,
  createInkObject,
  createLineObject,
  createRectangleObject,
  positionObject,
  rotateObject,
  scaleObject,
  translateObject,
} from "./object-factory";
export { Transform, type TransformInput } from "./transform";
export type {
  CloneObjectOptions,
  CreateEllipseObjectInput,
  CreateInkObjectInput,
  CreateLineObjectInput,
  CreateRectangleObjectInput,
  EllipseGeometry,
  EllipseObjectView,
  InkObjectData,
  InkObjectView,
  LineGeometry,
  LineObjectView,
  ObjectBounds,
  ObjectCollectionStatistics,
  ObjectFactoryOptions,
  ObjectMetadata,
  ObjectSerializationContract,
  ObjectValidationIssue,
  ObjectValidationResult,
  ObjectVersion,
  PageObject,
  PageObjectType,
  RectangleGeometry,
  RectangleObjectView,
  RenderingHints,
  SerializedPageObject,
  VectorGeometry,
  VectorObjectData,
  VectorObjectType,
  VectorPageObject,
} from "./types";
export {
  assertValidObject,
  assertValidObjectCollection,
  isObjectBounds,
  isObjectMetadata,
  isPageObject,
  validateObject,
  validateObjectCollection,
} from "./validation";
export {
  createPageGeometry,
  DEFAULT_PAGE_GEOMETRY,
  MAXIMUM_PAGE_EXTENT,
  MINIMUM_PAGE_EXTENT,
  matchPagePreset,
  orientPageGeometry,
  PAGE_PRESETS,
  pageOrientation,
  pagePreset,
  type PageGeometry,
  type PageOrientation,
  type PagePreset,
  type PagePresetId,
} from "./page-geometry";
export {
  createPagePaper,
  DEFAULT_PAGE_PAPER,
  DEFAULT_PAPER_COLOR,
  MAXIMUM_PAPER_SPACING,
  MINIMUM_PAPER_SPACING,
  PAPER_COLOR_PRESETS,
  PAPER_TYPES,
  paperTypeDefinition,
  samePagePaper,
  type PagePaper,
  type PagePaperInput,
  type PaperType,
  type PaperTypeDefinition,
} from "./page-paper";
export {
  createPageLike,
  duplicatePage,
  Page,
  SketchbookDocument,
  type PageIdentityFactory,
  type PageInput,
} from "./sketchbook-document";
