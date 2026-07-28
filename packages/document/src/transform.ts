import type { Position } from "@folio/domain";
import { ObjectValidationError } from "./errors";
import type { ObjectBounds } from "./types";

export interface TransformInput {
  readonly translation?: Position;
  readonly rotation?: number;
  readonly scale?: number;
}

export class Transform {
  readonly translation: Position;
  readonly rotation: number;
  readonly scale: number;

  constructor(input: TransformInput = {}) {
    this.translation = Object.freeze({
      x: input.translation?.x ?? 0,
      y: input.translation?.y ?? 0,
    });
    this.rotation = input.rotation ?? 0;
    this.scale = input.scale ?? 1;
    const validTranslation =
      Number.isFinite(this.translation.x) && Number.isFinite(this.translation.y);
    if (
      !validTranslation ||
      !Number.isFinite(this.rotation) ||
      !Number.isFinite(this.scale) ||
      this.scale <= 0
    ) {
      throw new ObjectValidationError([
        {
          path: "$.transform",
          code: "invalid_transform",
          message: "Transform values must be finite and scale must be greater than zero.",
        },
      ]);
    }
    Object.freeze(this);
  }

  static identity(): Transform {
    return new Transform();
  }

  get isIdentity(): boolean {
    return (
      Number.isFinite(this.translation.x) &&
      Number.isFinite(this.translation.y) &&
      Number.isFinite(this.rotation) &&
      Number.isFinite(this.scale) &&
      this.translation.x === 0 &&
      this.translation.y === 0 &&
      this.rotation === 0 &&
      this.scale === 1
    );
  }

  /** Creates a new transform translated relative to this immutable value. */
  translatedBy(delta: Position): Transform {
    return new Transform({
      translation: {
        x: this.translation.x + delta.x,
        y: this.translation.y + delta.y,
      },
      rotation: this.rotation,
      scale: this.scale,
    });
  }

  /** Creates a new transform with an absolute clockwise rotation in radians. */
  withRotation(rotation: number): Transform {
    return new Transform({ translation: this.translation, rotation, scale: this.scale });
  }

  /** Creates a new transform with an absolute uniform scale. */
  withScale(scale: number): Transform {
    return new Transform({ translation: this.translation, rotation: this.rotation, scale });
  }

  /** Applies this transform around a stable local-space pivot. */
  applyToPoint(point: Position, pivot: Position): Position {
    const cosine = Math.cos(this.rotation);
    const sine = Math.sin(this.rotation);
    const localX = (point.x - pivot.x) * this.scale;
    const localY = (point.y - pivot.y) * this.scale;
    return Object.freeze({
      x: pivot.x + this.translation.x + localX * cosine - localY * sine,
      y: pivot.y + this.translation.y + localX * sine + localY * cosine,
    });
  }

  /** Converts a transformed page-space point back into local object space. */
  invertPoint(point: Position, pivot: Position): Position {
    const cosine = Math.cos(this.rotation);
    const sine = Math.sin(this.rotation);
    const translatedX = point.x - pivot.x - this.translation.x;
    const translatedY = point.y - pivot.y - this.translation.y;
    return Object.freeze({
      x: pivot.x + (translatedX * cosine + translatedY * sine) / this.scale,
      y: pivot.y + (-translatedX * sine + translatedY * cosine) / this.scale,
    });
  }

  /** Returns the axis-aligned page bounds of a locally bounded object. */
  transformBounds(bounds: ObjectBounds): ObjectBounds {
    const pivot = Object.freeze({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
    const corners = [
      this.applyToPoint({ x: bounds.x, y: bounds.y }, pivot),
      this.applyToPoint({ x: bounds.x + bounds.width, y: bounds.y }, pivot),
      this.applyToPoint({ x: bounds.x + bounds.width, y: bounds.y + bounds.height }, pivot),
      this.applyToPoint({ x: bounds.x, y: bounds.y + bounds.height }, pivot),
    ];
    const xs = corners.map(({ x }) => x);
    const ys = corners.map(({ y }) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return Object.freeze({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  }
}
