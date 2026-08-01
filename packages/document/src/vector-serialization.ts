import type { JsonObject } from "@folio/domain";
import { DocumentObjectError } from "./errors";
import { isPlainJsonObject } from "./internal/json";
import { ObjectFactory } from "./object-factory";
import { Transform } from "./transform";
import type {
  EllipseGeometry,
  LineGeometry,
  RectangleGeometry,
  SerializedPageObject,
  VectorPageObject,
} from "./types";
import { isVectorObject } from "./vector-object";

export type SerializedVectorObject = SerializedPageObject<
  JsonObject & Readonly<{ geometry: JsonObject; style: JsonObject }>
>;

/** Converts one immutable vector PageObject into the existing versioned object envelope. */
export function serializeVectorObject(object: VectorPageObject): SerializedVectorObject {
  if (!isVectorObject(object)) {
    throw new DocumentObjectError(
      "UNSUPPORTED_OBJECT_TYPE",
      "Vector serialization requires a Line, Rectangle, or Ellipse object.",
    );
  }
  return Object.freeze({
    id: object.id,
    type: object.type,
    createdAt: object.createdAt,
    modifiedAt: object.modifiedAt,
    bounds: object.bounds,
    visible: object.visible,
    locked: object.locked,
    metadata: object.metadata,
    zIndex: object.zIndex,
    transform: Object.freeze({
      translation: object.transform.translation,
      rotation: object.transform.rotation,
      scale: object.transform.scale,
    }),
    version: object.version,
    payload: Object.freeze({
      geometry: toJsonObject(object.geometry),
      style: toJsonObject(object.style),
    }),
  });
}

/** Reconstructs and validates a vector PageObject from its versioned object envelope. */
export function deserializeVectorObject(serialized: SerializedVectorObject): VectorPageObject {
  if (
    serialized === null ||
    typeof serialized !== "object" ||
    serialized.version !== 1 ||
    !["line", "rectangle", "ellipse"].includes(serialized.type) ||
    !isPlainJsonObject(serialized.payload) ||
    !isPlainJsonObject(serialized.payload.geometry) ||
    !isPlainJsonObject(serialized.payload.style)
  ) {
    throw new DocumentObjectError("INVALID_OBJECT", "Serialized vector object is invalid.");
  }
  const common = {
    id: serialized.id,
    createdAt: serialized.createdAt,
    modifiedAt: serialized.modifiedAt,
    visible: serialized.visible,
    locked: serialized.locked,
    metadata: serialized.metadata,
    zIndex: serialized.zIndex,
    transform: new Transform(serialized.transform),
    style: serialized.payload.style,
  } as const;
  const factory = new ObjectFactory();
  switch (serialized.type) {
    case "line":
      return factory.createLineObject({
        ...common,
        geometry: serialized.payload.geometry as unknown as LineGeometry,
      });
    case "rectangle":
      return factory.createRectangleObject({
        ...common,
        geometry: serialized.payload.geometry as unknown as RectangleGeometry,
      });
    case "ellipse":
      return factory.createEllipseObject({
        ...common,
        geometry: serialized.payload.geometry as unknown as EllipseGeometry,
      });
    default:
      throw new DocumentObjectError(
        "UNSUPPORTED_OBJECT_TYPE",
        "Serialized object is not a supported vector type.",
        { type: serialized.type },
      );
  }
}

function toJsonObject(value: object): JsonObject {
  const serialized = JSON.parse(JSON.stringify(value)) as unknown;
  if (!isPlainJsonObject(serialized)) {
    throw new DocumentObjectError("INVALID_OBJECT", "Vector data is not JSON serializable.");
  }
  return serialized;
}
