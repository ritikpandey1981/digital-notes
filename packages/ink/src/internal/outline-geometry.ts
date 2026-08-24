import type { Point, Rect } from "@folio/rendering";
import type { ResolvedBrushSnapshot } from "../brush-model";
import type { ProfessionalInkPath, ProfessionalInkSegment } from "./professional-ink-path";
import { brushSizeAtPressure } from "./brush-dynamics";

const EPSILON = 0.000_001;
const CAP_STEPS = 10;
const ROUND_JOIN_MINIMUM_ANGLE = 0.35;

export interface OutlineCenterSample extends Point {
  readonly pressure: number;
  readonly radius: number;
  readonly progress: number;
}

export interface OutlineStrokeGeometry {
  readonly kind: "outline";
  readonly centerline: readonly OutlineCenterSample[];
  readonly boundary: readonly Point[];
  readonly roundJoins: readonly Readonly<{ center: Point; radius: number }>[];
  readonly dot: Readonly<{ center: Point; radius: number }> | null;
  readonly bounds: Rect;
  readonly vertexCount: number;
}

/** Builds one opacity-safe filled silhouette from the existing fitted centerline. */
export function createOutlineStrokeGeometry(
  path: ProfessionalInkPath,
  brush: ResolvedBrushSnapshot,
  renderedScale = 1,
): OutlineStrokeGeometry {
  if (!Number.isFinite(renderedScale) || renderedScale <= 0) {
    throw new RangeError("Outline render scale must be positive and finite.");
  }
  const first = path.sourcePoints[0];
  if (first === undefined) return emptyGeometry();
  if (path.segments.length === 0) {
    const radius = brushSizeAtPressure(brush, first.pressure) / (renderedScale * 2);
    const center = freezePoint(first);
    return Object.freeze({
      kind: "outline",
      centerline: Object.freeze([
        Object.freeze({
          x: first.x,
          y: first.y,
          pressure: first.pressure,
          radius,
          progress: 0,
        }),
      ]),
      boundary: Object.freeze([]),
      roundJoins: Object.freeze([]),
      dot: Object.freeze({ center, radius }),
      bounds: freezeRect({
        x: center.x - radius,
        y: center.y - radius,
        width: radius * 2,
        height: radius * 2,
      }),
      vertexCount: 0,
    });
  }

  const centerline = sampleFittedCenterline(path, brush, renderedScale);
  if (centerline.length === 1) {
    const sample = requiredSample(centerline, 0);
    const center = freezePoint(sample);
    return Object.freeze({
      kind: "outline",
      centerline,
      boundary: Object.freeze([]),
      roundJoins: Object.freeze([]),
      dot: Object.freeze({ center, radius: sample.radius }),
      bounds: freezeRect({
        x: center.x - sample.radius,
        y: center.y - sample.radius,
        width: sample.radius * 2,
        height: sample.radius * 2,
      }),
      vertexCount: 0,
    });
  }

  const offsets = centerline.map((sample, index) =>
    createJoinOffset(centerline, index, sample.radius),
  );
  const roundJoins = createRoundJoins(centerline);
  const left = centerline.map((sample, index) => {
    const offset = requiredPoint(offsets, index);
    return freezePoint({ x: sample.x + offset.x, y: sample.y + offset.y });
  });
  const right = centerline.map((sample, index) => {
    const offset = requiredPoint(offsets, index);
    return freezePoint({ x: sample.x - offset.x, y: sample.y - offset.y });
  });
  const boundary: Point[] = [...left];
  appendEndCap(boundary, centerline, offsets);
  for (let index = right.length - 1; index >= 0; index -= 1) {
    boundary.push(requiredPoint(right, index));
  }
  appendStartCap(boundary, centerline, offsets);
  if (boundary.length > 0) boundary.push(requiredPoint(boundary, 0));
  const frozenBoundary = Object.freeze(boundary);
  return Object.freeze({
    kind: "outline",
    centerline,
    boundary: frozenBoundary,
    roundJoins,
    dot: null,
    bounds: geometryBounds(frozenBoundary, roundJoins),
    vertexCount: frozenBoundary.length,
  });
}

