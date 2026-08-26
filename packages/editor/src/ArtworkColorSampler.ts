import type { Rect, Size } from "@folio/rendering";
import { rgbToHex, type RgbColor } from "./foundation/color-conversion";

export interface ArtworkSamplePoint {
  readonly clientX: number;
  readonly clientY: number;
}

export interface ArtworkBackingPoint {
  readonly x: number;
  readonly y: number;
}

export type ArtworkColorSampleResult =
  | Readonly<{
      status: "success";
      color: string;
      backingPoint: ArtworkBackingPoint;
      durationMs: number;
    }>
  | Readonly<{
      status: "miss";
      reason: "outside-page" | "canvas-unavailable";
    }>
  | Readonly<{
      status: "error";
      reason: "security" | "read-failure";
      durationMs: number;
    }>;

export interface ArtworkColorSampler {
  sampleClientPoint(point: ArtworkSamplePoint): ArtworkColorSampleResult;
}

export interface ArtworkSampleGeometry {
  readonly canvasRect: Readonly<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
  readonly logicalSize: Size;
  readonly backingSize: Size;
  readonly pageViewportRect: Rect;
}

export type ArtworkSampleCoordinateResult =
  | Readonly<{
      status: "success";
      backingPoint: ArtworkBackingPoint;
    }>
  | Readonly<{ status: "outside-page" }>
  | Readonly<{ status: "unavailable" }>;

interface CanvasArtworkColorSamplerOptions {
  readonly canvas: HTMLCanvasElement;
  readonly getLogicalSize: () => Size;
  readonly getPageViewportRect: () => Rect;
  readonly getOpaqueBackingColor: () => RgbColor;
  readonly flushPendingRender: () => void;
  readonly now?: () => number;
}

/** Resolves a client coordinate through the actual DOM and backing-store ratios. */
export function resolveArtworkSampleCoordinates(
  geometry: ArtworkSampleGeometry,
  point: ArtworkSamplePoint,
): ArtworkSampleCoordinateResult {
  const { canvasRect, logicalSize, backingSize, pageViewportRect } = geometry;
  if (
    !finitePositive(canvasRect.width) ||
    !finitePositive(canvasRect.height) ||
    !finitePositive(logicalSize.width) ||
    !finitePositive(logicalSize.height) ||
    !positiveInteger(backingSize.width) ||
    !positiveInteger(backingSize.height) ||
    !finitePositive(pageViewportRect.width) ||
    !finitePositive(pageViewportRect.height) ||
    ![
      canvasRect.left,
      canvasRect.top,
      pageViewportRect.x,
      pageViewportRect.y,
      point.clientX,
      point.clientY,
    ].every(Number.isFinite)
  ) {
    return Object.freeze({ status: "unavailable" });
  }

  const domX = point.clientX - canvasRect.left;
  const domY = point.clientY - canvasRect.top;
  if (domX < 0 || domY < 0 || domX >= canvasRect.width || domY >= canvasRect.height) {
    return Object.freeze({ status: "outside-page" });
  }

  const logicalX = domX * (logicalSize.width / canvasRect.width);
  const logicalY = domY * (logicalSize.height / canvasRect.height);
  const insidePage =
    logicalX >= pageViewportRect.x &&
    logicalX < pageViewportRect.x + pageViewportRect.width &&
    logicalY >= pageViewportRect.y &&
    logicalY < pageViewportRect.y + pageViewportRect.height;
  if (!insidePage) return Object.freeze({ status: "outside-page" });

  return Object.freeze({
    status: "success",
    backingPoint: Object.freeze({
      x: Math.min(backingSize.width - 1, Math.floor(domX * (backingSize.width / canvasRect.width))),
      y: Math.min(
        backingSize.height - 1,
        Math.floor(domY * (backingSize.height / canvasRect.height)),
      ),
    }),
  });
}

/** Creates the editor-owned readback boundary over the committed page compositor. */
export function createCanvasArtworkColorSampler(
  options: CanvasArtworkColorSamplerOptions,
): ArtworkColorSampler {
  const now = options.now ?? defaultNow;
  return Object.freeze({
    sampleClientPoint: (point: ArtworkSamplePoint): ArtworkColorSampleResult => {
      const coordinates = resolveArtworkSampleCoordinates(
        {
          canvasRect: options.canvas.getBoundingClientRect(),
          logicalSize: options.getLogicalSize(),
          backingSize: { width: options.canvas.width, height: options.canvas.height },
          pageViewportRect: options.getPageViewportRect(),
        },
        point,
      );
      if (coordinates.status === "outside-page") {
        return Object.freeze({ status: "miss", reason: "outside-page" });
      }
      if (coordinates.status === "unavailable") {
        return Object.freeze({ status: "miss", reason: "canvas-unavailable" });
      }

      const startedAt = now();
      try {
        options.flushPendingRender();
        const context = options.canvas.getContext("2d");
        if (context === null) {
          return Object.freeze({ status: "miss", reason: "canvas-unavailable" });
        }
        const pixel = context.getImageData(
          coordinates.backingPoint.x,
          coordinates.backingPoint.y,
          1,
          1,
        ).data;
        if (pixel.length < 4) throw new Error("Canvas pixel readback returned incomplete data.");
        const rgb = compositePixelOverOpaqueBacking(pixel, options.getOpaqueBackingColor());
        return Object.freeze({
          status: "success",
          color: rgbToHex(rgb),
          backingPoint: coordinates.backingPoint,
          durationMs: Math.max(0, now() - startedAt),
        });
      } catch (cause) {
        return Object.freeze({
          status: "error",
          reason: isSecurityError(cause) ? "security" : "read-failure",
          durationMs: Math.max(0, now() - startedAt),
        });
      }
    },
  });
}

function compositePixelOverOpaqueBacking(pixel: Uint8ClampedArray, backing: RgbColor): RgbColor {
  const alpha = pixel[3]! / 255;
  return Object.freeze({
    red: Math.round(pixel[0]! * alpha + backing.red * (1 - alpha)),
    green: Math.round(pixel[1]! * alpha + backing.green * (1 - alpha)),
    blue: Math.round(pixel[2]! * alpha + backing.blue * (1 - alpha)),
  });
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function isSecurityError(cause: unknown): boolean {
  return (
    typeof cause === "object" && cause !== null && "name" in cause && cause.name === "SecurityError"
  );
}

function defaultNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
