import { ObjectCollection, ObjectFactory, Transform } from "@folio/document";
import { StrokeBuilder, StrokeSmoother } from "@folio/ink";
import type {
  RotationManipulationResult,
  ScaleManipulationResult,
  TranslationManipulationResult,
} from "@folio/manipulation";
import { describe, expect, it } from "vitest";
import {
  createEditorGroupManipulationPlan,
  transformGroupBounds,
} from "../EditorGroupManipulation";
import { EditorSelectionGeometry } from "../EditorSelectionGeometry";

const TIMESTAMP = "2026-07-29T10:00:00.000Z";

describe("EditorSelectionGeometry", () => {
  it("caches one combined group bound until selection or document identity changes", () => {
    const document = createDocument();
    const selectedIds = Object.freeze(["first", "second"]);
    const geometry = new EditorSelectionGeometry();

    const first = geometry.resolve(document, selectedIds);
    const cached = geometry.resolve(document, selectedIds);

    expect(first).not.toBeNull();
    if (first === null) throw new Error("Expected combined selection geometry.");
    expect(cached).toBe(first);
    expect(first.objects.map(({ id }) => id)).toEqual(selectedIds);
    expect(first.primaryObject.id).toBe("second");
    expect(first.bounds.x).toBeCloseTo(Math.min(...document.objects.map(({ bounds }) => bounds.x)));
    expect(first.bounds.x + first.bounds.width).toBeCloseTo(
      Math.max(...document.objects.map(({ bounds }) => bounds.x + bounds.width)),
    );
    expect(first.manipulationTarget.id).toBe("second");
    expect(first.manipulationTarget.bounds).toBe(first.bounds);
    expect(first.manipulationTarget.transform.isIdentity).toBe(true);

    const successor = document.replace(
      new ObjectFactory({ now: () => TIMESTAMP }).translateObject(document.objects[1]!, {
        x: 25,
        y: 0,
      }),
    );
    expect(geometry.resolve(successor, selectedIds)).not.toBe(first);
    geometry.clear();
    expect(geometry.resolve(document, [])).toBeNull();
  });
});

describe("editor group manipulation expansion", () => {
  it("expands one translation into one existing move result per object", () => {
    const selection = requireSelection();
    const plan = createEditorGroupManipulationPlan(translationResult(), selection);

    expect(plan).toMatchObject({
      id: "group-translation-group-session",
      description: "Move 2 selected objects",
    });
    expect(plan.results).toHaveLength(2);
    expect(plan.results.every(({ kind }) => kind === "translation")).toBe(true);
    expect(
      plan.results.map((result) =>
        result.kind === "translation" ? result.finalObjectTranslation : null,
      ),
    ).toEqual([
      { x: 15, y: -5 },
      { x: 115, y: 35 },
    ]);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.results)).toBe(true);
  });

  it("scales every object and its position around the combined center", () => {
    const selection = requireSelection();
    const source: ScaleManipulationResult = Object.freeze({
      kind: "scale",
      sessionId: "scale-group",
      objectId: selection.primaryObject.id,
      scale: Object.freeze({ factor: 2 }),
      initialObjectScale: 1,
      finalObjectScale: 2,
      sessionTimestamp: 1,
    });

    const plan = createEditorGroupManipulationPlan(source, selection);
    const scales = plan.results.filter((result) => result.kind === "scale");
    const moves = plan.results.filter((result) => result.kind === "translation");

    expect(scales).toHaveLength(2);
    expect(scales.map(({ finalObjectScale }) => finalObjectScale)).toEqual([2, 3]);
    expect(moves).toHaveLength(2);
    const initialCenters = selection.objects.map(center);
    const finalCenters = selection.objects.map((object, index) => {
      const move = moves[index];
      if (move?.kind !== "translation") throw new Error("Expected scale reposition result.");
      const current = center(object);
      return {
        x: current.x + move.translation.translationX,
        y: current.y + move.translation.translationY,
      };
    });
    expect(distance(finalCenters[0]!, finalCenters[1]!)).toBeCloseTo(
      distance(initialCenters[0]!, initialCenters[1]!) * 2,
    );
    expect(transformGroupBounds(selection.bounds, draggingScaleState()).width).toBeCloseTo(
      selection.bounds.width * 2,
    );
  });

  it("rotates object transforms and centers around the combined group pivot", () => {
    const selection = requireSelection();
    const source: RotationManipulationResult = Object.freeze({
      kind: "rotation",
      sessionId: "rotate-group",
      objectId: selection.primaryObject.id,
      rotation: Object.freeze({ deltaRadians: Math.PI / 2 }),
      initialObjectRotation: 0,
      finalObjectRotation: Math.PI / 2,
      sessionTimestamp: 1,
    });

    const plan = createEditorGroupManipulationPlan(source, selection);
    const rotations = plan.results.filter((result) => result.kind === "rotation");
    const moves = plan.results.filter((result) => result.kind === "translation");

    expect(rotations).toHaveLength(2);
    expect(rotations.map(({ finalObjectRotation }) => finalObjectRotation)).toEqual([
      Math.PI / 2,
      Math.PI / 2 + 0.25,
    ]);
    expect(moves).toHaveLength(2);
    const pivot = center({ bounds: selection.bounds });
    for (const [index, object] of selection.objects.entries()) {
      const original = center(object);
      const move = moves[index];
      if (move?.kind !== "translation") throw new Error("Expected rotation reposition result.");
      const rotated = {
        x: original.x + move.translation.translationX,
        y: original.y + move.translation.translationY,
      };
      expect(distance(rotated, pivot)).toBeCloseTo(distance(original, pivot));
    }
  });
});

