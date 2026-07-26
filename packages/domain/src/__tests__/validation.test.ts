import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  assertValidNotebook,
  createAsset,
  createPage,
  createPageObject,
  createSection,
  isJsonSerializable,
  isNotebook,
  validateAsset,
  validateNotebook,
  validatePage,
  validatePageObject,
  validateSection,
} from "../index";
import { buildNotebook, TEST_TIMESTAMP } from "./fixtures";

describe("domain validation", () => {
  it("validates each standalone model", () => {
    const notebook = buildNotebook();
    const section = notebook.sections[0];
    const page = section?.pages[0];
    const object = page?.objects[0];
    const asset = notebook.assets[0];

    expect(validateNotebook(notebook).valid).toBe(true);
    expect(validateSection(section).valid).toBe(true);
    expect(validatePage(page).valid).toBe(true);
    expect(validatePageObject(object).valid).toBe(true);
    expect(validateAsset(asset).valid).toBe(true);
  });

  it("reports missing required notebook properties", () => {
    const validation = validateNotebook({ id: "only-an-id" });

    expect(validation.valid).toBe(false);
    expect(
      validation.issues.some(({ path, code }) => path === "$.name" && code === "invalid_type"),
    ).toBe(true);
    expect(validation.issues.some(({ path }) => path === "$.sections")).toBe(true);
  });

  it("enforces globally unique identifiers", () => {
    const notebook = buildNotebook();
    const invalid = {
      ...notebook,
      assets: [{ ...notebook.assets[0], id: "page-1" }],
      cover: null,
    };
    const validation = validateNotebook(invalid);

    expect(validation.issues).toContainEqual(
      expect.objectContaining({ path: "$.assets[0].id", code: "duplicate_id" }),
    );
  });

  it("rejects an unknown page-object type", () => {
    const object = { ...buildNotebook().sections[0]?.pages[0]?.objects[0], type: "unknown" };
    expect(validatePageObject(object).issues).toContainEqual(
      expect.objectContaining({ path: "$.type", code: "invalid_value" }),
    );
  });

  it("requires rendering and serialization capabilities", () => {
    const object = { ...buildNotebook().sections[0]?.pages[0]?.objects[0], capabilities: {} };
    const validation = validatePageObject(object);

    expect(validation.issues.map(({ path }) => path)).toContain("$.capabilities.renderable");
    expect(validation.issues.map(({ path }) => path)).toContain("$.capabilities.serializable");
  });

  it("rejects unknown and disabled capability values", () => {
    const source = buildNotebook().sections[0]?.pages[0]?.objects[0];
    const object = {
      ...source,
      capabilities: { ...source?.capabilities, selectable: false, magical: true },
    };
    const validation = validatePageObject(object);

    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.capabilities.selectable", code: "invalid_value" }),
        expect.objectContaining({ path: "$.capabilities.magical", code: "invalid_value" }),
      ]),
    );
  });

  it("rejects locked objects without Lockable capability", () => {
    const source = buildNotebook().sections[0]?.pages[0]?.objects[0];
    const object = {
      ...source,
      locked: true,
      capabilities: { renderable: true, serializable: true },
    };
    expect(validatePageObject(object).issues).toContainEqual(
      expect.objectContaining({ path: "$.locked", code: "invalid_value" }),
    );
  });

  it.each([
    ["non-finite position", { position: { x: Number.NaN, y: 0 } }],
    ["non-finite rotation", { rotation: Number.POSITIVE_INFINITY }],
    ["non-boolean visibility", { visible: "yes" }],
  ])("rejects %s", (_label, patch) => {
    const source = buildNotebook().sections[0]?.pages[0]?.objects[0];
    expect(validatePageObject({ ...source, ...patch }).valid).toBe(false);
  });

  it("validates page dimensions, backgrounds, and chronology", () => {
    const page = {
      ...buildNotebook().sections[0]?.pages[0],
      width: -1,
      background: { type: "grid", color: "#fff", lineColor: "#ddd", spacing: 0 },
      createdAt: "2026-07-27T02:00:00.000Z",
      updatedAt: TEST_TIMESTAMP,
    };
    const paths = validatePage(page).issues.map(({ path }) => path);

    expect(paths).toContain("$.width");
    expect(paths).toContain("$.background.spacing");
    expect(paths).toContain("$.updatedAt");
  });

  it("detects duplicate object identifiers within a page", () => {
    const source = buildNotebook().sections[0]?.pages[0];
    const page = { ...source, objects: [source?.objects[0], source?.objects[0]] };
    expect(validatePage(page).issues).toContainEqual(
      expect.objectContaining({ path: "$.objects[1].id", code: "duplicate_id" }),
    );
  });

  it("detects duplicate page identifiers within a section", () => {
    const source = buildNotebook().sections[0];
    const section = { ...source, pages: [source?.pages[0], source?.pages[0]] };
    expect(validateSection(section).issues).toContainEqual(
      expect.objectContaining({ path: "$.pages[1].id", code: "duplicate_id" }),
    );
  });

  it("rejects a cover reference to a missing asset", () => {
    const validation = validateNotebook({
      ...buildNotebook(),
      cover: { kind: "asset", assetId: "missing" },
    });
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ path: "$.cover.assetId", code: "invalid_reference" }),
    );
  });

  it.each([
    ["invalid kind", { kind: "document" }],
    ["blank media type", { mediaType: " " }],
    ["fractional byte length", { byteLength: 1.5 }],
    ["invalid timestamp", { createdAt: "not-a-date" }],
  ])("rejects asset metadata with %s", (_label, patch) => {
    const source = buildNotebook().assets[0];
    expect(validateAsset({ ...source, ...patch }).valid).toBe(false);
  });

  it("accepts JSON values and rejects unsupported or cyclic settings", () => {
    expect(isJsonSerializable({ text: "hello", value: 3, nested: [true, null] })).toBe(true);
    expect(isJsonSerializable({ value: Number.NaN })).toBe(false);
    expect(isJsonSerializable({ value: undefined })).toBe(false);
    expect(isJsonSerializable(new Date())).toBe(false);

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(isJsonSerializable(cyclic)).toBe(false);
  });

  it("exposes assertion and type-guard APIs", () => {
    const notebook: unknown = buildNotebook();
    expect(isNotebook(notebook)).toBe(true);
    expect(() => assertValidNotebook(notebook)).not.toThrow();
    expect(() => assertValidNotebook({})).toThrowError(DomainValidationError);
  });

  it("allows valid models to be created without an application runtime", () => {
    const object = createPageObject({ id: "object", type: "rich-text" });
    const page = createPage({ id: "page", width: 100, height: 140, objects: [object] });
    const section = createSection({ id: "section", title: "Unit Test", pages: [page] });
    const asset = createAsset({
      id: "asset",
      kind: "image",
      fileName: "photo.jpg",
      mediaType: "image/jpeg",
      byteLength: 1,
    });

    expect(section.pages[0]).toBeDefined();
    expect(asset.id).toBe("asset");
  });
});
