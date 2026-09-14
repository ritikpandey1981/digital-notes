import { InkObject } from "@folio/document";
import { supportedBrushStrategies } from "@folio/ink";
import { describe, expect, it } from "vitest";
import {
  FolioProjectCodecError,
  decodeFolioProject,
  encodeFolioProject,
  type FolioProjectSnapshot,
} from "@folio/persistence/project";
import { createRepresentativeProject } from "./project-fixture";

/**
 * A project names its render strategy durably, so decoding is where a build
 * decides whether it can honour what a file asks for. Refusing by name is the
 * point: substituting a strategy this build does happen to have would open the
 * project while silently drawing somebody's artwork differently.
 */

function encodedRecord(project: FolioProjectSnapshot): Record<string, unknown> {
  return JSON.parse(encodeFolioProject(project)) as Record<string, unknown>;
}

function withInkRenderer(
  project: FolioProjectSnapshot,
  renderer: unknown,
): Record<string, unknown> {
  const record = encodedRecord(project);
  const pages = (record.sketchbook as { pages: Record<string, unknown>[] }).pages;
  const objects = (pages[0]!.content as { objects: Record<string, unknown>[] }).objects;
  const ink = objects.find((object) => object.type === "ink");
  if (ink === undefined) throw new Error("The fixture must contain an Ink object.");
  const payload = ink.payload as { stroke: { brush: Record<string, unknown> } };
  payload.stroke.brush.renderer = renderer;
  return record;
}

function expectRefusal(renderer: unknown): FolioProjectCodecError {
  const encoded = JSON.stringify(withInkRenderer(createRepresentativeProject(), renderer));
  try {
    decodeFolioProject(encoded);
  } catch (error) {
    expect(error).toBeInstanceOf(FolioProjectCodecError);
    return error as FolioProjectCodecError;
  }
  throw new Error("Decoding an unsupported render strategy must fail.");
}

