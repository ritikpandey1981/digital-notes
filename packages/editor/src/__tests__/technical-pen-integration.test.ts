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
 * Technical Pen through the systems around it. Nothing here is
 * strategy-specific by design: selection, the eraser, transforms, History and
 * the project codec all reach it through the same contracts every other brush
 * uses, and that is exactly what these assertions are checking.
 */

const CREATED_AT = "2026-09-14T09:00:00.000Z";
const MOVED_AT = "2026-09-14T09:00:02.000Z";
const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function technicalPen(size = 6): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "pen-technical",
    presetVersion: 1,
    family: "pen",
    color: "#111111",
    size,
    opacity: 1,
    smoothing: Object.freeze({ mode: "average", amount: 0.3 }),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: LINEAR,
      }),
      pressureOpacity: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: LINEAR,
      }),
    }),
    renderer: Object.freeze({ version: 1, kind: "technical-pen" }),
  });
}

function sample(x: number, y: number, index: number): StrokePointInput {
  return {
    x,
    y,
    timestamp: index * 8,
    pressure: 0.2 + ((index * 0.09) % 0.7),
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  };
}

function horizontalStroke(brush: ResolvedBrushSnapshot, id = "technical-stroke"): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (let index = 0; index < 20; index += 1) builder.addPoint(sample(40 + index * 6, 90, index));
  return builder.finalize();
}

function inkObject(stroke: Stroke, id = "technical-object"): InkObject {
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

/** The painted width a strategy reports, independent of the object's scale. */
function resolvedWidth(object: InkObject): number {
  return object.stroke.brush.size;
}

describe("Technical Pen in the editor", () => {
  it("is selectable by the ordinary hit-test engine, with width included", () => {
    const object = inkObject(horizontalStroke(technicalPen(10)));
    const engine = createEditorSelectionHitTestEngine(objectSource([object]));

    expect(engine.hitTest(pagePoint(90, 90))?.objectId).toBe("technical-object");
    // The stroke is 10 page units wide on a line at y=90, so a press half a
    // width away still lands on ink.
    expect(engine.hitTest(pagePoint(90, 94))?.objectId).toBe("technical-object");
    expect(engine.hitTest(pagePoint(90, 400))).toBeNull();
    expect(engine.hitTest(pagePoint(600, 90))).toBeNull();
  });

  it("erases as a whole object through the shared eligibility rule", () => {
    // No TechnicalPenEraser: the eraser reads geometry-derived candidates and
    // does not know which strategy drew them.
    const object = inkObject(horizontalStroke(technicalPen(8)));
    const engine = createEditorSelectionHitTestEngine(objectSource([object]));
    const candidates = engine
      .queryNearby(pagePoint(100, 90), 4)
      .map((result) => result.objectReference);

    expect(firstErasableInkCandidate(candidates, new Set())?.id).toBe("technical-object");
    expect(firstErasableInkCandidate(candidates, new Set(["technical-object"]))).toBeNull();
  });

  it("keeps its snapshot and its geometry across Undo and Redo", () => {
    const object = inkObject(horizontalStroke(technicalPen()));
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

    const restored = session.current.lookup("technical-object") as InkObject;
    expect(restored.stroke).toBe(object.stroke);
    expect(restored.stroke.brush.renderer).toEqual({ version: 1, kind: "technical-pen" });
    expect(getStrokeRenderedBounds(restored.stroke)).toEqual(drawn);
  });

  it("moves under the ordinary transform command without changing painted width", () => {
    const object = inkObject(horizontalStroke(technicalPen()));
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
        id: "move-technical-pen",
        timestamp: MOVED_AT,
      }),
    );

    const moved = session.current.lookup("technical-object") as InkObject;
    expect(moved.transform.translation).toEqual({ x: 35, y: -12 });
    const after = moved.bounds;
    expect(after.width).toBeCloseTo(before.width, 9);
    expect(after.height).toBeCloseTo(before.height, 9);
    expect(after.x).toBeCloseTo(before.x + 35, 9);

    manager.undo();
    expect((session.current.lookup("technical-object") as InkObject).bounds).toEqual(object.bounds);
  });

  it("keeps a scaled stroke's ink the same width while its geometry grows", () => {
    const stroke = horizontalStroke(technicalPen(6));
    const plain = inkObject(stroke);
    const scaled = new ObjectFactory({
      createId: () => "scaled-object",
      now: () => CREATED_AT,
    }).createInkObject({ stroke, transform: new Transform({ scale: 2 }) });

    // Scale-compensated width is Folio's established Ink semantics, and
    // Technical Pen inherits it rather than introducing a rule of its own. The
    // stroke is horizontal, so its bounds height is exactly the ink thickness:
    // it does not move, while the path it runs along doubles in length.
    const thickness = plain.bounds.height;
    expect(scaled.bounds.height).toBeCloseTo(thickness, 9);
    expect(scaled.bounds.width - thickness).toBeCloseTo((plain.bounds.width - thickness) * 2, 6);
    expect(resolvedWidth(scaled)).toBe(resolvedWidth(plain));
  });

  it("redraws identically after a Save and Open round trip", () => {
    const object = inkObject(horizontalStroke(technicalPen()));
    const project = {
      metadata: {
        documentId: "11111111-1111-4111-8111-111111111111",
        title: "Technical Pen",
        createdAt: CREATED_AT,
      },
      sketchbook: sketchbookWith(object),
    };

    const encoded = encodeFolioProject(project);
    const reopened = decodeFolioProject(encoded);
    const restored = reopened.sketchbook.pages[0]!.content.objects.objects[0] as InkObject;

    expect(restored.stroke.brush.renderer).toEqual({ version: 1, kind: "technical-pen" });
    expect(restored.stroke.brush).toEqual(object.stroke.brush);
    expect(restored.stroke.sourceSamples).toEqual(object.stroke.sourceSamples);
    // Geometry is rebuilt from scratch on the reopened stroke, so matching
    // bounds means the strategy reproduced the same path from durable data.
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
