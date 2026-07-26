import { PAGE_OBJECT_CAPABILITY_NAMES } from "./capabilities";
import { DomainValidationError } from "./errors";
import type { ValidationIssue, ValidationResult } from "./errors";
import { ASSET_KINDS, PAGE_OBJECT_TYPES } from "./models";
import type { Asset, Notebook, Page, PageObject, Section } from "./models";

type RecordValue = Record<string, unknown>;

const capabilityNames = new Set<string>(PAGE_OBJECT_CAPABILITY_NAMES);
const objectTypes = new Set<string>(PAGE_OBJECT_TYPES);
const assetKinds = new Set<string>(ASSET_KINDS);

function issue(
  issues: ValidationIssue[],
  path: string,
  code: ValidationIssue["code"],
  message: string,
): void {
  issues.push({ path, code, message });
}

function result(issues: ValidationIssue[]): ValidationResult {
  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(issues),
  });
}

function isRecord(value: unknown): value is RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function collectRecord(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): value is RecordValue {
  if (!isRecord(value)) {
    issue(issues, path, "invalid_type", "Expected an object.");
    return false;
  }
  return true;
}

function collectNonBlankString(value: unknown, path: string, issues: ValidationIssue[]): boolean {
  if (typeof value !== "string") {
    issue(issues, path, "invalid_type", "Expected a string.");
    return false;
  }
  if (value.trim().length === 0) {
    issue(issues, path, "required", "Value must not be blank.");
    return false;
  }
  return true;
}

function collectFiniteNumber(value: unknown, path: string, issues: ValidationIssue[]): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issue(issues, path, "invalid_type", "Expected a finite number.");
    return false;
  }
  return true;
}

function collectTimestamp(value: unknown, path: string, issues: ValidationIssue[]): boolean {
  if (!collectNonBlankString(value, path, issues)) return false;
  if (!Number.isFinite(Date.parse(value as string))) {
    issue(issues, path, "invalid_value", "Expected a valid ISO-compatible timestamp.");
    return false;
  }
  return true;
}

function collectChronology(
  createdAt: unknown,
  updatedAt: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (
    typeof createdAt === "string" &&
    typeof updatedAt === "string" &&
    Number.isFinite(Date.parse(createdAt)) &&
    Number.isFinite(Date.parse(updatedAt)) &&
    Date.parse(updatedAt) < Date.parse(createdAt)
  ) {
    issue(issues, `${path}.updatedAt`, "invalid_value", "updatedAt cannot precede createdAt.");
  }
}

function collectNullableString(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value !== null) collectNonBlankString(value, path, issues);
}

function collectPosition(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!collectRecord(value, path, issues)) return;
  collectFiniteNumber(value.x, `${path}.x`, issues);
  collectFiniteNumber(value.y, `${path}.y`, issues);
}

function collectCapabilities(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!collectRecord(value, path, issues)) return;

  Object.entries(value).forEach(([name, enabled]) => {
    if (!capabilityNames.has(name)) {
      issue(issues, `${path}.${name}`, "invalid_value", `Unknown capability '${name}'.`);
    } else if (enabled !== true) {
      issue(
        issues,
        `${path}.${name}`,
        "invalid_value",
        "Capabilities must be represented by true.",
      );
    }
  });

  if (value.serializable !== true) {
    issue(issues, `${path}.serializable`, "required", "Page objects must be serializable.");
  }
  if (value.renderable !== true) {
    issue(issues, `${path}.renderable`, "required", "Page objects must be renderable.");
  }
}

function collectPageObject(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!collectRecord(value, path, issues)) return;
  collectNonBlankString(value.id, `${path}.id`, issues);
  if (!collectNonBlankString(value.type, `${path}.type`, issues)) return;
  if (!objectTypes.has(value.type as string)) {
    issue(issues, `${path}.type`, "invalid_value", `Unknown page object type '${value.type}'.`);
  }
  collectPosition(value.position, `${path}.position`, issues);
  collectFiniteNumber(value.rotation, `${path}.rotation`, issues);
  if (typeof value.locked !== "boolean") {
    issue(issues, `${path}.locked`, "invalid_type", "Expected a boolean.");
  }
  if (typeof value.visible !== "boolean") {
    issue(issues, `${path}.visible`, "invalid_type", "Expected a boolean.");
  }
  collectCapabilities(value.capabilities, `${path}.capabilities`, issues);
  if (
    value.locked === true &&
    isRecord(value.capabilities) &&
    value.capabilities.lockable !== true
  ) {
    issue(
      issues,
      `${path}.locked`,
      "invalid_value",
      "A locked object requires Lockable capability.",
    );
  }
}

