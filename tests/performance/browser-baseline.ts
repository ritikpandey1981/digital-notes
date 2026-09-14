import { ObjectCollection, ObjectFactory } from "../../packages/document/src/index";
import { createDeleteManipulationResult } from "../../packages/manipulation/src/index";
import { ProjectSession } from "../../packages/editor/src/project-session";
import { createEditorHistoryCoordinator } from "../../packages/editor/src/history/editor-history-coordinator";
import { ContinuousSelectionStyleEdit } from "../../packages/editor/src/ContinuousSelectionStyleEdit";
import { EditorSelectionSet } from "../../packages/editor/src/EditorSelectionSet";
import { marqueeSelectedObjects } from "../../packages/editor/src/MarqueeSelection";
import { renderPageThumbnail } from "../../packages/editor/src/VectorShapeRendering";
import { StrokeRenderer, PointerInputController } from "../../packages/ink/src/index";
import {
  createBrushRenderGeometry,
  resolveStrokeRenderGeometry,
} from "../../packages/ink/src/internal/brush-render-strategy";
import { Viewport, CoordinateConverter } from "../../packages/rendering/src/index";
import {
  encodeFolioProject,
  decodeFolioProject,
} from "../../packages/persistence/src/project/index";
import { builder, brush, fixture, points, TIMESTAMP, type BaselineBrushKind } from "./fixtures";
import { measure, measureAsync, summarize, type Measurement } from "./metrics";

export { fixture, measureAsync };
export const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

export async function runSoak(iterations: number) {
  const project = new ProjectSession(fixture(20, 10, 10));
  const session = project.documentSession;
  const history = coordinator(project);
  const depths: number[] = [];
  const started = performance.now();
  try {
    for (let i = 0; i < iterations; i++) {
      session.setActivePageId(`p${i % 10}`);
      const stroke = builder(`soak-${i}`);
      points(64, i).forEach((point) => stroke.addPoint(point));
      const object = new ObjectFactory({ now: () => TIMESTAMP }).createInkObject({
        id: `soak-object-${i}`,
        stroke: stroke.finalize(),
      });
      history.executeStroke(object);
      history.executeManipulation({
        kind: "translation",
        objectId: object.id,
        sessionId: `soak-move-${i}`,
        sessionTimestamp: i,
        translation: {
          translationX: 2,
          translationY: 3,
          totalDistance: Math.hypot(2, 3),
          movementVector: { x: 2, y: 3 },
        },
        initialObjectTranslation: { x: 0, y: 0 },
        finalObjectTranslation: { x: 2, y: 3 },
      });
      const selected = marqueeSelectedObjects(
        session.collection.objects,
        { x: 0, y: 0, width: 200, height: 200 },
        () => true,
      );
      const edit = new ContinuousSelectionStyleEdit({
        documentSession: session,
        commit: (edits) => history.executeSelectionStyleUpdate(edits),
        onPreviewDocumentChange: () => undefined,
        isEditable: () => true,
      });
      edit.begin(selected.map((value) => value.id));
      edit.update({ opacity: i % 2 ? 0.7 : 0.8 });
      edit.commit();
      history.undo();
      history.redo();
      history.executeLayerPatch(session.activeLayerId, { visible: false });
      history.undo();
      if (i % 10 === 0) {
        const content = encodeFolioProject(project.capturePersistenceSnapshot().project);
        const result = await window.folio.recovery.store({
          recoveryId: "33333333-3333-4333-8333-333333333333",
          sessionId: "44444444-4444-4444-8444-444444444444",
          documentId: project.metadata.documentId,
          title: project.metadata.title,
          capturedAt: new Date().toISOString(),
          backingTargetId: null,
          content,
        });
        if (result.status !== "stored") throw new Error(JSON.stringify(result));
        depths.push(history.controller.getHistoryState().undoDepth);
        await paint();
      }
    }
    return {
      iterations,
      durationMs: performance.now() - started,
      historyDepths: depths,
      objects: session.sketchbook.pages.reduce((sum, page) => sum + page.objectCount, 0),
      pages: session.sketchbook.pageCount,
    };
  } finally {
    history.destroy();
    await window.folio.recovery.clear("33333333-3333-4333-8333-333333333333");
  }
}
function coordinator(project: ProjectSession) {
  return createEditorHistoryCoordinator({
    documentSession: project.documentSession,
    now: () => TIMESTAMP,
    onDocumentChange: () => undefined,
  });
}

