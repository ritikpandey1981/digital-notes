export { DocumentObjectError, ObjectValidationError } from "./errors";
export { InkObject } from "./ink-object";
export { ObjectCollection } from "./object-collection";
export { ObjectFactory, cloneObject, createInkObject, translateObject } from "./object-factory";
export { Transform, type TransformInput } from "./transform";
export type {
  CloneObjectOptions,
  CreateInkObjectInput,
  InkObjectData,
  InkObjectView,
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
  RenderingHints,
  SerializedPageObject,
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