function collectPageBackground(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!collectRecord(value, path, issues)) return;
  if (value.type !== "plain" && value.type !== "grid" && value.type !== "ruled") {
    issue(issues, `${path}.type`, "invalid_value", "Expected plain, grid, or ruled background.");
    return;
  }
  collectNonBlankString(value.color, `${path}.color`, issues);
  if (value.type !== "plain") {
    collectNonBlankString(value.lineColor, `${path}.lineColor`, issues);
    if (
      collectFiniteNumber(value.spacing, `${path}.spacing`, issues) &&
      (value.spacing as number) <= 0
    ) {
      issue(issues, `${path}.spacing`, "invalid_value", "Pattern spacing must be positive.");
    }
  }
}

function collectPage(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!collectRecord(value, path, issues)) return;
  collectNonBlankString(value.id, `${path}.id`, issues);
  if (collectFiniteNumber(value.width, `${path}.width`, issues) && (value.width as number) <= 0) {
    issue(issues, `${path}.width`, "invalid_value", "Page width must be positive.");
  }
  if (
    collectFiniteNumber(value.height, `${path}.height`, issues) &&
    (value.height as number) <= 0
  ) {
    issue(issues, `${path}.height`, "invalid_value", "Page height must be positive.");
  }
  collectPageBackground(value.background, `${path}.background`, issues);
  collectTimestamp(value.createdAt, `${path}.createdAt`, issues);
  collectTimestamp(value.updatedAt, `${path}.updatedAt`, issues);
  collectChronology(value.createdAt, value.updatedAt, path, issues);

  if (!Array.isArray(value.objects)) {
    issue(issues, `${path}.objects`, "invalid_type", "Expected an array.");
    return;
  }

  const objectIds = new Set<string>();
  value.objects.forEach((object, index) => {
    const objectPath = `${path}.objects[${index}]`;
    collectPageObject(object, objectPath, issues);
    if (isRecord(object) && typeof object.id === "string") {
      if (objectIds.has(object.id)) {
        issue(issues, `${objectPath}.id`, "duplicate_id", `Duplicate object id '${object.id}'.`);
      }
      objectIds.add(object.id);
    }
  });
}

function collectSection(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!collectRecord(value, path, issues)) return;
  collectNonBlankString(value.id, `${path}.id`, issues);
  collectNonBlankString(value.title, `${path}.title`, issues);
  collectNullableString(value.color, `${path}.color`, issues);
  collectNullableString(value.icon, `${path}.icon`, issues);

  if (!Array.isArray(value.pages)) {
    issue(issues, `${path}.pages`, "invalid_type", "Expected an array.");
    return;
  }

  const pageIds = new Set<string>();
  value.pages.forEach((page, index) => {
    const pagePath = `${path}.pages[${index}]`;
    collectPage(page, pagePath, issues);
    if (isRecord(page) && typeof page.id === "string") {
      if (pageIds.has(page.id)) {
        issue(issues, `${pagePath}.id`, "duplicate_id", `Duplicate page id '${page.id}'.`);
      }
      pageIds.add(page.id);
    }
  });
}

function collectAsset(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!collectRecord(value, path, issues)) return;
  collectNonBlankString(value.id, `${path}.id`, issues);
  if (
    collectNonBlankString(value.kind, `${path}.kind`, issues) &&
    !assetKinds.has(value.kind as string)
  ) {
    issue(issues, `${path}.kind`, "invalid_value", `Unknown asset kind '${value.kind}'.`);
  }
  collectNonBlankString(value.fileName, `${path}.fileName`, issues);
  collectNonBlankString(value.mediaType, `${path}.mediaType`, issues);
  if (
    collectFiniteNumber(value.byteLength, `${path}.byteLength`, issues) &&
    (!Number.isSafeInteger(value.byteLength) || (value.byteLength as number) < 0)
  ) {
    issue(
      issues,
      `${path}.byteLength`,
      "invalid_value",
      "byteLength must be a non-negative safe integer.",
    );
  }
  collectTimestamp(value.createdAt, `${path}.createdAt`, issues);
}

function collectCover(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (value === null) return;
  if (!collectRecord(value, path, issues)) return;
  if (value.kind === "color") {
    collectNonBlankString(value.value, `${path}.value`, issues);
    return;
  }
  if (value.kind === "asset") {
    collectNonBlankString(value.assetId, `${path}.assetId`, issues);
    return;
  }
  issue(issues, `${path}.kind`, "invalid_value", "Expected a color or asset cover.");
}

export function isJsonSerializable(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  const serializable = Array.isArray(value)
    ? value.every((item) => isJsonSerializable(item, ancestors))
    : isRecord(value) && Object.values(value).every((item) => isJsonSerializable(item, ancestors));
  ancestors.delete(value);
  return serializable;
}