export function runModels(
  group: "stroke" | "document" | "layers" | "pages" | "selection",
  size: number,
): Measurement[] {
  const results: Measurement[] = [];
  const record = (name: string, fn: () => unknown, count = 20) =>
    results.push(
      measure(
        `${group}/${size}/${name}`,
        fn,
        group === "selection" && size >= 500 && name.includes("command") ? 1 : count,
        group === "selection" && size >= 500 && name.includes("command") ? 0 : 3,
      ),
    );
  if (group === "stroke") {
    for (const kind of ["centerline", "outline", "technical-pen"] as const) {
      const source = points(size);
      const make = () => {
        const value = builder("long", kind);
        source.forEach((point) => value.addPoint(point));
        return value;
      };
      record(`${kind}/builder-total`, make);
      const stroke = make().finalize();
      record(`${kind}/geometry`, () => createBrushRenderGeometry(stroke.points, stroke.brush));
      const times = [];
      for (let i = 0; i < 24; i++) {
        const value = make();
        const start = performance.now();
        value.finalize();
        if (i >= 4) times.push(performance.now() - start);
      }
      results.push(summarize(`${group}/${size}/${kind}/finalize`, times));
      const coldTimes = [];
      for (let i = 0; i < 24; i++) {
        const value = make().finalize();
        const start = performance.now();
        resolveStrokeRenderGeometry(value, 1);
        if (i >= 4) coldTimes.push(performance.now() - start);
      }
      results.push(summarize(`${group}/${size}/${kind}/committed-geometry-cache-miss`, coldTimes));
    }
    return results;
  }
  const project = new ProjectSession(
    fixture(
      group === "document" ? size : group === "layers" ? 1000 : group === "pages" ? 20 : size,
      group === "layers" ? size : 1,
      group === "pages" ? size : 1,
    ),
  );
  const session = project.documentSession;
  const history = coordinator(project);
  try {
    if (group === "document" || group === "layers") {
      const canvas = document.createElement("canvas");
      canvas.width = 1440;
      canvas.height = 900;
      const context = canvas.getContext("2d")!;
      record("canvas2d-page-paint", () =>
        renderPageThumbnail(context, session.activePage, canvas, { pageLineColor: "#cccccc" }),
      );
      let visible = true;
      record("visibility-command", () =>
        history.executeLayerPatch(session.activeLayerId, { visible: (visible = !visible) }),
      );
      const ids = session.page.layers.map((layer) => layer.id);
      let index = 0;
      record("active-layer", () => session.setActiveLayerId(ids[index++ % ids.length]!));
      if (ids.length > 1)
        record("reorder-roundtrip", () => {
          history.executeReorderLayer(ids[0]!, ids.length - 1);
          history.undo();
        });
      record("capture", () => project.capturePersistenceSnapshot(), 100);
      // These rendering fixtures exceed the format ceiling. Keep their rendering
      // measurements without disguising an expected codec refusal as a timing.
      if (group === "document" && size > 1000) return results;
      record("encode", () => encodeFolioProject(project.captureSnapshot()), 10);
      const encoded = encodeFolioProject(project.captureSnapshot());
      record("decode", () => decodeFolioProject(encoded), 10);
      const decoded = decodeFolioProject(encoded);
      record("project-session", () => new ProjectSession(decoded), 100);
      results.push(
        summarize(`${group}/${size}/encoded-bytes`, [new TextEncoder().encode(encoded).byteLength]),
      );
    }
    if (group === "pages") {
      let index = 0;
      const ids = session.sketchbook.pages.map((page) => page.id);
      record("switch", () => session.setActivePageId(ids[index++ % ids.length]!), 100);
      record("create-undo", () => {
        history.executeAddPage();
        history.undo();
      });
      if (size > 1)
        record("delete-undo", () => {
          history.executeRemovePage(ids.at(-1)!);
          history.undo();
        });
      history.executePageRename(ids[0]!, "Changed");
      record("undo-redo", () => {
        history.undo();
        history.redo();
      });
      record("encode", () => encodeFolioProject(project.captureSnapshot()));
      const encoded = encodeFolioProject(project.captureSnapshot());
      record("decode", () => decodeFolioProject(encoded));
    }
    if (group === "selection") {
      const objects = session.collection.objects;
      record(
        "marquee-hit-test",
        () => {
          if (
            marqueeSelectedObjects(objects, { x: 0, y: 0, width: 10000, height: 10000 }, () => true)
              .length !== size
          )
            throw new Error("Marquee fixture mismatch");
        },
        100,
      );
      record("collection-reconstruction", () => new ObjectCollection(objects));
      record(
        "selection-creation",
        () => new EditorSelectionSet().replace(objects.map((object) => object.id)),
        100,
      );
      const translations = objects.map((object) => ({
        kind: "translation" as const,
        objectId: object.id,
        sessionId: "move",
        sessionTimestamp: 1,
        translation: {
          translationX: 12,
          translationY: 8,
          totalDistance: Math.hypot(12, 8),
          movementVector: { x: 12, y: 8 },
        },
        initialObjectTranslation: { x: 0, y: 0 },
        finalObjectTranslation: { x: 12, y: 8 },
      }));
      record(
        "move-command-undo",
        () => {
          history.executeManipulations(translations, { id: "move", description: "Move selection" });
          history.undo();
        },
        10,
      );
      const deletions = objects.map((object) =>
        createDeleteManipulationResult({ objectId: object.id }),
      );
      record(
        "delete-command-undo",
        () => {
          history.executeDeletions(deletions);
          history.undo();
        },
        10,
      );
      for (const kind of ["ink", "vector", "mixed"] as const) {
        const owner = new ProjectSession(fixture(size, 1, 1, kind));
        const editsHistory = coordinator(owner);
        const edit = new ContinuousSelectionStyleEdit({
          documentSession: owner.documentSession,
          commit: (edits) => editsHistory.executeSelectionStyleUpdate(edits),
          onPreviewDocumentChange: () => undefined,
          isEditable: () => true,
        });
        const ids = owner.documentSession.collection.objects.map((object) => object.id);
        const updates: number[] = [],
          commits: number[] = [],
          cancels: number[] = [],
          undos: number[] = [],
          redos: number[] = [];
        try {
          const warmups = size >= 500 ? 0 : 4;
          const samples = size >= 500 ? 1 : 10;
          for (let i = 0; i < warmups + samples; i++) {
            edit.begin(ids);
            let start = performance.now();
            edit.update({ color: "#ff0000" });
            if (i >= warmups) updates.push(performance.now() - start);
            start = performance.now();
            edit.cancel();
            if (i >= warmups) cancels.push(performance.now() - start);
            edit.begin(ids);
            edit.update({ color: "#ff0000" });
            start = performance.now();
            edit.commit();
            if (i >= warmups) commits.push(performance.now() - start);
            start = performance.now();
            editsHistory.undo();
            if (i >= warmups) undos.push(performance.now() - start);
            start = performance.now();
            editsHistory.redo();
            if (i >= warmups) redos.push(performance.now() - start);
            editsHistory.undo();
            editsHistory.controller.clearHistory();
          }
          for (const [name, samples] of [
            ["preview", updates],
            ["commit", commits],
            ["cancel", cancels],
            ["undo", undos],
            ["redo", redos],
          ] as const)
            results.push(summarize(`selection/${size}/${kind}/${name}`, samples));
        } finally {
          edit.cancel();
          editsHistory.destroy();
        }
      }
    }
  } finally {
    history.destroy();
  }
  return results;
}

