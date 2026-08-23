import { describe, expect, it } from "vitest";
import { Camera } from "../camera";
import { RenderingError } from "../errors";
import { MINIMUM_VISIBLE_PAGE_PIXELS, Viewport } from "../viewport";

const page = { x: 10, y: 20, width: 800, height: 1_000 };
const padding = { top: 50, right: 50, bottom: 50, left: 50 };

describe("Camera", () => {
  it("supports pan, zoom, reset, page centering, and immutable snapshots", () => {
    const camera = new Camera();
    camera.panBy({ x: 25, y: -10 });
    camera.setZoom(2);
    expect(camera.snapshot()).toEqual({
      position: { x: 25, y: -10 },
      zoom: 2,
      rotation: 0,
    });
    expect(Object.isFrozen(camera.snapshot())).toBe(true);

    camera.centerPage(page);
    expect(camera.position).toEqual({ x: 410, y: 520 });
    camera.reset();
    expect(camera.snapshot()).toEqual({
      position: { x: 0, y: 0 },
      zoom: 1,
      rotation: 0,
    });
  });

  it("fits a page while honoring padding and zoom limits", () => {
    const camera = new Camera();
    expect(camera.fitPage(page, { width: 900, height: 1_100 }, padding)).toBe(1);
    expect(camera.position).toEqual({ x: 410, y: 520 });
    expect(camera.fitPage(page, { width: 10_000, height: 10_000 }, padding)).toBe(8);
    expect(camera.fitPage(page, { width: 20, height: 20 }, padding)).toBe(0.25);
  });

  it("rejects invalid zoom values and ranges with structured errors", () => {
    expect(() => new Camera({ minZoom: 0, maxZoom: 8 })).toThrowError(RenderingError);
    expect(() => new Camera({ minZoom: 2, maxZoom: 1 })).toThrowError(RenderingError);
    expect(() => new Camera().setZoom(8.01)).toThrowError(
      expect.objectContaining({ code: "INVALID_ZOOM" }),
    );
  });
});

describe("Viewport", () => {
  it("owns camera, page, viewport, world bounds, DPR, and visible geometry", () => {
    const viewport = new Viewport({
      size: { width: 1_000, height: 800 },
      pageRect: page,
      devicePixelRatio: 2,
    });
    viewport.centerPage();
    const snapshot = viewport.snapshot();

    expect(snapshot.devicePixelRatio).toBe(2);
    expect(snapshot.pageViewportRect).toEqual({
      x: 100,
      y: -100,
      width: 800,
      height: 1_000,
    });
    expect(snapshot.visibleWorldRect).toEqual({
      x: -90,
      y: 120,
      width: 1_000,
      height: 800,
    });
    expect(snapshot.worldBounds.width).toBeGreaterThan(page.width);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("fits and keeps the page centered across resize", () => {
    const viewport = new Viewport({
      size: { width: 900, height: 1_100 },
      pageRect: page,
    });
    viewport.fitPage(padding);
    expect(viewport.pageViewportRect).toEqual({
      x: 50,
      y: 50,
      width: 800,
      height: 1_000,
    });

    viewport.resize({ width: 1_200, height: 900 }, 1.5);
    viewport.centerPage();
    expect(viewport.pageViewportRect.x + viewport.pageViewportRect.width / 2).toBe(600);
    expect(viewport.pageViewportRect.y + viewport.pageViewportRect.height / 2).toBe(450);
  });

  it("fits width with a horizontal gutter and a stable page-top margin", () => {
    const viewport = new Viewport({
      size: { width: 1_000, height: 800 },
      pageRect: page,
    });

    expect(viewport.fitWidth(padding)).toBe(1.125);
    expect(viewport.pageViewportRect).toEqual({
      x: 50,
      y: 50,
      width: 900,
      height: 1_125,
    });
  });

  it("pans and zooms around an anchored viewport point", () => {
    const viewport = new Viewport({
      size: { width: 1_000, height: 800 },
      pageRect: page,
    });
    viewport.centerPage();
    const anchor = { x: 250, y: 300 };
    const before = viewport.viewportToWorld(anchor);
    viewport.zoomAt(2, anchor);
    expect(viewport.viewportToWorld(anchor)).toEqual(before);
    viewport.panBy({ x: 10, y: 20 });
    expect(viewport.camera.position).toEqual({ x: 295, y: 490 });
  });

  it.each([0.25, 1, 2, 8])(
    "keeps at least 64 screen pixels recoverable at %sx zoom on every pan boundary",
    (zoom) => {
      const viewport = new Viewport({
        size: { width: 1_000, height: 800 },
        pageRect: page,
      });
      viewport.centerPage();
      viewport.zoomAt(zoom, { x: 500, y: 400 });

      for (const delta of [
        { x: -1_000_000, y: 0 },
        { x: 1_000_000, y: 0 },
        { x: 0, y: -1_000_000 },
        { x: 0, y: 1_000_000 },
        { x: -1_000_000, y: 1_000_000 },
      ]) {
        viewport.panBy(delta);
        expect(visiblePageExtent(viewport).width).toBeGreaterThanOrEqual(
          MINIMUM_VISIBLE_PAGE_PIXELS - 1e-9,
        );
        expect(visiblePageExtent(viewport).height).toBeGreaterThanOrEqual(
          MINIMUM_VISIBLE_PAGE_PIXELS - 1e-9,
        );
      }

      viewport.panBy({ x: 1_000_000, y: 1_000_000 });
      const boundary = viewport.camera.position;
      viewport.panBy({ x: 1_000_000, y: 1_000_000 });
      expect(viewport.camera.position).toEqual(boundary);
    },
  );

  it("preserves a manual camera on resize unless recoverability requires a minimal clamp", () => {
    const viewport = new Viewport({
      size: { width: 1_000, height: 800 },
      pageRect: page,
    });
    viewport.centerPage();
    viewport.panBy({ x: 1_000_000, y: 1_000_000 });
    viewport.resize({ width: 320, height: 240 });

    expect(visiblePageExtent(viewport)).toMatchObject({
      width: MINIMUM_VISIBLE_PAGE_PIXELS,
      height: MINIMUM_VISIBLE_PAGE_PIXELS,
    });
  });

  it("updates page and world rectangles and rejects invalid viewport state", () => {
    const viewport = new Viewport({ size: { width: 1, height: 1 }, pageRect: page });
    const nextPage = { x: -20, y: -30, width: 400, height: 600 };
    const bounds = { x: -1_000, y: -1_000, width: 2_000, height: 2_000 };
    viewport.setPageRect(nextPage);
    viewport.setWorldBounds(bounds);
    expect(viewport.pageRect).toEqual(nextPage);
    expect(viewport.worldBounds).toEqual(bounds);
    expect(() => viewport.resize({ width: -1, height: 5 })).toThrowError(
      expect.objectContaining({ code: "INVALID_GEOMETRY" }),
    );
    expect(() => viewport.resize({ width: 1, height: 1 }, 0)).toThrowError(
      expect.objectContaining({ code: "INVALID_DPR" }),
    );
  });
});

function visiblePageExtent(viewport: Viewport): Readonly<{ width: number; height: number }> {
  const rect = viewport.pageViewportRect;
  return {
    width: Math.max(0, Math.min(rect.x + rect.width, viewport.size.width) - Math.max(rect.x, 0)),
    height: Math.max(0, Math.min(rect.y + rect.height, viewport.size.height) - Math.max(rect.y, 0)),
  };
}
