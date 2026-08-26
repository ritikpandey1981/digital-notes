import { describe, expect, it, vi } from "vitest";
import {
  createCanvasArtworkColorSampler,
  resolveArtworkSampleCoordinates,
} from "../ArtworkColorSampler";

describe("ArtworkColorSampler coordinate conversion", () => {
  it.each([1, 1.5, 2])(
    "maps offset client coordinates through an actual %s backing ratio",
    (ratio) => {
      expect(
        resolveArtworkSampleCoordinates(
          {
            canvasRect: { left: 10, top: 20, width: 200, height: 100 },
            logicalSize: { width: 200, height: 100 },
            backingSize: { width: 200 * ratio, height: 100 * ratio },
            pageViewportRect: { x: 0, y: 0, width: 200, height: 100 },
          },
          { clientX: 60, clientY: 45 },
        ),
      ).toEqual({
        status: "success",
        backingPoint: { x: Math.floor(50 * ratio), y: Math.floor(25 * ratio) },
      });
    },
  );

  it("uses fractional DOM/backing ratios without assuming devicePixelRatio", () => {
    expect(
      resolveArtworkSampleCoordinates(
        {
          canvasRect: { left: 100, top: 50, width: 240, height: 120 },
          logicalSize: { width: 480, height: 240 },
          backingSize: { width: 333, height: 167 },
          pageViewportRect: { x: 40, y: 20, width: 400, height: 180 },
        },
        { clientX: 160, clientY: 80 },
      ),
    ).toEqual({ status: "success", backingPoint: { x: 83, y: 41 } });
  });

  it("uses half-open page edges and rejects canvas workspace", () => {
    const geometry = {
      canvasRect: { left: 0, top: 0, width: 200, height: 100 },
      logicalSize: { width: 200, height: 100 },
      backingSize: { width: 400, height: 200 },
      pageViewportRect: { x: 20, y: 10, width: 160, height: 80 },
    };
    expect(resolveArtworkSampleCoordinates(geometry, { clientX: 20, clientY: 10 })).toEqual({
      status: "success",
      backingPoint: { x: 40, y: 20 },
    });
    expect(resolveArtworkSampleCoordinates(geometry, { clientX: 180, clientY: 50 })).toEqual({
      status: "outside-page",
    });
    expect(resolveArtworkSampleCoordinates(geometry, { clientX: 10, clientY: 50 })).toEqual({
      status: "outside-page",
    });
  });

  it("reports unavailable zero-sized or invalid geometry", () => {
    expect(
      resolveArtworkSampleCoordinates(
        {
          canvasRect: { left: 0, top: 0, width: 0, height: 100 },
          logicalSize: { width: 200, height: 100 },
          backingSize: { width: 200, height: 100 },
          pageViewportRect: { x: 0, y: 0, width: 200, height: 100 },
        },
        { clientX: 10, clientY: 10 },
      ),
    ).toEqual({ status: "unavailable" });
  });
});

describe("ArtworkColorSampler readback", () => {
  it("flushes pending committed rendering and returns canonical solid and paper RGB", () => {
    let pixel = new Uint8ClampedArray([17, 17, 17, 255]);
    const harness = createSamplerHarness(
      () => pixel,
      () => {
        pixel = new Uint8ClampedArray([255, 253, 248, 255]);
      },
    );
    expect(harness.sampler.sampleClientPoint({ clientX: 60, clientY: 45 })).toEqual({
      status: "success",
      color: "#fffdf8",
      backingPoint: { x: 100, y: 50 },
      durationMs: 2,
    });
    expect(harness.flush).toHaveBeenCalledOnce();
    expect(harness.getImageData).toHaveBeenCalledWith(100, 50, 1, 1);
  });

  it("resolves unexpected alpha over the compositor's actual opaque backing", () => {
    const harness = createSamplerHarness(() => new Uint8ClampedArray([220, 38, 38, 128]));
    expect(harness.sampler.sampleClientPoint({ clientX: 60, clientY: 45 })).toMatchObject({
      status: "success",
      color: "#ed918f",
    });
  });

  it("does not read or flush for workspace outside the page", () => {
    const harness = createSamplerHarness(() => new Uint8ClampedArray([43, 123, 227, 255]));
    expect(harness.sampler.sampleClientPoint({ clientX: 2, clientY: 2 })).toEqual({
      status: "miss",
      reason: "outside-page",
    });
    expect(harness.flush).not.toHaveBeenCalled();
    expect(harness.getImageData).not.toHaveBeenCalled();
  });

  it("reports unavailable canvas state without throwing", () => {
    const harness = createSamplerHarness(
      () => new Uint8ClampedArray([43, 123, 227, 255]),
      undefined,
      false,
    );
    expect(harness.sampler.sampleClientPoint({ clientX: 60, clientY: 45 })).toEqual({
      status: "miss",
      reason: "canvas-unavailable",
    });
  });

  it.each([
    ["SecurityError", "security"],
    ["UnknownError", "read-failure"],
  ] as const)("contains %s readback failures", (name, reason) => {
    const harness = createSamplerHarness(() => {
      throw Object.assign(new Error("private implementation detail"), { name });
    });
    expect(harness.sampler.sampleClientPoint({ clientX: 60, clientY: 45 })).toEqual({
      status: "error",
      reason,
      durationMs: 2,
    });
  });
});

function createSamplerHarness(
  readPixel: () => Uint8ClampedArray,
  onFlush: (() => void) | undefined = undefined,
  contextAvailable = true,
) {
  const getImageData = vi.fn(() => ({ data: readPixel() }));
  const context = { getImageData } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 400,
    height: 200,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 200, height: 100 }),
    getContext: () => (contextAvailable ? context : null),
  } as unknown as HTMLCanvasElement;
  const flush = vi.fn(onFlush);
  let time = 10;
  const sampler = createCanvasArtworkColorSampler({
    canvas,
    getLogicalSize: () => ({ width: 200, height: 100 }),
    getPageViewportRect: () => ({ x: 40, y: 10, width: 120, height: 80 }),
    getOpaqueBackingColor: () => ({ red: 255, green: 253, blue: 248 }),
    flushPendingRender: flush,
    now: () => {
      const current = time;
      time += 2;
      return current;
    },
  });
  return { sampler, flush, getImageData };
}
