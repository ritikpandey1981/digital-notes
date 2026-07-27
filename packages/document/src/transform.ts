import type { Position } from "@folio/domain";
import { ObjectValidationError } from "./errors";

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
    if (!validTranslation || !Number.isFinite(this.rotation) || !Number.isFinite(this.scale)) {
      throw new ObjectValidationError([
        {
          path: "$.transform",
          code: "invalid_transform",
          message: "Transform values must be finite.",
        },
      ]);
    }
    if (this.rotation !== 0 || this.scale !== 1) {
      throw new ObjectValidationError([
        {
          path: "$.transform",
          code: "invalid_transform",
          message: "Phase 10 document objects support translation only.",
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

  /** Creates a new translation-only transform relative to this immutable value. */
  translatedBy(delta: Position): Transform {
    return new Transform({
      translation: {
        x: this.translation.x + delta.x,
        y: this.translation.y + delta.y,
      },
    });
  }
}
