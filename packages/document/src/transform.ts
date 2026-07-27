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
    if (!this.isIdentity) {
      throw new ObjectValidationError([
        {
          path: "$.transform",
          code: "invalid_transform",
          message: "Phase 8 document objects support only the identity transform.",
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
}
