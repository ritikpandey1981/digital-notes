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
