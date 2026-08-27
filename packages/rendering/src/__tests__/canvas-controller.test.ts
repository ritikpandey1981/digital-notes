import { describe, expect, it, vi } from "vitest";
import { CanvasController } from "../canvas-controller";
import type { AnimationFrameAdapter } from "../types";

function createContext(): CanvasRenderingContext2D {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function createHarness(
  options: { contextAvailable?: boolean; dpr?: number; overlayContextAvailable?: boolean } = {},
) {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const context = createContext();
  let contextAvailable = options.contextAvailable ?? true;
  const canvas = {
    width: 0,
    height: 0,
    dataset: {} as DOMStringMap,
    style: {} as CSSStyleDeclaration,
    parentElement: null as HTMLElement | null,
    getContext: vi.fn(() => (contextAvailable ? context : null)),
    setAttribute: vi.fn(),
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const group = listeners.get(type) ?? new Set();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as HTMLCanvasElement;

  const children: HTMLCanvasElement[] = [];
  const overlays: HTMLCanvasElement[] = [];
  const overlayContexts: CanvasRenderingContext2D[] = [];
  const container = {
    appendChild(child: HTMLCanvasElement) {
      children.push(child);
      Object.defineProperty(child, "parentElement", {
        configurable: true,
        value: container,
        writable: true,
      });
      return child;
    },
    removeChild(child: HTMLCanvasElement) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      Object.defineProperty(child, "parentElement", {
        configurable: true,
        value: null,
        writable: true,
      });
      return child;
    },
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
  } as unknown as HTMLElement;

  let resizeCallback: globalThis.ResizeObserverCallback | null = null;
  const observe = vi.fn();
  const disconnect = vi.fn();
  const resizeObserverFactory = vi.fn((callback: globalThis.ResizeObserverCallback) => {
    resizeCallback = callback;
    return { observe, disconnect };
  });

  let nextFrame = 1;
  const frameCallbacks = new Map<number, FrameRequestCallback>();
  const animationFrameAdapter: AnimationFrameAdapter = {
    request(callback) {
      const handle = nextFrame++;
      frameCallbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      frameCallbacks.delete(handle);
    },
  };
  const flushFrame = (timestamp = 16) => {
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    callbacks.forEach((callback) => callback(timestamp));
  };

  let dpr = options.dpr ?? 1;
  let dprListener: (() => void) | null = null;
  const stopDpr = vi.fn();
  const observeDevicePixelRatio = vi.fn((listener: () => void) => {
    dprListener = listener;
    return stopDpr;
  });
  const errors: Error[] = [];
  let time = 0;

  const controller = new CanvasController({
    canvasFactory: () => canvas,
    overlayCanvasFactory: () => {
      const overlayContext = createContext();
      const overlay = {
        width: 0,
        height: 0,
        dataset: {} as DOMStringMap,
        style: {} as CSSStyleDeclaration,
        parentElement: null as HTMLElement | null,
        getContext: vi.fn(() =>
          options.overlayContextAvailable === false ? null : overlayContext,
        ),
        setAttribute: vi.fn(),
      } as unknown as HTMLCanvasElement;
      overlays.push(overlay);
      overlayContexts.push(overlayContext);
      return overlay;
    },
    resizeObserverFactory,
    animationFrameAdapter,
    getDevicePixelRatio: () => dpr,
    observeDevicePixelRatio,
    now: () => time++,
    onError: (error) => errors.push(error),
  });

  const dispatch = (type: string, event: Event) => {
    for (const listener of listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  };

  const emitResize = (width: number, height: number) => {
    const callback = resizeCallback as globalThis.ResizeObserverCallback | null;
    if (callback === null) throw new Error("Resize observer was not installed.");
    callback([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver);
  };

  return {
    controller,
    canvas,
    context,
    container,
    children,
    overlays,
    overlayContexts,
    listeners,
    observe,
    disconnect,
    frameCallbacks,
    flushFrame,
    emitResize,
    errors,
    stopDpr,
    setDpr(value: number) {
      dpr = value;
      dprListener?.();
    },
    setContextAvailable(value: boolean) {
      contextAvailable = value;
    },
    dispatch,
  };
}

describe("CanvasController", () => {
  it("owns canvas creation, mounting, initial fit, rendering, and disposal", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    expect(harness.controller.status).toBe("mounted");
    expect(harness.children).toEqual([harness.canvas]);
    expect(harness.observe).toHaveBeenCalledWith(harness.container);
    expect(harness.canvas.width).toBe(800);
    expect(harness.canvas.height).toBe(600);
    expect(harness.frameCallbacks.size).toBe(1);

    harness.flushFrame();
    expect(harness.controller.snapshot().diagnostics.renderCount).toBe(1);
    expect(harness.canvas.dataset.renderCount).toBe("1");
    expect(harness.frameCallbacks.size).toBe(0);

    harness.controller.destroy();
    harness.controller.destroy();
    expect(harness.controller.status).toBe("destroyed");
    expect(harness.children).toEqual([]);
    expect(harness.disconnect).toHaveBeenCalledOnce();
    expect(harness.stopDpr).toHaveBeenCalledOnce();
    expect(harness.listeners.get("contextlost")?.size).toBe(0);
    expect(() => harness.controller.requestRender()).toThrowError(
      expect.objectContaining({ code: "CONTROLLER_DESTROYED" }),
    );
  });

  it("coalesces invalidation and never continuously repaints", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    harness.controller.requestRender({ kind: "page" });
    harness.controller.requestRender({
      kind: "rect",
      rect: { x: 1, y: 1, width: 10, height: 10 },
      coordinateSpace: "page",
    });
    expect(harness.frameCallbacks.size).toBe(1);
    harness.flushFrame();
    expect(harness.controller.snapshot().diagnostics.renderCount).toBe(1);
    expect(harness.frameCallbacks.size).toBe(0);
  });

  it("supports cancel and force rendering", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    harness.controller.cancelRender();
    expect(harness.frameCallbacks.size).toBe(0);
    harness.controller.forceRender();
    expect(harness.controller.snapshot().diagnostics.renderCount).toBe(1);
  });

  it("flushes only already-pending rendering without adding invalidation", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    const invalidations = harness.controller.snapshot().diagnostics.invalidationCount;
    expect(harness.controller.flushRender()).toBe(true);
    expect(harness.frameCallbacks.size).toBe(0);
    expect(harness.controller.snapshot().diagnostics.renderCount).toBe(1);
    expect(harness.controller.snapshot().diagnostics.invalidationCount).toBe(invalidations);
    expect(harness.controller.flushRender()).toBe(false);
    expect(harness.controller.snapshot().diagnostics.renderCount).toBe(1);
  });

  it("resizes logical and HiDPI backing stores while recomputing Fit Page", () => {
    const harness = createHarness({ dpr: 2 });
    harness.controller.mount(harness.container);
    harness.flushFrame();
    expect(harness.canvas.width).toBe(1_600);
    expect(harness.canvas.height).toBe(1_200);
    const initialZoom = harness.controller.viewport?.camera.zoom;

    harness.emitResize(1_000, 700);
    harness.flushFrame();
    const snapshot = harness.controller.snapshot();
    const page = snapshot.viewport?.pageViewportRect;
    expect(snapshot.diagnostics.canvasPhysicalSize).toEqual({
      width: 2_000,
      height: 1_400,
    });
    expect((page?.x ?? 0) + (page?.width ?? 0) / 2).toBe(500);
    expect((page?.y ?? 0) + (page?.height ?? 0) / 2).toBe(350);
    expect(snapshot.viewport?.camera.zoom).not.toBe(initialZoom);
    expect(snapshot.viewportMode).toBe("fit-page");
  });

  it("clamps manual zoom, preserves a pointer anchor, and pans in viewport pixels", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    const viewport = harness.controller.viewport;
    if (viewport === null) throw new Error("Viewport was not mounted.");
    const anchor = { x: 450, y: 300 };
    const anchoredWorldPoint = viewport.viewportToWorld(anchor);

    expect(harness.controller.zoomAt(20, anchor)).toBe(8);
    expect(viewport.viewportToWorld(anchor)).toEqual(anchoredWorldPoint);
    const positionBeforePan = viewport.camera.position;
    harness.controller.panBy({ x: 80, y: -40 });
    expect(viewport.camera.position).toEqual({
      x: positionBeforePan.x - 10,
      y: positionBeforePan.y + 5,
    });
    expect(harness.controller.setZoom(0.01)).toBe(0.25);
    expect(harness.controller.viewportMode).toBe("manual");
  });

  it("preserves manual camera position across canvas resize", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    harness.controller.panBy({ x: 140, y: -70 });
    const position = harness.controller.viewport?.camera.position;

    harness.emitResize(1_100, 720);

    expect(harness.controller.viewportMode).toBe("manual");
    expect(harness.controller.viewport?.camera.position).toEqual(position);
  });

  it("recomputes Fit Width across resize with fixed horizontal and top margins", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    harness.controller.fitWidth();
    expect(harness.controller.viewport?.pageViewportRect.x).toBeCloseTo(56);
    expect(harness.controller.viewport?.pageViewportRect.y).toBeCloseTo(88);

    harness.emitResize(1_000, 720);

    expect(harness.controller.viewportMode).toBe("fit-width");
    expect(harness.controller.viewport?.pageViewportRect.x).toBeCloseTo(56);
    expect(harness.controller.viewport?.pageViewportRect.y).toBeCloseTo(88);
  });

  it("responds to dynamic device pixel ratio changes", () => {
    const harness = createHarness({ dpr: 1 });
    harness.controller.mount(harness.container);
    harness.setDpr(1.5);
    expect(harness.canvas.width).toBe(1_200);
    expect(harness.canvas.height).toBe(900);
    expect(harness.controller.snapshot().diagnostics.devicePixelRatio).toBe(1.5);
  });

  it("owns independently resizable interactive overlay canvas layers", () => {
    const harness = createHarness({ dpr: 2 });
    harness.controller.mount(harness.container);
    const layer = harness.controller.createOverlayLayer({
      name: "ink",
      interactive: true,
      ariaLabel: "Ink input surface",
    });
    const resizeHandler = vi.fn();
    layer.setResizeHandler(resizeHandler);

    expect(harness.children).toEqual([harness.canvas, layer.canvas]);
    expect(layer.canvas.width).toBe(1_600);
    expect(layer.canvas.height).toBe(1_200);
    expect(layer.canvas.dataset.folioLayer).toBe("ink");
    expect(layer.canvas.style.pointerEvents).toBe("auto");
    expect(layer.canvas.style.touchAction).toBe("none");
    expect(layer.canvas.setAttribute).toHaveBeenCalledWith("aria-label", "Ink input surface");

    harness.emitResize(1_000, 700);
    expect(layer.canvas.width).toBe(2_000);
    expect(layer.canvas.height).toBe(1_400);
    expect(resizeHandler).toHaveBeenCalledOnce();

    layer.destroy();
    layer.destroy();
    expect(harness.children).toEqual([harness.canvas]);
  });

  it("reports unavailable overlay contexts and disposes overlays with the controller", () => {
    const missing = createHarness({ overlayContextAvailable: false });
    missing.controller.mount(missing.container);
    expect(() => missing.controller.createOverlayLayer({ name: "ink" })).toThrowError(
      expect.objectContaining({ code: "CANVAS_CONTEXT_UNAVAILABLE" }),
    );

    const harness = createHarness();
    harness.controller.mount(harness.container);
    harness.controller.createOverlayLayer({ name: "ink" });
    harness.controller.destroy();
    expect(harness.children).toHaveLength(0);
  });

  it("updates page and theme through public immutable render inputs", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    harness.controller.setPage({
      rect: { x: 10, y: 20, width: 500, height: 700 },
      background: { kind: "plain" },
    });
    harness.controller.setTheme({
      workspaceColor: "#000",
      pageColor: "#111",
      pageBorderColor: "#222",
      pageShadowColor: "#333",
      pageLineColor: "#444",
    });
    harness.flushFrame();
    expect(harness.controller.viewport?.pageRect).toEqual({
      x: 10,
      y: 20,
      width: 500,
      height: 700,
    });
  });

  it("updates immutable page presentation without moving the active camera", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    harness.controller.setZoom(1.75);
    harness.controller.panBy({ x: 45, y: -30 });
    const before = harness.controller.snapshot();

    harness.controller.updatePage({
      rect: { x: 0, y: 0, width: 900, height: 600 },
      background: { kind: "grid", spacing: 24 },
      paperColor: "#fbf3e0",
    });
    const after = harness.controller.snapshot();

    expect(after.viewport?.pageRect).toEqual({ x: 0, y: 0, width: 900, height: 600 });
    expect(after.viewport?.camera).toEqual(before.viewport?.camera);
    expect(after.viewportMode).toBe(before.viewportMode);
    expect(after.diagnostics.invalidationCount).toBeGreaterThan(
      before.diagnostics.invalidationCount,
    );
  });

  it("handles context loss and restoration with structured diagnostics", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    const preventDefault = vi.fn();
    harness.dispatch("contextlost", { preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(harness.controller.status).toBe("context-lost");
    expect(harness.controller.snapshot().diagnostics.contextLossCount).toBe(1);
    expect(harness.errors[0]).toMatchObject({ code: "CONTEXT_LOST" });
    expect(() => harness.controller.requestRender()).toThrowError(
      expect.objectContaining({ code: "CONTEXT_LOST" }),
    );

    harness.dispatch("contextrestored", {} as Event);
    expect(harness.controller.status).toBe("mounted");
    expect(harness.frameCallbacks.size).toBe(1);
  });

  it("reports restoration failure and remains context-lost", () => {
    const harness = createHarness();
    harness.controller.mount(harness.container);
    harness.dispatch("contextlost", { preventDefault: vi.fn() } as unknown as Event);
    harness.setContextAvailable(false);
    harness.dispatch("contextrestored", {} as Event);
    expect(harness.controller.status).toBe("context-lost");
    expect(harness.errors.at(-1)).toMatchObject({
      code: "CONTEXT_RESTORATION_FAILED",
    });
  });

  it("rejects unavailable contexts, invalid resize, duplicate mount, and use before mount", () => {
    const missing = createHarness({ contextAvailable: false });
    expect(() => missing.controller.mount(missing.container)).toThrowError(
      expect.objectContaining({ code: "CANVAS_CONTEXT_UNAVAILABLE" }),
    );
    const harness = createHarness();
    expect(() => harness.controller.forceRender()).toThrowError(
      expect.objectContaining({ code: "CONTROLLER_NOT_MOUNTED" }),
    );
    harness.controller.mount(harness.container);
    expect(() => harness.controller.mount(harness.container)).toThrowError(
      expect.objectContaining({ code: "CANVAS_ALREADY_MOUNTED" }),
    );
    expect(() => harness.controller.resize({ width: -1, height: 5 })).toThrowError(
      expect.objectContaining({ code: "INVALID_GEOMETRY" }),
    );
  });

  it("can be recreated without retaining observers, listeners, or pending frames", () => {
    const first = createHarness();
    first.controller.mount(first.container);
    first.controller.destroy();
    expect(first.frameCallbacks.size).toBe(0);
    expect(first.children).toHaveLength(0);

    const second = createHarness();
    second.controller.mount(second.container);
    second.flushFrame();
    expect(second.controller.snapshot().diagnostics.renderCount).toBe(1);
    expect(second.children).toHaveLength(1);
  });
});
