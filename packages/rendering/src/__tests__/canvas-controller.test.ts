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

function createHarness(options: { contextAvailable?: boolean; dpr?: number } = {}) {
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

  it("resizes logical and HiDPI backing stores while keeping the page centered", () => {
    const harness = createHarness({ dpr: 2 });
    harness.controller.mount(harness.container);
    harness.flushFrame();
    expect(harness.canvas.width).toBe(1_600);
    expect(harness.canvas.height).toBe(1_200);

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
  });

  it("responds to dynamic device pixel ratio changes", () => {
    const harness = createHarness({ dpr: 1 });
    harness.controller.mount(harness.container);
    harness.setDpr(1.5);
    expect(harness.canvas.width).toBe(1_200);
    expect(harness.canvas.height).toBe(900);
    expect(harness.controller.snapshot().diagnostics.devicePixelRatio).toBe(1.5);
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
