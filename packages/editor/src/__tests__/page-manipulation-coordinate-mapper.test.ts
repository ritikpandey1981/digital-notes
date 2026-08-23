import { CoordinateConverter, Viewport } from "@folio/rendering";
import { describe, expect, it } from "vitest";
import { PageManipulationCoordinateMapper } from "../PageManipulationCoordinateMapper";

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
  const mapper = new PageManipulationCoordinateMapper({
    coordinateConverter,
    viewport,
    getCanvasBounds: () => canvasBounds,
  });
  return { viewport, coordinateConverter, mapper };
}

function pageToScreen(converter: CoordinateConverter, x: number, y: number) {
  const point = converter.pageToScreen({ x, y }, canvasBounds);
  return screenPoint(point.x, point.y);
}

describe("PageManipulationCoordinateMapper", () => {
  it.each([0.25, 1, 4])("uses canonical page coordinates at %sx zoom", (zoom) => {
    const { viewport, coordinateConverter, mapper } = createHarness();
    viewport.zoomAt(zoom, { x: 420, y: 310 });
    expect(mapper.screenToPage(pageToScreen(coordinateConverter, 225, 375))).toEqual({
      x: 225,
      y: 375,
      coordinateSpace: "page",
    });
  });

  it("remains correct after panning and independently of HiDPI backing scale", () => {
    const first = createHarness(1);
    const second = createHarness(3);
    first.viewport.panBy({ x: 90, y: -60 });
    second.viewport.panBy({ x: 90, y: -60 });
    const firstScreen = pageToScreen(first.coordinateConverter, 120, 500);
    const secondScreen = pageToScreen(second.coordinateConverter, 120, 500);
    expect(secondScreen).toEqual(firstScreen);
    expect(first.mapper.screenToPage(firstScreen)).toEqual({
      x: 120,
      y: 500,
      coordinateSpace: "page",
    });
    expect(second.mapper.screenToPage(secondScreen)).toEqual(
      first.mapper.screenToPage(firstScreen),
    );
  });

  it("keeps captured manipulation points page-correct after combined zoom and pan", () => {
    const { viewport, coordinateConverter, mapper } = createHarness();
    viewport.zoomAt(3, { x: 740, y: 165 });
    viewport.panBy({ x: 130, y: -75 });
    const transformed = pageToScreen(coordinateConverter, 487, 612);
    expect(mapper.screenToPage(transformed, true)).toEqual({
      x: 487,
      y: 612,
      coordinateSpace: "page",
    });
  });

  it("clips session starts to the page but permits captured drags beyond it", () => {
    const { coordinateConverter, mapper } = createHarness();
    const outside = pageToScreen(coordinateConverter, -25, 50);
    expect(mapper.screenToPage(outside)).toBeNull();
    expect(mapper.screenToPage(outside, true)).toEqual({
      x: -25,
      y: 50,
      coordinateSpace: "page",
    });
  });

  it("returns null when canvas geometry is unavailable", () => {
    const { viewport, coordinateConverter } = createHarness();
    const mapper = new PageManipulationCoordinateMapper({
      coordinateConverter,
      viewport,
      getCanvasBounds: () => null,
    });
    expect(mapper.screenToPage(screenPoint(100, 100), true)).toBeNull();
  });
});
