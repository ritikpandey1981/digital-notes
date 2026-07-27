import { describe, expect, it } from "vitest";
import { CoordinateConverter } from "../coordinate-converter";
import { Viewport } from "../viewport";

function setup() {
  const viewport = new Viewport({
    size: { width: 1_000, height: 800 },
    pageRect: { x: 100, y: 200, width: 600, height: 900 },
  });
  viewport.camera.setPosition({ x: 400, y: 650 });
  viewport.camera.setZoom(2);
  return { viewport, converter: new CoordinateConverter(viewport) };
}

describe("CoordinateConverter", () => {
  it("converts screen and logical canvas coordinates with CSS scaling", () => {
    const { converter } = setup();
    const bounds = { x: 50, y: 80, width: 500, height: 400 };
    expect(converter.screenToCanvas({ x: 300, y: 280 }, bounds)).toEqual({
      x: 500,
      y: 400,
    });
    expect(converter.canvasToScreen({ x: 500, y: 400 }, bounds)).toEqual({
      x: 300,
      y: 280,
    });
  });

  it("keeps canvas and viewport coordinates explicit and reversible", () => {
    const { converter } = setup();
    const point = { x: 123, y: 456 };
    expect(converter.canvasToViewport(point)).toEqual(point);
    expect(converter.viewportToCanvas(point)).toEqual(point);
    expect(converter.canvasToViewport(point)).not.toBe(point);
  });

  it("converts viewport and world coordinates reversibly", () => {
    const { converter } = setup();
    const viewportPoint = { x: 600, y: 500 };
    const world = converter.viewportToWorld(viewportPoint);
    expect(world).toEqual({ x: 450, y: 700 });
    expect(converter.worldToViewport(world)).toEqual(viewportPoint);
  });

  it("converts world and page coordinates reversibly", () => {
    const { converter } = setup();
    const world = { x: 250, y: 460 };
    const page = converter.worldToPage(world);
    expect(page).toEqual({ x: 150, y: 260 });
    expect(converter.pageToWorld(page)).toEqual(world);
  });

  it("converts the entire screen-to-page chain without leaking coordinate math", () => {
    const { converter } = setup();
    const bounds = { x: 50, y: 80, width: 1_000, height: 800 };
    const screen = { x: 650, y: 580 };
    const page = converter.screenToPage(screen, bounds);
    expect(page).toEqual({ x: 350, y: 500 });
    expect(converter.pageToScreen(page, bounds)).toEqual(screen);
  });

  it("rejects unusable canvas bounds", () => {
    const { converter } = setup();
    expect(() =>
      converter.screenToCanvas({ x: 0, y: 0 }, { x: 0, y: 0, width: 0, height: 100 }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_GEOMETRY" }));
  });
});
