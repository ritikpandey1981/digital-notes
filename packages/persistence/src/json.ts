import { isJsonSerializable } from "@folio/domain";
import type { JsonObject, JsonValue } from "@folio/domain";
import { PersistenceError } from "./errors";

export function stableStringify(value: JsonValue): string {
  if (!isJsonSerializable(value)) {
    throw new PersistenceError("INVALID_DATA", "Value is not JSON serializable.");
  }
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

export function parseJsonObject(content: string, filePath?: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new PersistenceError("CORRUPT_JSON", "File contains corrupted JSON.", {
      path: filePath,
      cause: error,
    });
  }
  if (!isPlainRecord(parsed) || !isJsonSerializable(parsed)) {
    throw new PersistenceError("INVALID_DATA", "Expected a JSON object document.", {
      path: filePath,
    });
  }
  return parsed as JsonObject;
}

export function extractUnknownFields(
  document: JsonObject,
  knownFields: readonly string[],
): JsonObject {
  const known = new Set(knownFields);
  return Object.fromEntries(Object.entries(document).filter(([key]) => !known.has(key)));
}

function sortJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right, "en"))
        .map((key) => [key, sortJsonValue(value[key] as JsonValue)]),
    );
  }
  return value;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
