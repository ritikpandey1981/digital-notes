import {
  InkObject,
  ObjectCollection,
  ObjectFactory,
  Page,
  PageDocument,
  SketchbookDocument,
  Transform,
  createDefaultLayer,
  createPageGeometry,
  createPagePaper,
} from "@folio/document";
import { createEditorHistoryManager } from "@folio/history";
import {
  StrokeBuilder,
  StrokeSmoother,
  createResolvedBrushSnapshot,
  getStrokeRenderedBounds,
  type ResolvedBrushSnapshot,
  type Stroke,
  type StrokePointInput,
} from "@folio/ink";
import { decodeFolioProject, encodeFolioProject } from "@folio/persistence/project";
import { describe, expect, it } from "vitest";
import { createEditorSelectionHitTestEngine } from "../EditorSelectionHitTestEngine";
import { firstErasableInkCandidate } from "../EraserEligibility";
import { createAddStrokeCommand } from "../history/add-stroke-command";
import { createMoveCommand } from "../history/move-command";
import { TEST_LAYER_ID, pageOf } from "./layer-test-support";

/**
 * Pressure Pen through the systems around it.
 *
 * Nothing here is strategy-specific, and that is the assertion. Selection, the
 * eraser, transforms, History and the project codec all reach a variable-width
 * stroke through the same contracts a constant-width one uses; there is no
 * PressurePenEraser and no pressure-aware transform. What the strategy owes
 * them is a snapshot and a set of samples, and what they owe it is never to
 * recompute either.
 */

const CREATED_AT = "2026-09-14T09:00:00.000Z";
const MOVED_AT = "2026-09-14T09:00:02.000Z";
const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function pressurePen(size = 6): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pen-brush",
    presetVersion: 1,
    family: "pen",
    color: "#111111",
    size,
    opacity: 1,
    smoothing: Object.freeze({ mode: "average", amount: 0.18 }),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: true,
        minimumFactor: 0.35,
        maximumFactor: 1.65,
        curve: LINEAR,
      }),
      pressureOpacity: Object.freeze({
        enabled: true,
        minimumFactor: 0.7,
        maximumFactor: 1,
        curve: Object.freeze({ kind: "power" as const, exponent: 0.55 }),
      }),
    }),
    renderer: Object.freeze({ version: 1, kind: "pressure-pen" }),
  });
}

/** A ramp from a light touch to a firm press, so width varies along the stroke. */
function sample(x: number, y: number, index: number, count: number): StrokePointInput {
  return {
    x,
    y,
    timestamp: index * 8,
    pressure: 0.08 + (0.88 * index) / Math.max(1, count - 1),
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  };
}

const POINT_COUNT = 24;

function horizontalStroke(brush: ResolvedBrushSnapshot, id = "pressure-stroke"): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (let index = 0; index < POINT_COUNT; index += 1) {
    builder.addPoint(sample(40 + index * 6, 90, index, POINT_COUNT));
  }
  return builder.finalize();
}

function inkObject(stroke: Stroke, id = "pressure-object"): InkObject {
  return new ObjectFactory({ createId: () => id, now: () => CREATED_AT }).createInkObject({
    stroke,
  });
}

function objectSource(objects: readonly InkObject[]) {
  return {
    getObjects: () => objects,
    getObject: (objectId: string) => objects.find((object) => object.id === objectId),
  };
}

function pagePoint(x: number, y: number) {
  return { x, y, coordinateSpace: "page" as const };
}

