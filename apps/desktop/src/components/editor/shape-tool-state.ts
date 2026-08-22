import type { CanvasDrawingStyle, ShapeStylePatch } from "@folio/editor";
import type { ShapeToolKind } from "./editor-types";

export interface ShapeToolStateSnapshot {
  readonly activeShape: ShapeToolKind;
  readonly style: Readonly<Required<CanvasDrawingStyle>>;
  readonly version: number;
}

export interface ShapeToolState {
  readonly snapshot: () => ShapeToolStateSnapshot;
  readonly selectShape: (shape: ShapeToolKind) => ShapeToolStateSnapshot;
  readonly updateStyle: (patch: ShapeStylePatch) => ShapeToolStateSnapshot;
}

export const DEFAULT_SHAPE_DRAWING_STYLE: Readonly<Required<CanvasDrawingStyle>> = Object.freeze({
  color: "#111111",
  width: 2,
  opacity: 1,
  pressureEnabled: false,
});

class ShapeToolStateImplementation implements ShapeToolState {
  #activeShape: ShapeToolKind = "line";
  #style = DEFAULT_SHAPE_DRAWING_STYLE;
  #version = 0;

  snapshot(): ShapeToolStateSnapshot {
    return Object.freeze({
      activeShape: this.#activeShape,
      style: this.#style,
      version: this.#version,
    });
  }

  selectShape(shape: ShapeToolKind): ShapeToolStateSnapshot {
    if (shape === this.#activeShape) return this.snapshot();
    this.#activeShape = shape;
    this.#version += 1;
    return this.snapshot();
  }

  updateStyle(patch: ShapeStylePatch): ShapeToolStateSnapshot {
    const style = Object.freeze({
      color: patch.strokeColor ?? this.#style.color,
      width: patch.strokeWidth ?? this.#style.width,
      opacity: patch.opacity ?? this.#style.opacity,
      pressureEnabled: false,
    });
    if (
      style.color === this.#style.color &&
      style.width === this.#style.width &&
      style.opacity === this.#style.opacity
    ) {
      return this.snapshot();
    }
    this.#style = style;
    this.#version += 1;
    return this.snapshot();
  }
}

export function createShapeToolState(): ShapeToolState {
  return new ShapeToolStateImplementation();
}
