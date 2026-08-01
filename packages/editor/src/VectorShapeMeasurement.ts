import {
  vectorGeometryBounds,
  type EllipseGeometry,
  type LineGeometry,
  type VectorGeometry,
  type VectorObjectType,
} from "@folio/document";

/** Formats editor-only live measurements without entering the document model. */
export function formatVectorShapeMeasurement(
  type: VectorObjectType,
  geometry: VectorGeometry,
): string {
  if (type === "line") {
    const line = geometry as LineGeometry;
    const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
    const angle = normalizedDegrees(
      Math.atan2(-(line.end.y - line.start.y), line.end.x - line.start.x),
    );
    return `Length: ${Math.round(length)} px \u00b7 Angle: ${angle}\u00b0`;
  }
  if (type === "ellipse") {
    const ellipse = geometry as EllipseGeometry;
    if (nearlyEqual(ellipse.radiusX, ellipse.radiusY)) {
      const radius = Math.round((ellipse.radiusX + ellipse.radiusY) / 2);
      return `Radius: ${radius} px \u00b7 Diameter: ${radius * 2} px`;
    }
  }
  const bounds = vectorGeometryBounds(type, geometry);
  return `Width: ${Math.round(bounds.width)} px \u00b7 Height: ${Math.round(bounds.height)} px`;
}

function nearlyEqual(first: number, second: number): boolean {
  return (
    Math.abs(first - second) <= Number.EPSILON * Math.max(1, Math.abs(first), Math.abs(second))
  );
}

function normalizedDegrees(radians: number): number {
  const degrees = Math.round((radians * 180) / Math.PI);
  return ((degrees % 360) + 360) % 360;
}
