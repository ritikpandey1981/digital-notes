import { describe, expect, it } from "vitest";
import {
  DomainValidationError,
  createAsset,
  createNotebook,
  createPage,
  createPageObject,
  createSection,
  duplicatePage,
  validateNotebook,
} from "../index";
import type { JsonObject, NotebookSettings } from "../index";
import { buildNotebook, deterministicContext, TEST_TIMESTAMP } from "./fixtures";

describe("domain factories", () => {
  it("creates an empty notebook with deterministic defaults", () => {
    const notebook = createNotebook({ name: "Field Notes" }, deterministicContext());

    expect(notebook).toEqual({
      id: "generated-1",
      name: "Field Notes",
      createdAt: TEST_TIMESTAMP,
      updatedAt: TEST_TIMESTAMP,
      cover: null,
      theme: "default",
      sections: [],
      assets: [],
      settings: {},
    });
  });

  it("creates sections with serializable optional metadata", () => {
    const section = createSection(
      { title: "Research", color: "#0f766e", icon: "flask" },
      deterministicContext(),
    );

    expect(section).toMatchObject({
      id: "generated-1",
      title: "Research",
      color: "#0f766e",
      icon: "flask",
      pages: [],
    });
  });

  it("creates fixed-size pages with a plain default background", () => {
    const page = createPage({ width: 210, height: 297 }, deterministicContext());

    expect(page.background).toEqual({ type: "plain", color: "#ffffff" });
    expect(page.objects).toEqual([]);
    expect(page.createdAt).toBe(TEST_TIMESTAMP);
    expect(page.updatedAt).toBe(TEST_TIMESTAMP);
  });

  it("composes required and optional page-object capabilities", () => {
    const object = createPageObject(
      {
        type: "image",
        capabilities: { selectable: true, resizable: true, rotatable: true },
      },
      deterministicContext(),
    );

    expect(object.capabilities).toEqual({
      renderable: true,
      serializable: true,
      selectable: true,
      resizable: true,
      rotatable: true,
    });
    expect(object.position).toEqual({ x: 0, y: 0 });
    expect(object).toMatchObject({ rotation: 0, locked: false, visible: true });
  });

  it("requires Lockable capability for an initially locked object", () => {
    expect(() =>
      createPageObject({ type: "rectangle", locked: true }, deterministicContext()),
    ).toThrowError(DomainValidationError);
  });

  it("creates asset metadata without file-system or binary values", () => {
    const asset = createAsset(
      {
        kind: "attachment",
        fileName: "brief.pdf",
        mediaType: "application/pdf",
        byteLength: 4096,
      },
      deterministicContext(),
    );

    expect(asset).toEqual({
      id: "generated-1",
      kind: "attachment",
      fileName: "brief.pdf",
      mediaType: "application/pdf",
      byteLength: 4096,
      createdAt: TEST_TIMESTAMP,
    });
  });

  it("duplicates a page with fresh page and object identifiers", () => {
    const source = buildNotebook().sections[0]?.pages[0];
    expect(source).toBeDefined();

    const duplicate = duplicatePage(source!, {}, deterministicContext("copy"));

    expect(duplicate.id).toBe("copy-2");
    expect(duplicate.objects[0]?.id).toBe("copy-1");
    expect(duplicate.objects[0]).toMatchObject({ type: "rectangle", position: { x: 12, y: 24 } });
    expect(duplicate.createdAt).toBe(TEST_TIMESTAMP);
  });

  it("returns deeply frozen models detached from mutable factory input", () => {
    const settings: Record<string, unknown> = { nested: { enabled: true } };
    const notebook = createNotebook(
      { name: "Frozen", settings: settings as NotebookSettings },
      deterministicContext(),
    );

    (settings.nested as { enabled: boolean }).enabled = false;
    expect(notebook.settings).toEqual({ nested: { enabled: true } });
    expect(Object.isFrozen(notebook)).toBe(true);
    expect(Object.isFrozen(notebook.settings)).toBe(true);
    expect(Object.isFrozen(notebook.sections)).toBe(true);
  });

  it("round-trips a complete notebook through JSON", () => {
    const notebook = buildNotebook();
    const roundTrip: unknown = JSON.parse(JSON.stringify(notebook));

    expect(roundTrip).toEqual(notebook);
    expect(validateNotebook(roundTrip).valid).toBe(true);
  });

  it.each([
    ["blank notebook name", () => createNotebook({ name: " " }, deterministicContext())],
    ["zero page width", () => createPage({ width: 0, height: 297 }, deterministicContext())],
    [
      "negative asset size",
      () =>
        createAsset(
          { kind: "image", fileName: "x.png", mediaType: "image/png", byteLength: -1 },
          deterministicContext(),
        ),
    ],
  ])("rejects %s", (_label, createInvalidModel) => {
    expect(createInvalidModel).toThrowError(DomainValidationError);
  });

  it("rejects non-JSON notebook settings", () => {
    const settings = { invalid: undefined } as unknown as JsonObject;
    expect(() =>
      createNotebook({ name: "Invalid", settings }, deterministicContext()),
    ).toThrowError(DomainValidationError);
  });
});