function sampleFittedCenterline(
  path: ProfessionalInkPath,
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): readonly OutlineCenterSample[] {
  const samples: OutlineCenterSample[] = [];
  const maximumSpatialStep = clamp(brush.size * 0.3, 0.75, 3) / renderedScale;
  for (const segment of path.segments) {
    const parameters = segmentParameters(path, segment, brush.size);
    for (const parameter of parameters) {
      const progress = interpolate(segment.startProgress, segment.endProgress, parameter);
      const point = evaluateSegment(segment, parameter);
      const pressure = pressureAtProgress(path, progress);
      const sample = Object.freeze({
        x: point.x,
        y: point.y,
        pressure,
        radius: brushSizeAtPressure(brush, pressure) / (renderedScale * 2),
        progress,
      });
      appendSpatiallyResampled(samples, sample, maximumSpatialStep, brush, renderedScale);
    }
  }
  return Object.freeze(samples);
}

function appendSpatiallyResampled(
  samples: OutlineCenterSample[],
  sample: OutlineCenterSample,
  maximumSpatialStep: number,
  brush: ResolvedBrushSnapshot,
  renderedScale: number,
): void {
  const previous = samples.at(-1);
  if (previous === undefined) {
    samples.push(sample);
    return;
  }
  const separation = distance(previous, sample);
  if (separation <= EPSILON) {
    if (sample.radius > previous.radius) samples[samples.length - 1] = sample;
    return;
  }
  const steps = Math.max(1, Math.ceil(separation / maximumSpatialStep));
  for (let step = 1; step <= steps; step += 1) {
    if (step === steps) {
      samples.push(sample);
      continue;
    }
    const amount = step / steps;
    const pressure = interpolate(previous.pressure, sample.pressure, amount);
    samples.push(
      Object.freeze({
        x: interpolate(previous.x, sample.x, amount),
        y: interpolate(previous.y, sample.y, amount),
        pressure,
        radius: brushSizeAtPressure(brush, pressure) / (renderedScale * 2),
        progress: interpolate(previous.progress, sample.progress, amount),
      }),
    );
  }
}

function segmentParameters(
  path: ProfessionalInkPath,
  segment: ProfessionalInkSegment,
  brushSize: number,
): readonly number[] {
  const controlLength =
    distance(segment.start, { x: segment.control1X, y: segment.control1Y }) +
    distance(
      { x: segment.control1X, y: segment.control1Y },
      { x: segment.control2X, y: segment.control2Y },
    ) +
    distance({ x: segment.control2X, y: segment.control2Y }, segment.end);
  const targetSpacing = clamp(brushSize * 0.3, 0.75, 3);
  const steps = clamp(Math.ceil(controlLength / targetSpacing), 1, 96);
  const parameters = new Set<number>();
  for (let step = 0; step <= steps; step += 1) parameters.add(step / steps);
  const span = segment.endProgress - segment.startProgress;
  if (span > EPSILON) {
    let index = firstProgressAfter(path.sourceProgress, segment.startProgress);
    while (index < path.sourceProgress.length) {
      const progress = path.sourceProgress[index];
      if (progress === undefined || progress >= segment.endProgress) break;
      parameters.add(clamp((progress - segment.startProgress) / span, 0, 1));
      index += 1;
    }
  }
  return Object.freeze([...parameters].sort((left, right) => left - right));
}

