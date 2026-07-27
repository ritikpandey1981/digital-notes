import type { JsonObject } from "@folio/domain";
import { ObjectValidationError } from "./errors";
import { isPlainJsonObject } from "./internal/json";
import type {
  ObjectBounds,
  ObjectValidationIssue,
  ObjectValidationResult,
  PageObject,
} from "./types";

const SUPPORTED_TYPES = new Set(["ink"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addIssue(
  issues: ObjectValidationIssue[],
  path: string,
  code: ObjectValidationIssue["code"],
  message: string,
): void {
  issues.push(Object.freeze({ path, code, message }));
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function collectBounds(value: unknown, path: string, issues: ObjectValidationIssue[]): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_bounds", "Object bounds must be an object.");
    return;
  }
  const finite = [value.x, value.y, value.width, value.height].every(
    (item) => typeof item === "number" && Number.isFinite(item),
  );
  if (!finite || (value.width as number) < 0 || (value.height as number) < 0) {
    addIssue(
      issues,
      path,
      "invalid_bounds",
      "Bounds require finite coordinates and non-negative dimensions.",
    );
  }
}

function collectMetadata(value: unknown, path: string, issues: ObjectValidationIssue[]): void {
  if (!isPlainJsonObject(value)) {
    addIssue(issues, path, "invalid_metadata", "Metadata must be a plain JSON-safe object.");
  }
}

function collectTransform(value: unknown, path: string, issues: ObjectValidationIssue[]): void {
  if (!isRecord(value) || !isRecord(value.translation)) {
    addIssue(issues, path, "invalid_transform", "Transform must contain translation data.");
    return;
  }
  const identity =
    value.translation.x === 0 &&
    value.translation.y === 0 &&
    value.rotation === 0 &&
    value.scale === 1;
  if (!identity) {
    addIssue(
      issues,
      path,
      "invalid_transform",
      "Phase 8 objects require translation 0, rotation 0, and scale 1.",
    );
  }
}

function collectStroke(value: unknown, path: string, issues: ObjectValidationIssue[]): void {
  if (!isRecord(value)) {
    addIssue(issues, path, "invalid_stroke", "InkObject requires an immutable Stroke.");
    return;
  }
  const points = value.points;
  const statistics = value.statistics;
  const valid =
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    Array.isArray(points) &&
    points.length > 0 &&
    isRecord(value.metrics) &&
    isRecord(value.style) &&
    isRecord(statistics) &&
    statistics.pointCount === points.length &&
    Object.isFrozen(value) &&
    Object.isFrozen(points) &&
    points.every((point) => Object.isFrozen(point)) &&
    Object.isFrozen(value.metrics) &&
    Object.isFrozen(value.style) &&
    Object.isFrozen(statistics);
  if (!valid) {
    addIssue(
      issues,
      path,
      "invalid_stroke",
      "InkObject must reference one finalized immutable Stroke.",
    );
  }
}

export function validateObject(value: unknown): ObjectValidationResult {
  const issues: ObjectValidationIssue[] = [];
  if (!isRecord(value)) {
    addIssue(issues, "$", "invalid_type", "PageObject must be an object.");
    return Object.freeze({ valid: false, issues: Object.freeze(issues) });
  }

  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    addIssue(issues, "$.id", "invalid_value", "Object id must not be empty.");
  }
  if (typeof value.type !== "string" || !SUPPORTED_TYPES.has(value.type)) {
    addIssue(issues, "$.type", "unknown_type", "Only InkObject is supported in Phase 8.");
  }
  if (value.version !== 1) {
    addIssue(issues, "$.version", "invalid_version", "Object version must be 1.");
  }
  if (!isIsoTimestamp(value.createdAt)) {
    addIssue(issues, "$.createdAt", "invalid_timestamp", "createdAt must be an ISO timestamp.");
  }
  if (!isIsoTimestamp(value.modifiedAt)) {
    addIssue(issues, "$.modifiedAt", "invalid_timestamp", "modifiedAt must be an ISO timestamp.");
  }
  if (
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.modifiedAt) &&
    value.modifiedAt < value.createdAt
  ) {
    addIssue(issues, "$.modifiedAt", "invalid_timestamp", "modifiedAt cannot precede createdAt.");
  }
  collectBounds(value.bounds, "$.bounds", issues);
  if (typeof value.visible !== "boolean") {
    addIssue(issues, "$.visible", "invalid_type", "visible must be boolean.");
  }
  if (typeof value.locked !== "boolean") {
    addIssue(issues, "$.locked", "invalid_type", "locked must be boolean.");
  }
  collectMetadata(value.metadata, "$.metadata", issues);
  if (!Number.isSafeInteger(value.zIndex) || (value.zIndex as number) < 0) {
    addIssue(issues, "$.zIndex", "invalid_value", "zIndex must be a non-negative integer.");
  }
  collectTransform(value.transform, "$.transform", issues);
  if (value.type === "ink") {
    collectStroke(value.stroke, "$.stroke", issues);
    collectMetadata(value.renderingHints, "$.renderingHints", issues);
  }
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
}

export function assertValidObject(value: unknown): asserts value is PageObject {
  const result = validateObject(value);
  if (!result.valid) throw new ObjectValidationError(result.issues);
}

export function validateObjectCollection(values: readonly unknown[]): ObjectValidationResult {
  const issues: ObjectValidationIssue[] = [];
  const ids = new Set<string>();
  values.forEach((value, index) => {
    const result = validateObject(value);
    for (const issue of result.issues) {
      issues.push(
        Object.freeze({
          ...issue,
          path: `$[${index}]${issue.path === "$" ? "" : issue.path.slice(1)}`,
        }),
      );
    }
    if (isRecord(value) && typeof value.id === "string") {
      if (ids.has(value.id)) {
        addIssue(issues, `$[${index}].id`, "duplicate_id", `Duplicate object id: ${value.id}`);
      }
      ids.add(value.id);
    }
  });
  return Object.freeze({ valid: issues.length === 0, issues: Object.freeze(issues) });
}

export function assertValidObjectCollection(
  values: readonly unknown[],
): asserts values is readonly PageObject[] {
  const result = validateObjectCollection(values);
  if (!result.valid) throw new ObjectValidationError(result.issues);
}

export function isPageObject(value: unknown): value is PageObject {
  return validateObject(value).valid;
}

export function isObjectMetadata(value: unknown): value is JsonObject {
  return isPlainJsonObject(value);
}

export function isObjectBounds(value: unknown): value is ObjectBounds {
  const issues: ObjectValidationIssue[] = [];
  collectBounds(value, "$", issues);
  return issues.length === 0;
}