describe("Pressure Pen in the editor", () => {
  it("is selectable by the ordinary hit-test engine across its whole width", () => {
    const object = inkObject(horizontalStroke(pressurePen(10)));
    const engine = createEditorSelectionHitTestEngine(objectSource([object]));

    expect(engine.hitTest(pagePoint(100, 90))?.objectId).toBe("pressure-object");
    // The heavy end is wider than the light one, so a press that lands on ink
    // near the end would have missed near the start.
    expect(engine.hitTest(pagePoint(175, 96))?.objectId).toBe("pressure-object");
    expect(engine.hitTest(pagePoint(100, 400))).toBeNull();
    expect(engine.hitTest(pagePoint(600, 90))).toBeNull();
  });

  it("erases as a whole object through the shared eligibility rule", () => {
    // No PressurePenEraser: the eraser reads geometry-derived candidates and
    // does not know which strategy drew them, or how wide it drew them.
    const object = inkObject(horizontalStroke(pressurePen(8)));
    const engine = createEditorSelectionHitTestEngine(objectSource([object]));
    const candidates = engine
      .queryNearby(pagePoint(120, 90), 4)
      .map((result) => result.objectReference);

    expect(firstErasableInkCandidate(candidates, new Set())?.id).toBe("pressure-object");
    expect(firstErasableInkCandidate(candidates, new Set(["pressure-object"]))).toBeNull();
  });

  it("keeps its snapshot, its pressures and its geometry across Undo and Redo", () => {
    const object = inkObject(horizontalStroke(pressurePen()));
    const session = {
      current: pageOf(),
      getDocument() {
        return this.current;
      },
      replaceDocument(document: PageDocument) {
        this.current = document;
      },
    };
    const manager = createEditorHistoryManager({ documentSession: session });
    manager.executeCommand(
      createAddStrokeCommand({ object, insertionIndex: 0, layerId: TEST_LAYER_ID }),
    );
    const drawn = getStrokeRenderedBounds(object.stroke);

    manager.undo();
    expect(session.current.size).toBe(0);
    manager.redo();

    const restored = session.current.lookup("pressure-object") as InkObject;
    expect(restored.stroke).toBe(object.stroke);
    expect(restored.stroke.brush.renderer).toEqual({ version: 1, kind: "pressure-pen" });
    expect(restored.stroke.brush.dynamics).toEqual(object.stroke.brush.dynamics);
    expect(restored.stroke.sourceSamples).toEqual(object.stroke.sourceSamples);
    // Nothing is recomputed from whatever the preset happens to say now.
    expect(getStrokeRenderedBounds(restored.stroke)).toEqual(drawn);
  });

  it("moves under the ordinary transform command without changing its pressure profile", () => {
    const object = inkObject(horizontalStroke(pressurePen()));
    const session = {
      current: pageOf([object]),
      getDocument() {
        return this.current;
      },
      replaceDocument(document: PageDocument) {
        this.current = document;
      },
    };
    const manager = createEditorHistoryManager({ documentSession: session });
    const before = getStrokeRenderedBounds(object.stroke);

    manager.executeCommand(
      createMoveCommand({
        objectId: object.id,
        expectedObjectModifiedAt: CREATED_AT,
        initialTranslation: { x: 0, y: 0 },
        finalTranslation: { x: 35, y: -12 },
        id: "move-pressure-pen",
        timestamp: MOVED_AT,
      }),
    );

    const moved = session.current.lookup("pressure-object") as InkObject;
    expect(moved.transform.translation).toEqual({ x: 35, y: -12 });
    const after = moved.bounds;
    expect(after.width).toBeCloseTo(before.width, 9);
    expect(after.height).toBeCloseTo(before.height, 9);
    expect(after.x).toBeCloseTo(before.x + 35, 9);
    // Source pressure is never reinterpreted by a transform.
    expect(moved.stroke.sourceSamples).toEqual(object.stroke.sourceSamples);

    manager.undo();
    expect((session.current.lookup("pressure-object") as InkObject).bounds).toEqual(object.bounds);
  });

  it("keeps a scaled stroke's ink the same width while its geometry grows", () => {
    const stroke = horizontalStroke(pressurePen(6));
    const plain = inkObject(stroke);
    const scaled = new ObjectFactory({
      createId: () => "scaled-object",
      now: () => CREATED_AT,
    }).createInkObject({ stroke, transform: new Transform({ scale: 2 }) });

    // Scale-compensated width is Folio's established Ink semantics, and a
    // variable width inherits it rather than introducing a rule of its own: the
    // heaviest point stays as heavy as it was, while the path doubles in length.
    const thickness = plain.bounds.height;
    expect(scaled.bounds.height).toBeCloseTo(thickness, 6);
    expect(scaled.bounds.width - thickness).toBeCloseTo((plain.bounds.width - thickness) * 2, 5);
    expect(scaled.stroke.brush.size).toBe(plain.stroke.brush.size);
  });

  it("redraws identically after a Save and Open round trip", () => {
    const object = inkObject(horizontalStroke(pressurePen()));
    const project = {
      metadata: {
        documentId: "22222222-2222-4222-8222-222222222222",
        title: "Pressure Pen",
        createdAt: CREATED_AT,
      },
      sketchbook: sketchbookWith(object),
    };

    const encoded = encodeFolioProject(project);
    const reopened = decodeFolioProject(encoded);
    const restored = reopened.sketchbook.pages[0]!.content.objects.objects[0] as InkObject;

    expect(restored.stroke.brush.renderer).toEqual({ version: 1, kind: "pressure-pen" });
    expect(restored.stroke.brush).toEqual(object.stroke.brush);
    expect(restored.stroke.sourceSamples).toEqual(object.stroke.sourceSamples);
    // Geometry is rebuilt from scratch on the reopened stroke, so matching
    // bounds means the strategy reproduced the same variable width from durable
    // data alone.
    expect(getStrokeRenderedBounds(restored.stroke)).toEqual(
      getStrokeRenderedBounds(object.stroke),
    );
    expect(encodeFolioProject(reopened)).toBe(encoded);
  });
});

function sketchbookWith(object: InkObject): SketchbookDocument {
  const content = new PageDocument({
    layers: [createDefaultLayer().withObjectIds([object.id])],
    objects: new ObjectCollection([object]),
  });
  return new SketchbookDocument({
    pages: [
      new Page({
        id: "page-1",
        name: "Page 1",
        geometry: createPageGeometry({ width: 600, height: 800 }),
        paper: createPagePaper({ type: "blank", color: "#ffffff" }),
        content,
      }),
    ],
  });
}