describe("durable brush strategy decoding", () => {
  it("round-trips both frozen legacy strategies unchanged", () => {
    const original = createRepresentativeProject();
    const decoded = decodeFolioProject(encodeFolioProject(original));
    const strategies = inkStrategies(decoded);

    expect(strategies.length).toBeGreaterThan(0);
    for (const strategy of strategies) {
      expect(supportedBrushStrategies()).toContain(`${strategy.kind}@${strategy.version}`);
    }
    expect(encodeFolioProject(decoded)).toBe(encodeFolioProject(original));
  });

  it("round-trips a Technical Pen stroke with its strategy and dynamics intact", () => {
    const project = createRepresentativeProject();
    const record = encodedRecord(project);
    const pages = (record.sketchbook as { pages: Record<string, unknown>[] }).pages;
    const objects = (pages[0]!.content as { objects: Record<string, unknown>[] }).objects;
    const ink = objects.find((object) => object.type === "ink")!;
    const brush = (ink.payload as { stroke: { brush: Record<string, unknown> } }).stroke.brush;
    brush.renderer = { version: 1, kind: "technical-pen" };
    brush.presetId = "pen-technical";
    brush.size = 1.5;
    brush.opacity = 1;
    brush.smoothing = { mode: "average", amount: 0.3 };
    brush.dynamics = {
      pressureSize: {
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: { kind: "linear", exponent: 1 },
      },
      pressureOpacity: {
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: { kind: "linear", exponent: 1 },
      },
    };

    const encoded = JSON.stringify(record);
    const decoded = decodeFolioProject(encoded);
    const stroke = inkStrokes(decoded)[0]!;

    expect(stroke.brush.renderer).toEqual({ version: 1, kind: "technical-pen" });
    expect(stroke.brush.presetId).toBe("pen-technical");
    expect(stroke.brush.size).toBe(1.5);
    expect(stroke.brush.opacity).toBe(1);
    expect(stroke.brush.smoothing).toEqual({ mode: "average", amount: 0.3 });
    expect(stroke.brush.dynamics.pressureSize.enabled).toBe(false);
    // Ignoring pressure for appearance is not the same as discarding it.
    expect(stroke.sourceSamples.length).toBeGreaterThan(0);
    expect(stroke.sourceSamples.some((entry) => entry.pressure !== 0.5)).toBe(true);
    // Encode, decode, encode: the second pass must reproduce the first exactly.
    const reencoded = encodeFolioProject(decoded);
    expect(encodeFolioProject(decodeFolioProject(reencoded))).toBe(reencoded);
    expect(reencoded).toContain('"kind": "technical-pen"');
  });

  it("round-trips a Pressure Pen stroke with both responses intact", () => {
    const record = encodedRecord(createRepresentativeProject());
    const brush = inkBrush(record);
    brush.renderer = { version: 1, kind: "pressure-pen" };
    brush.presetId = "pen-brush";
    brush.size = 6;
    brush.opacity = 1;
    brush.smoothing = { mode: "average", amount: 0.18 };
    brush.dynamics = {
      pressureSize: {
        enabled: true,
        minimumFactor: 0.35,
        maximumFactor: 1.65,
        curve: { kind: "linear", exponent: 1 },
      },
      pressureOpacity: {
        enabled: true,
        minimumFactor: 0.7,
        maximumFactor: 1,
        curve: { kind: "power", exponent: 0.55 },
      },
    };

    const decoded = decodeFolioProject(JSON.stringify(record));
    const stroke = inkStrokes(decoded)[0]!;

    expect(stroke.brush.renderer).toEqual({ version: 1, kind: "pressure-pen" });
    expect(stroke.brush.presetId).toBe("pen-brush");
    expect(stroke.brush.dynamics.pressureSize).toEqual({
      enabled: true,
      minimumFactor: 0.35,
      maximumFactor: 1.65,
      curve: { kind: "linear", exponent: 1 },
    });
    // The response the model has always carried and never evaluated, now
    // read back exactly as written -- including a non-linear curve.
    expect(stroke.brush.dynamics.pressureOpacity).toEqual({
      enabled: true,
      minimumFactor: 0.7,
      maximumFactor: 1,
      curve: { kind: "power", exponent: 0.55 },
    });
    // Every source pressure survives, which is what makes a reopened stroke
    // reproduce its own width profile rather than a recomputed one.
    expect(stroke.sourceSamples.length).toBeGreaterThan(0);
    expect(stroke.sourceSamples.some((entry) => entry.pressure !== 0.5)).toBe(true);

    const reencoded = encodeFolioProject(decoded);
    expect(encodeFolioProject(decodeFolioProject(reencoded))).toBe(reencoded);
    expect(reencoded).toContain('"kind": "pressure-pen"');
    // No format bump: a Pressure Pen project is a formatVersion 1 project.
    expect((JSON.parse(reencoded) as { formatVersion: number }).formatVersion).toBe(1);
  });

  it.each([
    ["a strategy no build has", { version: 1, kind: "unknown-brush" }],
    ["a strategy a later phase will add", { version: 1, kind: "pencil" }],
    ["a future version of Technical Pen", { version: 2, kind: "technical-pen" }],
    ["a future version of Pressure Pen", { version: 2, kind: "pressure-pen" }],
    ["a future version of a known strategy", { version: 999, kind: "centerline" }],
    ["a future version of the outline strategy", { version: 2, kind: "outline" }],
    ["a non-integer version", { version: 1.5, kind: "centerline" }],
    ["a version of zero", { version: 0, kind: "centerline" }],
    ["a string version", { version: "1", kind: "centerline" }],
    ["a null kind", { version: 1, kind: null }],
  ])("refuses %s by name", (_, renderer) => {
    const error = expectRefusal(renderer);
    expect(error.code).toBe("INVALID_INK");
    expect(error.path).toContain("renderer");
    expect(error.details.supported).toEqual(supportedBrushStrategies());
  });

  it("still refuses a renderer that is missing a field or carries an extra one", () => {
    expect(expectRefusal({ kind: "centerline" }).code).toBe("INVALID_INK");
    expect(expectRefusal({ version: 1, kind: "centerline", grain: 0.5 }).code).toBe("INVALID_INK");
  });

  it("never substitutes a nearby strategy when it refuses", () => {
    // The failure has to be the whole decode. A project that opens with one
    // stroke quietly re-rendered is worse than a project that will not open.
    const encoded = JSON.stringify(
      withInkRenderer(createRepresentativeProject(), { version: 2, kind: "technical-pen" }),
    );
    expect(() => decodeFolioProject(encoded)).toThrow(FolioProjectCodecError);
  });
});

/** The one Ink brush in the fixture, as a mutable encoded record. */
function inkBrush(record: Record<string, unknown>): Record<string, unknown> {
  const pages = (record.sketchbook as { pages: Record<string, unknown>[] }).pages;
  const objects = (pages[0]!.content as { objects: Record<string, unknown>[] }).objects;
  const ink = objects.find((object) => object.type === "ink");
  if (ink === undefined) throw new Error("The fixture must contain an Ink object.");
  return (ink.payload as { stroke: { brush: Record<string, unknown> } }).stroke.brush;
}

function inkStrokes(project: FolioProjectSnapshot): readonly InkObject["stroke"][] {
  const strokes: InkObject["stroke"][] = [];
  for (const page of project.sketchbook.pages) {
    for (const object of page.content.objects.objects) {
      if (object instanceof InkObject) strokes.push(object.stroke);
    }
  }
  return strokes;
}

function inkStrategies(
  project: FolioProjectSnapshot,
): readonly Readonly<{ kind: string; version: number }>[] {
  const strategies: Array<Readonly<{ kind: string; version: number }>> = [];
  for (const page of project.sketchbook.pages) {
    for (const object of page.content.objects.objects) {
      if (object instanceof InkObject) strategies.push(object.stroke.brush.renderer);
    }
  }
  return strategies;
}