function firstProgressAfter(progress: readonly number[], value: number): number {
  let low = 0;
  let high = progress.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((progress[middle] ?? 0) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function pressureAtProgress(path: ProfessionalInkPath, progress: number): number {
  const points = path.sourcePoints;
  const progression = path.sourceProgress;
  const first = points[0];
  if (first === undefined) return 0.5;
  if (points.length === 1 || progress <= 0) return normalizedPressure(first.pressure);
  const last = points.at(-1);
  if (last === undefined || progress >= 1)
    return normalizedPressure(last?.pressure ?? first.pressure);
  let low = 0;
  let high = progression.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if ((progression[middle] ?? 0) <= progress) low = middle;
    else high = middle;
  }
  const startProgress = progression[low] ?? 0;
  const endProgress = progression[high] ?? 1;
  const span = endProgress - startProgress;
  const amount = span <= EPSILON ? 0 : (progress - startProgress) / span;
  return interpolate(
    normalizedPressure(points[low]?.pressure ?? first.pressure),
    normalizedPressure(points[high]?.pressure ?? last.pressure),
    amount,
  );
}

function createJoinOffset(
  samples: readonly OutlineCenterSample[],
  index: number,
  radius: number,
): Point {
  const current = requiredSample(samples, index);
  const previous = samples[index - 1];
  const next = samples[index + 1];
  const incoming = normalize({
    x: current.x - (previous?.x ?? current.x),
    y: current.y - (previous?.y ?? current.y),
  });
  const outgoing = normalize({
    x: (next?.x ?? current.x) - current.x,
    y: (next?.y ?? current.y) - current.y,
  });
  if (previous === undefined) return scaleNormal(outgoing, radius);
  if (next === undefined) return scaleNormal(incoming, radius);
  const tangent = normalize({ x: incoming.x + outgoing.x, y: incoming.y + outgoing.y });
  // A reversal has no stable averaged tangent. Keep the incoming side orientation and let the
  // explicit round join bridge the outgoing boundary without an inverted/mitered excursion.
  return scaleNormal(length(tangent) > EPSILON ? tangent : incoming, radius);
}

function scaleNormal(tangent: Point, radius: number): Point {
  return Object.freeze({ x: -tangent.y * radius, y: tangent.x * radius });
}

function createRoundJoins(
  samples: readonly OutlineCenterSample[],
): readonly Readonly<{ center: Point; radius: number }>[] {
  const joins: Array<Readonly<{ center: Point; radius: number }>> = [];
  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = requiredSample(samples, index - 1);
    const current = requiredSample(samples, index);
    const next = requiredSample(samples, index + 1);
    const incoming = normalize({ x: current.x - previous.x, y: current.y - previous.y });
    const outgoing = normalize({ x: next.x - current.x, y: next.y - current.y });
    if (length(incoming) <= EPSILON || length(outgoing) <= EPSILON) continue;
    const angle = Math.acos(clamp(dot(incoming, outgoing), -1, 1));
    if (angle < ROUND_JOIN_MINIMUM_ANGLE) continue;
    joins.push(Object.freeze({ center: freezePoint(current), radius: current.radius }));
  }
  return Object.freeze(joins);
}

function appendEndCap(
  boundary: Point[],
  centerline: readonly OutlineCenterSample[],
  offsets: readonly Point[],
): void {
  const index = centerline.length - 1;
  const center = requiredSample(centerline, index);
  const normal = normalizedOffset(requiredPoint(offsets, index));
  const tangent = endpointTangent(centerline, false);
  for (let step = 1; step < CAP_STEPS; step += 1) {
    const angle = (step / CAP_STEPS) * Math.PI;
    boundary.push(
      freezePoint({
        x: center.x + (normal.x * Math.cos(angle) + tangent.x * Math.sin(angle)) * center.radius,
        y: center.y + (normal.y * Math.cos(angle) + tangent.y * Math.sin(angle)) * center.radius,
      }),
    );
  }
}

