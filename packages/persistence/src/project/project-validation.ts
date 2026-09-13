import type { JsonObject, JsonValue } from "@folio/domain";
import { FolioProjectCodecError, type FolioProjectCodecErrorCode } from "./project-errors";

/**
 * Generous v1 safety ceilings: large professional sketches remain representable while a
 * malformed file cannot request unbounded allocation or recursive traversal.
 */
export const PROJECT_LIMITS = Object.freeze({
  inputBytes: 256 * 1024 * 1024,
  stringLength: 1024 * 1024,
  idLength: 512,
  titleLength: 1024,
  nameLength: 4096,
  pages: 4096,
  layersPerPage: 4096,
  objectsPerPage: 100_000,
  objectsPerProject: 250_000,
  pointsPerStroke: 1_000_000,
  sourceSamplesPerStroke: 1_000_000,
  inkSamplesPerProject: 10_000_000,
  jsonDepth: 64,
  jsonNodes: 1_000_000,
  jsonCollectionEntries: 250_000,
});

export interface ProjectResourceBudget {
  objectCount: number;
  inkSampleCount: number;
  jsonNodeCount: number;
}

export function createResourceBudget(): ProjectResourceBudget {
  return { objectCount: 0, inkSampleCount: 0, jsonNodeCount: 0 };
}

export function assertInputWithinLimits(input: unknown): asserts input is string {
  if (typeof input !== "string") {
    fail("INVALID_PROJECT", "$", "Encoded Folio project input must be a string.");
  }
  if (input.length > PROJECT_LIMITS.inputBytes) {
    resourceLimit("$", "Encoded Folio project exceeds the v1 input-size limit.", {
      characters: input.length,
      maximumBytes: PROJECT_LIMITS.inputBytes,
    });
  }
  const byteLength = new TextEncoder().encode(input).byteLength;
  if (byteLength > PROJECT_LIMITS.inputBytes) {
    resourceLimit("$", "Encoded Folio project exceeds the v1 input-size limit.", {
      byteLength,
      maximumBytes: PROJECT_LIMITS.inputBytes,
    });
  }
  assertJsonTextDepth(input);
}

/**
 * The whole-document budget an encoder must meet.
 *
 * It is deliberately the same structural check {@link assertInputWithinLimits}
 * applies on the way back in. Per-field validation is not enough on its own:
 * metadata nested legally within its own object still sits several levels down
 * inside the document that carries it, and a project Folio writes but cannot
 * read is worse than one it declines to write.
 */
export function assertEncodedOutputWithinLimits(output: string): void {
  const byteLength = new TextEncoder().encode(output).byteLength;
  if (byteLength > PROJECT_LIMITS.inputBytes) {
    resourceLimit("$", "Encoded Folio project exceeds the v1 output-size limit.", {
      byteLength,
      maximumBytes: PROJECT_LIMITS.inputBytes,
    });
  }
  assertJsonTextDepth(output);
}

export function expectRecord(
  value: unknown,
  path: string,
  code: FolioProjectCodecErrorCode,
  message = "Expected an object.",
): Record<string, unknown> {
  if (!isPlainRecord(value)) fail(code, path, message);
  return value;
}

export function expectArray(
  value: unknown,
  path: string,
  code: FolioProjectCodecErrorCode,
): readonly unknown[] {
  if (!Array.isArray(value)) fail(code, path, "Expected an array.");
  return value;
}

export function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  code: FolioProjectCodecErrorCode,
): void {
  const requiredKeys = new Set(required);
  const allowed = new Set([...required, ...optional]);
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      fail(code, propertyPath(path, key), `Required field '${key}' is missing.`);
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail(
        code,
        typeof key === "string" ? propertyPath(path, key) : path,
        `Unknown field '${String(key)}' is not allowed in Folio project v1.`,
      );
    }
  }
}

export function expectString(
  value: unknown,
  path: string,
  code: FolioProjectCodecErrorCode,
  options: Readonly<{ nonBlank?: boolean; maximumLength?: number }> = {},
): string {
  if (typeof value !== "string") fail(code, path, "Expected a string.");
  if (options.nonBlank === true && value.trim().length === 0) {
    fail(code, path, "Expected a non-blank string.");
  }
  const maximumLength = options.maximumLength ?? PROJECT_LIMITS.stringLength;
  if (value.length > maximumLength) {
    resourceLimit(path, "String exceeds the Folio project v1 length limit.", {
      length: value.length,
      maximumLength,
    });
  }
  return value;
}

export function expectId(value: unknown, path: string, code: FolioProjectCodecErrorCode): string {
  return expectString(value, path, code, {
    nonBlank: true,
    maximumLength: PROJECT_LIMITS.idLength,
  });
}

export function expectIsoTimestamp(
  value: unknown,
  path: string,
  code: FolioProjectCodecErrorCode,
): string {
  const timestamp = expectString(value, path, code, {
    nonBlank: true,
    maximumLength: 64,
  });
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== timestamp) {
    fail(code, path, "Expected a canonical ISO timestamp.");
  }
  return timestamp;
}

export function expectBoolean(
  value: unknown,
  path: string,
  code: FolioProjectCodecErrorCode,
): boolean {
  if (typeof value !== "boolean") fail(code, path, "Expected a boolean.");
  return value;
}