function requireSelection() {
  const document = createDocument();
  const selection = new EditorSelectionGeometry().resolve(
    document,
    Object.freeze(["first", "second"]),
  );
  if (selection === null) throw new Error("Expected group selection geometry.");
  return selection;
}

function createDocument(): ObjectCollection {
  const factory = new ObjectFactory({ now: () => TIMESTAMP });
  return new ObjectCollection([
    factory.createInkObject({
      id: "first",
      zIndex: 0,
      stroke: createStroke("first"),
      transform: new Transform({ translation: { x: 0, y: 0 }, scale: 1 }),
    }),
    factory.createInkObject({
      id: "second",
      zIndex: 1,
      stroke: createStroke("second"),
      transform: new Transform({
        translation: { x: 100, y: 40 },
        rotation: 0.25,
        scale: 1.5,
      }),
    }),
  ]);
}

function translationResult(): TranslationManipulationResult {
  return Object.freeze({
    kind: "translation",
    sessionId: "group-session",
    objectId: "second",
    translation: Object.freeze({
      translationX: 15,
      translationY: -5,
      totalDistance: Math.hypot(15, -5),
      movementVector: Object.freeze({ x: 15, y: -5 }),
    }),
    initialObjectTranslation: Object.freeze({ x: 0, y: 0 }),
    finalObjectTranslation: Object.freeze({ x: 15, y: -5 }),
    sessionTimestamp: 1,
  });
}

function draggingScaleState() {
  return Object.freeze({
    kind: "scale" as const,
    phase: "dragging" as const,
    sessionId: "preview",
    objectId: "second",
    pointerId: 1,
    dragOrigin: null,
    currentPointerPosition: null,
    objectCenter: null,
    initialObjectTranslation: null,
    translation: Object.freeze({
      translationX: 0,
      translationY: 0,
      totalDistance: 0,
      movementVector: Object.freeze({ x: 0, y: 0 }),
    }),
    finalObjectTranslation: null,
    initialObjectRotation: 0,
    rotation: Object.freeze({ deltaRadians: 0 }),
    finalObjectRotation: 0,
    initialObjectScale: 1,
    scale: Object.freeze({ factor: 2 }),
    finalObjectScale: 2,
    sessionTimestamp: 1,
    version: 1,
  });
}

function center(object: {
  readonly bounds: { x: number; y: number; width: number; height: number };
}) {
  return {
    x: object.bounds.x + object.bounds.width / 2,
    y: object.bounds.y + object.bounds.height / 2,
  };
}

function distance(
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>,
): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function createStroke(id: string) {
  const builder = new StrokeBuilder({
    id: `stroke-${id}`,
    timestamp: 0,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (const [x, y, timestamp] of [
    [0, 0, 0],
    [20, 10, 10],
  ] as const) {
    builder.addPoint({
      x,
      y,
      timestamp,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    });
  }
  return builder.finalize();
}