function collectNotebook(value: unknown, path: string, issues: ValidationIssue[]): void {
  if (!collectRecord(value, path, issues)) return;
  collectNonBlankString(value.id, `${path}.id`, issues);
  collectNonBlankString(value.name, `${path}.name`, issues);
  collectTimestamp(value.createdAt, `${path}.createdAt`, issues);
  collectTimestamp(value.updatedAt, `${path}.updatedAt`, issues);
  collectChronology(value.createdAt, value.updatedAt, path, issues);
  collectCover(value.cover, `${path}.cover`, issues);
  collectNonBlankString(value.theme, `${path}.theme`, issues);

  if (!isJsonSerializable(value.settings)) {
    issue(
      issues,
      `${path}.settings`,
      "not_serializable",
      "Settings must contain JSON-safe values.",
    );
  } else if (!isRecord(value.settings)) {
    issue(issues, `${path}.settings`, "invalid_type", "Expected an object.");
  }

  if (!Array.isArray(value.sections)) {
    issue(issues, `${path}.sections`, "invalid_type", "Expected an array.");
  } else {
    value.sections.forEach((section, index) =>
      collectSection(section, `${path}.sections[${index}]`, issues),
    );
  }

  if (!Array.isArray(value.assets)) {
    issue(issues, `${path}.assets`, "invalid_type", "Expected an array.");
  } else {
    value.assets.forEach((asset, index) => collectAsset(asset, `${path}.assets[${index}]`, issues));
  }

  const identifiers = new Map<string, string>();
  const registerId = (id: unknown, idPath: string) => {
    if (typeof id !== "string" || id.trim().length === 0) return;
    const existingPath = identifiers.get(id);
    if (existingPath) {
      issue(issues, idPath, "duplicate_id", `Id '${id}' is already used at ${existingPath}.`);
    } else {
      identifiers.set(id, idPath);
    }
  };

  registerId(value.id, `${path}.id`);
  if (Array.isArray(value.sections)) {
    value.sections.forEach((section, sectionIndex) => {
      if (!isRecord(section)) return;
      const sectionPath = `${path}.sections[${sectionIndex}]`;
      registerId(section.id, `${sectionPath}.id`);
      if (!Array.isArray(section.pages)) return;
      section.pages.forEach((page, pageIndex) => {
        if (!isRecord(page)) return;
        const pagePath = `${sectionPath}.pages[${pageIndex}]`;
        registerId(page.id, `${pagePath}.id`);
        if (!Array.isArray(page.objects)) return;
        page.objects.forEach((object, objectIndex) => {
          if (isRecord(object)) {
            registerId(object.id, `${pagePath}.objects[${objectIndex}].id`);
          }
        });
      });
    });
  }

  const assetIds = new Set<string>();
  if (Array.isArray(value.assets)) {
    value.assets.forEach((asset, assetIndex) => {
      if (!isRecord(asset)) return;
      registerId(asset.id, `${path}.assets[${assetIndex}].id`);
      if (typeof asset.id === "string") assetIds.add(asset.id);
    });
  }

  if (
    isRecord(value.cover) &&
    value.cover.kind === "asset" &&
    typeof value.cover.assetId === "string" &&
    !assetIds.has(value.cover.assetId)
  ) {
    issue(
      issues,
      `${path}.cover.assetId`,
      "invalid_reference",
      `Cover references missing asset '${value.cover.assetId}'.`,
    );
  }
}

export function validatePageObject(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  collectPageObject(value, "$", issues);
  return result(issues);
}

export function validatePage(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  collectPage(value, "$", issues);
  return result(issues);
}

export function validateSection(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  collectSection(value, "$", issues);
  return result(issues);
}

export function validateAsset(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  collectAsset(value, "$", issues);
  return result(issues);
}

export function validateNotebook(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  collectNotebook(value, "$", issues);
  return result(issues);
}

function assertResult<T>(value: unknown, validation: ValidationResult): asserts value is T {
  if (!validation.valid) throw new DomainValidationError(validation.issues);
}

export function assertValidPageObject(value: unknown): asserts value is PageObject {
  assertResult<PageObject>(value, validatePageObject(value));
}

export function assertValidPage(value: unknown): asserts value is Page {
  assertResult<Page>(value, validatePage(value));
}

export function assertValidSection(value: unknown): asserts value is Section {
  assertResult<Section>(value, validateSection(value));
}

export function assertValidAsset(value: unknown): asserts value is Asset {
  assertResult<Asset>(value, validateAsset(value));
}

export function assertValidNotebook(value: unknown): asserts value is Notebook {
  assertResult<Notebook>(value, validateNotebook(value));
}

export function isNotebook(value: unknown): value is Notebook {
  return validateNotebook(value).valid;
}