function appendStartCap(
  boundary: Point[],
  centerline: readonly OutlineCenterSample[],
  offsets: readonly Point[],
): void {
  const center = requiredSample(centerline, 0);
  const normal = normalizedOffset(requiredPoint(offsets, 0));
  const tangent = endpointTangent(centerline, true);
  for (let step = 1; step < CAP_STEPS; step += 1) {
    const angle = (step / CAP_STEPS) * Math.PI;
    boundary.push(
      freezePoint({
        x: center.x + (-normal.x * Math.cos(angle) - tangent.x * Math.sin(angle)) * center.radius,
        y: center.y + (-normal.y * Math.cos(angle) - tangent.y * Math.sin(angle)) * center.radius,
      }),
    );
  }
}

function endpointTangent(samples: readonly OutlineCenterSample[], start: boolean): Point {
  const firstIndex = start ? 0 : samples.length - 2;
  const secondIndex = start ? 1 : samples.length - 1;
  const first = requiredSample(samples, firstIndex);
  const second = requiredSample(samples, secondIndex);
  return normalize({ x: second.x - first.x, y: second.y - first.y });
}

function normalizedOffset(offset: Point): Point {
  const normalized = normalize(offset);
  return length(normalized) <= EPSILON ? Object.freeze({ x: 0, y: 1 }) : normalized;
}

function evaluateSegment(segment: ProfessionalInkSegment, parameter: number): Point {
  const inverse = 1 - parameter;
  const b0 = inverse * inverse * inverse;
  const b1 = 3 * parameter * inverse * inverse;
  const b2 = 3 * parameter * parameter * inverse;
  const b3 = parameter * parameter * parameter;
  return {
    x: segment.start.x * b0 + segment.control1X * b1 + segment.control2X * b2 + segment.end.x * b3,
    y: segment.start.y * b0 + segment.control1Y * b1 + segment.control2Y * b2 + segment.end.y * b3,
  };
}

function geometryBounds(
  points: readonly Point[],
  roundJoins: readonly Readonly<{ center: Point; radius: number }>[],
): Rect {
  let minimumX = Number.POSITIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumX = Number.NEGATIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }
  for (const join of roundJoins) {
    minimumX = Math.min(minimumX, join.center.x - join.radius);
    minimumY = Math.min(minimumY, join.center.y - join.radius);
    maximumX = Math.max(maximumX, join.center.x + join.radius);
    maximumY = Math.max(maximumY, join.center.y + join.radius);
  }
  return freezeRect({
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  });
}

function emptyGeometry(): OutlineStrokeGeometry {
  return Object.freeze({
    kind: "outline",
    centerline: Object.freeze([]),
    boundary: Object.freeze([]),
    roundJoins: Object.freeze([]),
    dot: null,
    bounds: freezeRect({ x: 0, y: 0, width: 0, height: 0 }),
    vertexCount: 0,
  });
}

function requiredSample(
  samples: readonly OutlineCenterSample[],
  index: number,
): OutlineCenterSample {
  const sample = samples[index];
  if (sample === undefined) throw new RangeError(`Missing outline sample at index ${index}.`);
  return sample;
}

function requiredPoint(points: readonly Point[], index: number): Point {
  const point = points[index];
  if (point === undefined) throw new RangeError(`Missing outline point at index ${index}.`);
  return point;
}

function freezePoint(point: Point): Point {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError("Outline geometry must contain finite coordinates.");
  }
  return Object.freeze({ x: point.x, y: point.y });
}

function freezeRect(rect: Rect): Rect {
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    throw new RangeError("Outline geometry bounds must be finite and non-negative.");
  }
  return Object.freeze({ ...rect });
}

function normalize(point: Point): Point {
  const magnitude = length(point);
  return magnitude <= EPSILON
    ? Object.freeze({ x: 0, y: 0 })
    : Object.freeze({ x: point.x / magnitude, y: point.y / magnitude });
}

function length(point: Point): number {
  return Math.hypot(point.x, point.y);
}

function distance(first: Point, second: Point): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function dot(first: Point, second: Point): number {
  return first.x * second.x + first.y * second.y;
}

function interpolate(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function normalizedPressure(pressure: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(pressure) ? pressure : 0.5));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
