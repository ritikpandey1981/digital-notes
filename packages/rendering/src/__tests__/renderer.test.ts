import { describe, expect, it, vi } from "vitest";
import { Renderer } from "../renderer";
import { DEFAULT_RENDER_THEME } from "../types";
import { Viewport } from "../viewport";

interface ContextHarness {
  readonly context: CanvasRenderingContext2D;
  readonly calls: string[];
}

function createContext(): ContextHarness {
  const calls: string[] = [];
  const context = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    setTransform: (...values: number[]) => calls.push(`transform:${values.join(",")}`),
    clearRect: (...values: number[]) => calls.push(`clear:${values.join(",")}`),
    beginPath: () => calls.push("begin"),
    rect: (...values: number[]) => calls.push(`rect:${values.join(",")}`),
    clip: () => calls.push("clip"),
    fillRect: (...values: number[]) => calls.push(`fill:${values.join(",")}`),
    strokeRect: (...values: number[]) => calls.push(`strokeRect:${values.join(",")}`),
    translate: (...values: number[]) => calls.push(`translate:${values.join(",")}`),
    scale: (...values: number[]) => calls.push(`scale:${values.join(",")}`),
    moveTo: (...values: number[]) => calls.push(`move:${values.join(",")}`),
    lineTo: (...values: number[]) => calls.push(`line:${values.join(",")}`),
    stroke: () => calls.push("stroke"),
  } as unknown as CanvasRenderingContext2D;
  return { context, calls };
}

function createRenderer(
  background: { kind: "plain" } | { kind: "grid" } | { kind: "ruled" } = {
    kind: "plain",
  },
  overlayHooks: readonly ((context: CanvasRenderingContext2D) => void)[] = [],
) {
  const viewport = new Viewport({
    size: { width: 1_000, height: 800 },
    pageRect: { x: 0, y: 0, width: 600, height: 700 },
    devicePixelRatio: 2,
  });
  viewport.centerPage();
  const harness = createContext();
  const renderer = new Renderer({
    context: harness.context,
    viewport,
    page: { rect: viewport.pageRect, background },
    theme: DEFAULT_RENDER_THEME,
    overlayHooks,
  });
  return { ...harness, renderer, viewport };
}

describe("Renderer", () => {
  it("renders only when invalidated and clears, clips, backgrounds, and draws a page", () => {
    const { renderer, calls } = createRenderer();
    expect(renderer.render(0)).toBe(false);
    renderer.invalidate();
    expect(renderer.render(16)).toBe(true);
    expect(calls).toContain("transform:2,0,0,2,0,0");
    expect(calls).toContain("clear:0,0,1000,800");
    expect(calls).toContain("rect:0,0,1000,800");
    expect(calls).toContain("fill:0,0,600,700");
    expect(calls).toContain("strokeRect:0,0,600,700");
    expect(renderer.render(17)).toBe(false);
  });

  it("coalesces viewport, page, and rectangular invalidation", () => {
    const { renderer } = createRenderer();
    renderer.invalidate({
      kind: "rect",
      rect: { x: 1, y: 2, width: 3, height: 4 },
      coordinateSpace: "page",
    });
    renderer.invalidate({ kind: "page" });
    renderer.invalidate({ kind: "viewport" });
    expect(renderer.hasPendingInvalidation).toBe(true);
    expect(renderer.render(20)).toBe(true);
    expect(renderer.hasPendingInvalidation).toBe(false);
  });

  it.each(["grid", "ruled"] as const)("renders a %s page background", (kind) => {
    const { renderer, calls } = createRenderer({ kind });
    renderer.invalidate({ kind: "page" });
    renderer.render(1);
    expect(calls.some((call) => call.startsWith("move:"))).toBe(true);
    expect(calls).toContain("stroke");
  });

  it("invokes future overlay hooks after the page within the render transform", () => {
    const hook = vi.fn();
    const { renderer } = createRenderer({ kind: "plain" }, [hook]);
    renderer.invalidate();
    renderer.render(1);
    expect(hook).toHaveBeenCalledOnce();
    expect(Object.isFrozen(hook.mock.calls[0]?.[1])).toBe(true);
  });

  it("updates immutable page and theme inputs", () => {
    const { renderer, viewport } = createRenderer();
    renderer.setPage({
      rect: { x: 10, y: 20, width: 300, height: 400 },
      background: { kind: "plain" },
    });
    renderer.setTheme({ ...DEFAULT_RENDER_THEME, pageColor: "#123456" });
    expect(viewport.pageRect).toEqual({ x: 10, y: 20, width: 300, height: 400 });
    expect(renderer.render(4)).toBe(true);
  });

  it("destroys idempotently and rejects rendering after destruction", () => {
    const { renderer } = createRenderer();
    renderer.invalidate();
    renderer.destroy();
    renderer.destroy();
    expect(() => renderer.render(1)).toThrowError(
      expect.objectContaining({ code: "RENDERER_DESTROYED" }),
    );
    expect(() => renderer.invalidate()).toThrowError(
      expect.objectContaining({ code: "RENDERER_DESTROYED" }),
    );
  });
});
