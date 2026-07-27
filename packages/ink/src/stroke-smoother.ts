import type { Point } from "@folio/rendering";
import { InkError } from "./errors";
import { assertCoordinate, freezePoint } from "./internal/geometry";
import type { StrokePointInput, StrokeSmootherOptions } from "./types";

export class StrokeSmoother {
  readonly mode;
  readonly windowSize;
  readonly strength;
  private readonly hook;

  constructor(options: StrokeSmootherOptions = {}) {
    this.mode = options.mode ?? "average";
    this.windowSize = options.windowSize ?? 3;
    this.strength = options.strength ?? 0.65;
    if (!Number.isInteger(this.windowSize) || this.windowSize < 1 || this.windowSize > 16) {
      throw new InkError("INVALID_STROKE", "Smoothing window must be an integer from 1 to 16.");
    }
    if (!Number.isFinite(this.strength) || this.strength < 0 || this.strength > 1) {
      throw new InkError("INVALID_STROKE", "Smoothing strength must be between zero and one.");
    }
    this.hook =
      this.mode === "catmull-rom"
        ? options.catmullRomHook
        : this.mode === "bezier"
          ? options.bezierHook
          : undefined;
    if ((this.mode === "catmull-rom" || this.mode === "bezier") && this.hook === undefined) {
      throw new InkError(
        "INVALID_STROKE",
        `${this.mode} smoothing requires an interpolation hook.`,
      );
    }
  }

  smoothNext(points: readonly StrokePointInput[]): Point {
    if (points.length === 0) {
      throw new InkError("INVALID_STROKE", "Cannot smooth an empty point collection.");
    }
    const index = points.length - 1;
    const current = points[index];
    if (current === undefined) {
      throw new InkError("INVALID_STROKE", "The current stroke point is unavailable.");
    }

    let result: Point;
    if (this.mode === "none") {
      result = current;
    } else if (this.mode === "average") {
      const start = Math.max(0, points.length - this.windowSize);
      let totalX = 0;
      let totalY = 0;
      for (let pointIndex = start; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        if (point !== undefined) {
          totalX += point.x;
          totalY += point.y;
        }
      }
      const count = points.length - start;
      const averageX = totalX / count;
      const averageY = totalY / count;
      result = {
        x: current.x + (averageX - current.x) * this.strength,
        y: current.y + (averageY - current.y) * this.strength,
      };
    } else {
      result = this.hook?.smooth(points, index) ?? current;
    }
    assertCoordinate(result);
    return freezePoint(result);
  }
}
