import { isJsonSerializable, type JsonObject, type JsonValue } from "@folio/domain";
import { ObjectValidationError } from "../errors";

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneJsonValue(item)));
  }
  return freezeJsonObject(value as JsonObject);
}

export function isPlainJsonObject(value: unknown): value is JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && isJsonSerializable(value);
}

export function freezeJsonObject(value: JsonObject, path = "$.metadata"): JsonObject {
  if (!isPlainJsonObject(value)) {
    throw new ObjectValidationError([
      {
        path,
        code: "invalid_metadata",
        message: "Object metadata must be a plain JSON-safe object.",
      },
    ]);
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) result[key] = cloneJsonValue(item);
  return Object.freeze(result);
}
