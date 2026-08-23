import { CoordinateConverter, Viewport } from "@folio/rendering";
import { describe, expect, it } from "vitest";
import { PageSelectionCoordinateMapper } from "../PageSelectionCoordinateMapper";

const canvasBounds = Object.freeze({ x: 50, y: 30, width: 500, height: 400 });

function screenPoint(x: number, y: number) {
  return Object.freeze({ x, y, coordinateSpace: "screen" as const });
}

function createHarness(devicePixelRatio = 2) {
  const viewport = new Viewport({
    size: { width: 1_000, height: 800 },
    pageRect: { x: 100, y: 200, width: 600, height: 700 },
    devicePixelRatio,
  });
  viewport.centerPage();
  const coordinateConverter = new CoordinateConverter(viewport);
  const mapper = new PageSelectionCoordinateMapper({
    coordinateConverter,
    viewport,
    getCanvasBounds: () => canvasBounds,
  });
  return { viewport, coordinateConverter, mapper };
}

function pagePointToScreen(coordinateConverter: CoordinateConverter, x: number, y: number) {
  const point = coordinateConverter.pageToScreen({ x, y }, canvasBounds);
  return screenPoint(point.x, point.y);
}

describe("PageSelectionCoordinateMapper", () => {
  it("maps screen points into the active page through the canonical viewport pipeline", () => {
    const { coordinateConverter, mapper } = createHarness();
    const mapped = mapper.screenToPage(pagePointToScreen(coordinateConverter, 125, 275));
    expect(mapped).toEqual({ x: 125, y: 275, coordinateSpace: "page" });
    expect(Object.isFrozen(mapped)).toBe(true);
  });

  it("remains correct while zoomed in and zoomed out", () => {
    const { viewport, coordinateConverter, mapper } = createHarness();
    viewport.zoomAt(4, { x: 420, y: 310 });
    expect(mapper.screenToPage(pagePointToScreen(coordinateConverter, 200, 300))).toEqual({
      x: 200,
      y: 300,
      coordinateSpace: "page",
    });
    viewport.zoomAt(0.25, { x: 700, y: 500 });
    expect(mapper.screenToPage(pagePointToScreen(coordinateConverter, 450, 600))).toEqual({
      x: 450,
      y: 600,
      coordinateSpace: "page",
    });
  });

  it("remains correct after camera panning", () => {
    const { viewport, coordinateConverter, mapper } = createHarness();
    viewport.panBy({ x: 170, y: -90 });
    expect(mapper.screenToPage(pagePointToScreen(coordinateConverter, 90, 640))).toEqual({
      x: 90,
      y: 640,
      coordinateSpace: "page",
    });
  });

  it("remains page-correct after combined off-center zoom and pan", () => {
    const { viewport, coordinateConverter, mapper } = createHarness();
    viewport.zoomAt(2.5, { x: 315, y: 540 });
    viewport.panBy({ x: -83, y: 117 });
    expect(mapper.screenToPage(pagePointToScreen(coordinateConverter, 413, 287))).toEqual({
      x: 413,
      y: 287,
      coordinateSpace: "page",
    });
  });

  it("uses logical canvas geometry independently of HiDPI backing-store scale", () => {
    const first = createHarness(1);
    const firstScreen = pagePointToScreen(first.coordinateConverter, 300, 350);
    const firstMapped = first.mapper.screenToPage(firstScreen);
    const second = createHarness(3);
    const secondScreen = pagePointToScreen(second.coordinateConverter, 300, 350);
    const secondMapped = second.mapper.screenToPage(secondScreen);
    expect(secondScreen).toEqual(firstScreen);
    expect(secondMapped).toEqual(firstMapped);
  });

  it("returns no page point outside the active page or without usable canvas bounds", () => {
    const { viewport, coordinateConverter, mapper } = createHarness();
    const outside = coordinateConverter.pageToScreen({ x: -1, y: 10 }, canvasBounds);
    expect(mapper.screenToPage(screenPoint(outside.x, outside.y))).toBeNull();
    const unavailable = new PageSelectionCoordinateMapper({
      coordinateConverter,
      viewport,
      getCanvasBounds: () => null,
    });
    expect(unavailable.screenToPage(screenPoint(100, 100))).toBeNull();
  });
});