/** Uses the real input controller and live renderer on a visible canvas, with a timed native rAF adapter. */
export async function runLive(
  kind: BaselineBrushKind,
  count: number,
  samplesPerFrame: number,
): Promise<Measurement[]> {
  const canvas = document.createElement("canvas");
  canvas.width = 1440;
  canvas.height = 900;
  canvas.style.cssText =
    "position:fixed;inset:0;z-index:99999;background:white;width:1440px;height:900px";
  document.body.append(canvas);
  const viewport = new Viewport({
    size: { width: 1440, height: 900 },
    pageRect: { x: 0, y: 0, width: 1440, height: 900 },
    devicePixelRatio: 1,
  });
  const work: number[] = [],
    latency: number[] = [],
    intervals: number[] = [];
  let pending: number[] = [];
  let previousFrame = 0;
  const renderer = new StrokeRenderer({
    context: canvas.getContext("2d")!,
    viewport,
    canvas,
    animationFrameAdapter: {
      request(callback) {
        return requestAnimationFrame((timestamp) => {
          const start = performance.now();
          callback(timestamp);
          const end = performance.now();
          work.push(end - start);
          latency.push(...pending.map((receipt) => end - receipt));
          pending = [];
          if (previousFrame) intervals.push(start - previousFrame);
          previousFrame = start;
        });
      },
      cancel: (handle) => cancelAnimationFrame(handle),
    },
  });
  let finalized = 0;
  const input = new PointerInputController({
    coordinateConverter: new CoordinateConverter(viewport),
    getCanvasBounds: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    resolveBrush: () => brush(kind),
    onStrokeStart: (update) => renderer.beginStroke(update),
    onStrokeUpdate: (update) => renderer.updateStroke(update),
    onStrokeFinalized: (stroke) => {
      renderer.finalizeStroke(stroke);
      finalized++;
    },
    onError: (error) => {
      throw error;
    },
  });
  // Synthetic dispatch cannot own native pointer capture. Only capture methods are substituted.
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  input.attach(canvas);
  const dispatch = (type: string, i: number) => {
    pending.push(performance.now());
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        isPrimary: true,
        pointerId: 71,
        pointerType: "pen",
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: 200 + (i % 1000) * 0.5,
        clientY: 350 + Math.sin(i / 8) * 30,
        pressure: 0.3 + (i % 9) / 15,
      }),
    );
  };
  try {
    dispatch("pointerdown", 0);
    for (let i = 1; i < count; i++) {
      dispatch("pointermove", i);
      if (i % samplesPerFrame === 0)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    await paint();
    pending = [];
    dispatch("pointerup", count);
    await paint();
    if (finalized !== 1) throw new Error("Input did not commit exactly one stroke");
    const prefix = `live/${kind}/${count}/${samplesPerFrame}`;
    return [
      summarize(`${prefix}/callback-work`, work.slice(3)),
      summarize(`${prefix}/input-to-callback-end`, latency.slice(samplesPerFrame * 3)),
      summarize(`${prefix}/frame-interval`, intervals.slice(3)),
    ];
  } finally {
    input.destroy();
    renderer.destroy();
    canvas.remove();
  }
}