export function expectFiniteNumber(
  value: unknown,
  path: string,
  code: FolioProjectCodecErrorCode,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(code, path, "Expected a finite number.");
  }
  return value;
}

export function expectSafeInteger(
  value: unknown,
  path: string,
  code: FolioProjectCodecErrorCode,
): number {
  if (!Number.isSafeInteger(value)) fail(code, path, "Expected a safe integer.");
  return value as number;
}

export function assertMaximumCount(
  count: number,
  maximum: number,
  path: string,
  label: string,
): void {
  if (count > maximum) {
    resourceLimit(path, `${label} exceeds the Folio project v1 limit.`, { count, maximum });
  }
}

export function addObjectCount(budget: ProjectResourceBudget, count: number, path: string): void {
  budget.objectCount += count;
  assertMaximumCount(
    budget.objectCount,
    PROJECT_LIMITS.objectsPerProject,
    path,
    "Project object count",
  );
}

export function addInkSampleCount(
  budget: ProjectResourceBudget,
  count: number,
  path: string,
): void {
  budget.inkSampleCount += count;
  assertMaximumCount(
    budget.inkSampleCount,
    PROJECT_LIMITS.inkSamplesPerProject,
    path,
    "Project Ink sample count",
  );
}

export function expectJsonObject(
  value: unknown,
  path: string,
  code: FolioProjectCodecErrorCode,
  budget: ProjectResourceBudget,
): JsonObject {
  if (!isPlainRecord(value)) fail(code, path, "Expected a plain JSON object.");
  validateJsonValue(value, path, code, budget, 0, new WeakSet<object>());
  return value as JsonObject;
}

export function constructOrFail<T>(
  code: FolioProjectCodecErrorCode,
  path: string,
  message: string,
  construct: () => T,
): T {
  try {
    return construct();
  } catch (error) {
    if (error instanceof FolioProjectCodecError) throw error;
    const sourceCode =
      error !== null && typeof error === "object" && "code" in error
        ? (error as { readonly code?: unknown }).code
        : undefined;
    throw new FolioProjectCodecError(code, message, {
      path,
      cause: error,
      details: sourceCode === undefined ? {} : { sourceCode },
    });
  }
}

export function fail(
  code: FolioProjectCodecErrorCode,
  path: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new FolioProjectCodecError(code, message, { path, details });
}

export function propertyPath(parent: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/u.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function validateJsonValue(
  value: unknown,
  path: string,
  code: FolioProjectCodecErrorCode,
  budget: ProjectResourceBudget,
  depth: number,
  ancestors: WeakSet<object>,
): asserts value is JsonValue {
  budget.jsonNodeCount += 1;
  if (budget.jsonNodeCount > PROJECT_LIMITS.jsonNodes) {
    resourceLimit(path, "JSON metadata exceeds the Folio project v1 node limit.", {
      nodes: budget.jsonNodeCount,
      maximum: PROJECT_LIMITS.jsonNodes,
    });
  }
  if (depth > PROJECT_LIMITS.jsonDepth) {
    resourceLimit(path, "JSON metadata exceeds the Folio project v1 nesting limit.", {
      depth,
      maximum: PROJECT_LIMITS.jsonDepth,
    });
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    expectString(value, path, code);
    return;
  }
  if (typeof value === "number") {
    expectFiniteNumber(value, path, code);
    return;
  }
  if (typeof value !== "object") fail(code, path, "Metadata must contain JSON-safe values.");
  if (ancestors.has(value)) fail(code, path, "Metadata must not contain circular references.");
  ancestors.add(value);
  if (Array.isArray(value)) {
    assertMaximumCount(
      value.length,
      PROJECT_LIMITS.jsonCollectionEntries,
      path,
      "JSON array length",
    );
    value.forEach((item, index) =>
      validateJsonValue(item, `${path}[${index}]`, code, budget, depth + 1, ancestors),
    );
  } else {
    if (!isPlainRecord(value)) fail(code, path, "Metadata must contain plain JSON objects.");
    const keys = Reflect.ownKeys(value);
    assertMaximumCount(
      keys.length,
      PROJECT_LIMITS.jsonCollectionEntries,
      path,
      "JSON object field count",
    );
    for (const key of keys) {
      if (typeof key !== "string") fail(code, path, "Metadata keys must be strings.");
      expectString(key, path, code);
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        fail(code, propertyPath(path, key), "Prototype-sensitive metadata keys are not allowed.");
      }
      validateJsonValue(value[key], propertyPath(path, key), code, budget, depth + 1, ancestors);
    }
  }
  ancestors.delete(value);
}

function assertJsonTextDepth(input: string): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      if (depth > PROJECT_LIMITS.jsonDepth) {
        resourceLimit("$", "Encoded Folio project exceeds the v1 JSON nesting limit.", {
          depth,
          maximum: PROJECT_LIMITS.jsonDepth,
        });
      }
    } else if (character === "}" || character === "]") {
      depth = Math.max(0, depth - 1);
    }
  }
}

function resourceLimit(
  path: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
): never {
  fail("RESOURCE_LIMIT", path, message, details);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
