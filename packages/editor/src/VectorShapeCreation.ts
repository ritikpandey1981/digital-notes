import {
  createEditableStyle,
  vectorGeometryBounds,
  type EditableStyle,
  type EditableStyleInput,
  type LineGeometry,
  type ObjectBounds,
  type RectangleGeometry,
  type VectorGeometry,
  type VectorObjectType,
} from "@folio/document";
import type { PagePoint } from "@folio/selection";
import { formatVectorShapeMeasurement } from "./VectorShapeMeasurement";

export type ShapeCreationKind = VectorObjectType;

export interface VectorShapeDraft {
  readonly type: ShapeCreationKind;
  readonly geometry: VectorGeometry;
  readonly style: EditableStyle;
  readonly localBounds: ObjectBounds;
  readonly measurement: string;
  readonly valid: boolean;
}

const MINIMUM_SHAPE_SIZE = 1;
const SHIFT_ANGLE_INCREMENT = Math.PI / 4;

/** Resolves one immutable, non-document shape preview from raw pointer state. */
export function createVectorShapeDraft(
  type: ShapeCreationKind,
  start: PagePoint,
  current: PagePoint,
  constrain: boolean,
  styleInput: EditableStyleInput,
): VectorShapeDraft {
  const style = createEditableStyle(styleInput);
  const geometry = createGeometry(type, start, current, constrain);
  const geometryBounds = vectorGeometryBounds(type, geometry);
  const padding = style.strokeWidth / 2;
  const localBounds = Object.freeze({
    x: geometryBounds.x - padding,
    y: geometryBounds.y - padding,
    width: geometryBounds.width + padding * 2,
    height: geometryBounds.height + padding * 2,
  });
  const measurement = formatVectorShapeMeasurement(type, geometry);
  const valid =
    type === "line"
      ? lineLength(geometry as LineGeometry) >= MINIMUM_SHAPE_SIZE
      : geometryBounds.width >= MINIMUM_SHAPE_SIZE && geometryBounds.height >= MINIMUM_SHAPE_SIZE;
  return Object.freeze({ type, geometry, style, localBounds, measurement, valid });
}

function createGeometry(
  type: ShapeCreationKind,
  start: PagePoint,
  current: PagePoint,
  constrain: boolean,
): VectorGeometry {
  switch (type) {
    case "line":
      return lineGeometry(start, current, constrain);
    case "rectangle":
      return rectangleGeometry(start, current, constrain);
    case "ellipse": {
      const rectangle = rectangleGeometry(start, current, constrain);
      return Object.freeze({
        center: Object.freeze({
          x: rectangle.x + rectangle.width / 2,
          y: rectangle.y + rectangle.height / 2,
        }),
        radiusX: rectangle.width / 2,
        radiusY: rectangle.height / 2,
      });
    }
  }
}

function lineGeometry(start: PagePoint, current: PagePoint, constrain: boolean): LineGeometry {
  const deltaX = current.x - start.x;
  const deltaY = current.y - start.y;
  const length = Math.hypot(deltaX, deltaY);
  const angle = constrain
    ? Math.round(Math.atan2(deltaY, deltaX) / SHIFT_ANGLE_INCREMENT) * SHIFT_ANGLE_INCREMENT
    : Math.atan2(deltaY, deltaX);
  return Object.freeze({
    start: Object.freeze({ x: start.x, y: start.y }),
    end: Object.freeze({
      x: start.x + Math.cos(angle) * length,
      y: start.y + Math.sin(angle) * length,
    }),
  });
}

function rectangleGeometry(
  start: PagePoint,
  current: PagePoint,
  constrain: boolean,
): RectangleGeometry {
  let deltaX = current.x - start.x;
  let deltaY = current.y - start.y;
  if (constrain) {
    const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));
    deltaX = Math.sign(deltaX || 1) * size;
    deltaY = Math.sign(deltaY || 1) * size;
  }
  return Object.freeze({
    x: Math.min(start.x, start.x + deltaX),
    y: Math.min(start.y, start.y + deltaY),
    width: Math.abs(deltaX),
    height: Math.abs(deltaY),
  });
}

function lineLength(line: LineGeometry): number {
  return Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
}
