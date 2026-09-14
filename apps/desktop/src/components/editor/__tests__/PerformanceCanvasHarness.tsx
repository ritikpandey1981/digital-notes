import { createRoot } from "react-dom/client";
import { CanvasSurface, type CanvasSurfaceProps } from "@folio/editor";
import { ProjectSession } from "@folio/editor";
import { fixture } from "../../../../../../tests/performance/fixtures";
import {
  measureAsync,
  summarize,
  type Measurement,
} from "../../../../../../tests/performance/metrics";

const root = createRoot(document.getElementById("root")!);
const paint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
type CallbackValue<T> = T extends (value: infer V) => void ? NonNullable<V> : never;
let pages: CallbackValue<CanvasSurfaceProps["onPageActionsReady"]>;
let layers: CallbackValue<CanvasSurfaceProps["onLayerActionsReady"]>;
let history: CallbackValue<CanvasSurfaceProps["onHistoryControllerReady"]>;
let manipulation: CallbackValue<CanvasSurfaceProps["onManipulationControllerReady"]>;
let styles: CallbackValue<CanvasSurfaceProps["onShapeEditingActionsReady"]>;
let lifecycle: CallbackValue<CanvasSurfaceProps["onObjectLifecycleActionsReady"]>;
let controller: CallbackValue<CanvasSurfaceProps["onControllerReady"]>;
let ordinal = 0;

async function load(count: number, layerCount = 1, pageCount = 1) {
  const project = new ProjectSession(fixture(count, layerCount, pageCount));
  await new Promise<void>((resolve) => {
    root.render(
      <CanvasSurface
        key={++ordinal}
        session={project.documentSession}
        className="h-full w-full"
        interactionMode="select"
        onControllerReady={(value) => {
          controller = value;
          resolve();
        }}
        onPageActionsReady={(value) => {
          if (value) pages = value;
        }}
        onLayerActionsReady={(value) => {
          if (value) layers = value;
        }}
        onHistoryControllerReady={(value) => {
          history = value;
        }}
        onManipulationControllerReady={(value) => {
          manipulation = value;
        }}
        onShapeEditingActionsReady={(value) => {
          if (value) styles = value;
        }}
        onObjectLifecycleActionsReady={(value) => {
          if (value) lifecycle = value;
        }}
        onError={(error) => {
          throw error;
        }}
      />,
    );
  });
  await paint();
  return project;
}

async function run(group: "document" | "layers" | "selection") {
  const values: Measurement[] = [];
  if (group === "document")
    for (const count of [1000, 5000, 10000]) {
      await load(count, 1, 2);
      let index = 0;
      values.push(
        await measureAsync(
          `canvas/${count}/page-switch-to-two-raf`,
          async () => {
            pages.setActivePage(`p${++index % 2}`);
            await paint();
          },
          10,
        ),
      );
      const samples: number[] = [];
      for (let index = 0; index < 24; index++) {
        controller.requestRender();
        const start = performance.now();
        controller.forceRender();
        if (index >= 4) samples.push(performance.now() - start);
      }
      values.push(summarize(`canvas/${count}/compositor-force-render`, samples));
    }
  if (group === "layers")
    for (const count of [1, 10, 25, 50, 100]) {
      await load(1000, count);
      let visible = true;
      values.push(
        await measureAsync(
          `canvas-layers/${count}/visibility-to-two-raf`,
          async () => {
            layers.setLayerVisible("p0-l0", (visible = !visible));
            await paint();
          },
          10,
        ),
      );
    }
  if (group === "selection")
    for (const count of [10, 100, 500, 1000]) {
      await load(count);
      const host = document.querySelector<HTMLElement>('[data-testid="canvas-surface"]')!;
      const select = () => {
        host.focus();
        host.dispatchEvent(
          new KeyboardEvent("keydown", { key: "a", code: "KeyA", ctrlKey: true, bubbles: true }),
        );
      };
      select();
      await paint();
      if (Number(host.dataset.selectedObjectCount) !== count)
        throw new Error(
          `Expected ${count} selected objects, got ${host.dataset.selectedObjectCount}`,
        );
      const origin = { x: 100, y: 100, coordinateSpace: "page" as const };
      manipulation.beginManipulation(99, origin, "translation");
      let step = 0;
      values.push(
        await measureAsync(
          `canvas-selection/${count}/move-preview-to-two-raf`,
          async () => {
            manipulation.updateManipulation(99, { ...origin, x: 110 + (step++ % 2) });
            await paint();
          },
          count >= 500 ? 1 : 10,
          count >= 500 ? 0 : 3,
        ),
      );
      manipulation.cancelManipulation(99);
      await paint();
      if (count <= 100)
        values.push(
          await measureAsync(
            `canvas-selection/${count}/style-preview-cancel-to-two-raf`,
            async () => {
              styles.beginContinuousStyleEdit();
              styles.updateContinuousStylePreview({ strokeColor: "#ff0000" });
              await paint();
              styles.cancelContinuousStyleEdit();
              await paint();
            },
            10,
          ),
        );
      if (count <= 100)
        values.push(
          await measureAsync(
            `canvas-selection/${count}/delete-undo-redo-undo-to-two-raf`,
            async () => {
              select();
              if (!lifecycle.deleteSelection()) throw new Error("Delete failed");
              await paint();
              history.undo();
              await paint();
              history.redo();
              await paint();
              history.undo();
              await paint();
            },
            5,
          ),
        );
    }
  await load(10000);
  return values;
}

window.canvasBaseline = { run };
declare global {
  interface Window {
    canvasBaseline: { run: typeof run };
  }
}
