import { describe, expect, it } from "vitest";
import { Camera } from "../camera";
import { Renderer } from "../renderer";
import { DEFAULT_RENDER_THEME, type PageBackground, type RenderPage } from "../types";
import { Viewport } from "../viewport";

interface RecordedCall {
  readonly name: string;
  readonly args: readonly unknown[];
}

function recordingContext(calls: RecordedCall[]): CanvasRenderingContext2D {
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push({ name, args });
    };
  const context = {
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    rect: record("rect"),
    clip: record("clip"),
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    strokeRect: record("strokeRect"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arc: record("arc"),
    stroke: record("stroke"),
    fill: record("fill"),
    translate: record("translate"),
    scale: record("scale"),
    rotate: record("rotate"),
    setTransform: record("setTransform"),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  return context as unknown as CanvasRenderingContext2D;
}

function renderWith(background: PageBackground, zoom: number, paperColor?: string): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const viewport = new Viewport({
    size: { width: 800, height: 600 },
    pageRect: { x: 0, y: 0, width: 400, height: 400 },
    camera: new Camera({ zoom }),
  });
  const page: RenderPage = {
    rect: { x: 0, y: 0, width: 400, height: 400 },
    background,
    ...(paperColor === undefined ? {} : { paperColor }),
  };
  const renderer = new Renderer({
    context: recordingContext(calls),
    viewport,
    page,
    theme: DEFAULT_RENDER_THEME,
  });
  renderer.invalidate({ kind: "viewport" });
  renderer.render(0);
  return calls;
}

const patternCalls = (calls: readonly RecordedCall[], name: string): readonly RecordedCall[] =>
  calls.filter((call) => call.name === name);

describe("page paper rendering", () => {
  it("draws nothing extra for blank paper", () => {
    const calls = renderWith({ kind: "plain" }, 1);
    expect(patternCalls(calls, "moveTo")).toHaveLength(0);
    expect(patternCalls(calls, "arc")).toHaveLength(0);
  });

  it("anchors ruled lines to page space, not screen space", () => {
    const atOne = patternCalls(renderWith({ kind: "ruled", spacing: 40 }, 1), "moveTo");
    const atFour = patternCalls(renderWith({ kind: "ruled", spacing: 40 }, 4), "moveTo");
    // Zooming magnifies the same physical paper: the line count is unchanged.
    expect(atOne).toHaveLength(9);
    expect(atFour).toHaveLength(9);
    expect(atOne[0]?.args).toEqual([0, 40]);
    expect(atFour[0]?.args).toEqual([0, 40]);
  });

  it("adds vertical lines only for grid paper", () => {
    const ruled = patternCalls(renderWith({ kind: "ruled", spacing: 40 }, 1), "moveTo");
    const grid = patternCalls(renderWith({ kind: "grid", spacing: 40 }, 1), "moveTo");
    expect(grid.length).toBe(ruled.length * 2);
  });

  it("draws dotted paper as a page-anchored dot lattice", () => {
    const dots = patternCalls(renderWith({ kind: "dotted", spacing: 40 }, 1), "arc");
    expect(dots).toHaveLength(81);
    expect(dots[0]?.args.slice(0, 2)).toEqual([40, 40]);
    expect(patternCalls(renderWith({ kind: "dotted", spacing: 40 }, 1), "fill")).toHaveLength(1);
  });

  it("draws isometric paper without generating objects", () => {
    const calls = renderWith({ kind: "isometric", spacing: 40 }, 1);
    expect(patternCalls(calls, "moveTo").length).toBeGreaterThan(0);
    expect(patternCalls(calls, "stroke").length).toBeGreaterThan(0);
  });

  it("skips imperceptibly dense patterns instead of drawing millions of primitives", () => {
    // 4 page units at 0.25 zoom is one screen pixel: below the visibility floor.
    const dense = renderWith({ kind: "grid", spacing: 4 }, 0.25);
    expect(patternCalls(dense, "moveTo")).toHaveLength(0);
    const denseDots = renderWith({ kind: "dotted", spacing: 4 }, 0.25);
    expect(patternCalls(denseDots, "arc")).toHaveLength(0);
  });

  it("clips every pattern strictly to the page rectangle", () => {
    for (const kind of ["ruled", "grid", "dotted", "isometric"] as const) {
      const calls = renderWith({ kind, spacing: 40 }, 1);
      const patternIndex = calls.findIndex((call) => call.name === "moveTo" || call.name === "arc");
      expect(patternIndex).toBeGreaterThan(-1);
      // The clip immediately preceding the pattern is the page rectangle.
      const clipRect = calls
        .slice(0, patternIndex)
        .reverse()
        .find((call) => call.name === "rect");
      expect(clipRect?.args).toEqual([0, 0, 400, 400]);
    }
  });

  it("fills the page with page-owned paper color when present", () => {
    const withColor = renderWith({ kind: "plain" }, 1, "#fbf3e0");
    const pageFill = patternCalls(withColor, "fillRect").find(
      (call) => JSON.stringify(call.args) === JSON.stringify([0, 0, 400, 400]),
    );
    expect(pageFill).toBeDefined();
  });
});

describe("viewport page geometry", () => {
  function fitFor(width: number, height: number): Readonly<{ fitPage: number; fitWidth: number }> {
    const viewport = new Viewport({
      size: { width: 1000, height: 800 },
      pageRect: { x: 0, y: 0, width, height },
    });
    const padding = { top: 24, right: 24, bottom: 24, left: 24 };
    const fitPage = viewport.fitPage(padding);
    const fitWidth = viewport.fitWidth(padding);
    return Object.freeze({ fitPage, fitWidth });
  }

  it("fits every supported page shape inside the viewport", () => {
    for (const [width, height] of [
      [794, 1123],
      [1123, 794],
      [559, 794],
      [816, 1056],
      [900, 900],
      [4000, 300],
      [300, 4000],
    ] as const) {
      const { fitPage, fitWidth } = fitFor(width, height);
      expect(fitPage).toBeGreaterThan(0);
      expect(Number.isFinite(fitPage)).toBe(true);
      // Fit Page shows the whole page in both axes, except where the camera's
      // 0.25 minimum zoom clamps an extreme banner page.
      const clamped = fitPage <= 0.25 + 0.0001;
      if (!clamped) {
        expect(width * fitPage).toBeLessThanOrEqual(1000 - 48 + 0.001);
        expect(height * fitPage).toBeLessThanOrEqual(800 - 48 + 0.001);
      }
      // Fit Width fills the available width unless the camera zoom range clamps it.
      expect(width * fitWidth).toBeLessThanOrEqual(Math.max(1000 - 48, width * 0.25) + 0.001);
      expect(fitWidth).toBeGreaterThanOrEqual(fitPage - 0.001);
    }
  });

  it("recomputes fit after the page rectangle changes", () => {
    const viewport = new Viewport({
      size: { width: 1000, height: 800 },
      pageRect: { x: 0, y: 0, width: 794, height: 1123 },
    });
    const padding = { top: 24, right: 24, bottom: 24, left: 24 };
    const portrait = viewport.fitPage(padding);
    viewport.setPageRect({ x: 0, y: 0, width: 1123, height: 794 });
    const landscape = viewport.fitPage(padding);
    expect(landscape).not.toBeCloseTo(portrait, 5);
    expect(1123 * landscape).toBeLessThanOrEqual(1000 - 48 + 0.001);
  });
});
