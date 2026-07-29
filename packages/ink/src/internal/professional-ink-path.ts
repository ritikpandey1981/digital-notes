import type { StrokePoint } from "../types";

const EPSILON = 0.000_001;
const CORNER_ANGLE_RADIANS = 0.7;
const MAX_SAMPLE_SPACING = 5;
const MAX_REPARAMETERIZATION_PASSES = 4;
const CURVE_GUARD_SAMPLES = 20;

interface Vector {
  readonly x: number;
  readonly y: number;
}

interface CubicCurve {
  readonly start: StrokePoint;
  readonly control1: Vector;
  readonly control2: Vector;
  readonly end: StrokePoint;
}

interface FitTask {
  readonly first: number;
  readonly last: number;
  readonly leftTangent: Vector;
  readonly rightTangent: Vector;
}

interface FitError {
  readonly squaredDistance: number;
  readonly splitIndex: number;
}

/** One cached adaptive cubic segment for a finalized immutable stroke. */
export interface ProfessionalInkSegment {
  readonly start: StrokePoint;
  readonly control1X: number;
  readonly control1Y: number;
  readonly control2X: number;
  readonly control2Y: number;
  readonly end: StrokePoint;
}

/** Renderer-private, immutable high-quality representation of one stroke. */
export interface ProfessionalInkPath {
  readonly sourcePointCount: number;
  readonly points: readonly StrokePoint[];
  readonly segments: readonly ProfessionalInkSegment[];
}

/** Performs one adaptive filtering and error-tolerance fitting pass at stroke completion. */
export function createProfessionalInkPath(
  sourcePoints: readonly StrokePoint[],
): ProfessionalInkPath {
  const points = filterAdaptiveStrokePoints(sourcePoints);
  const segments = fitAdaptiveCubicSegments(points);
  return Object.freeze({ sourcePointCount: sourcePoints.length, points, segments });
}

/** Retains meaningful curvature while reducing velocity-dependent redundant samples. */
export function filterAdaptiveStrokePoints(
  sourcePoints: readonly StrokePoint[],
): readonly StrokePoint[] {
  if (sourcePoints.length <= 4) return freezeReferences(sourcePoints);
  const diagonal = strokeDiagonal(sourcePoints);
  const cornerDistance = clamp(diagonal * 0.002, 0.4, 2);
  const filtered: StrokePoint[] = [];
  const first = sourcePoints[0];
  const last = sourcePoints.at(-1);
  if (first === undefined || last === undefined) return Object.freeze(filtered);
  filtered.push(first);

  for (let index = 1; index < sourcePoints.length - 1; index += 1) {
    const candidate = sourcePoints[index];
    const next = sourcePoints[index + 1];
    const retained = filtered.at(-1);
    if (candidate === undefined || next === undefined || retained === undefined) continue;
    const retainedDistance = distance(retained, candidate);
    const nextDistance = distance(candidate, next);
    const elapsedMilliseconds = Math.max(candidate.timestamp - retained.timestamp, 0.001);
    const speed = retainedDistance / elapsedMilliseconds;
    const sizeFactor = clamp(diagonal / 200, 0.5, 2);
    const timingFactor = elapsedMilliseconds >= 16 ? 0.65 : elapsedMilliseconds <= 4 ? 1.2 : 1;
    const spacing = clamp(
      (0.3 * sizeFactor + Math.min(3.5, speed * 0.9)) * timingFactor,
      0.25,
      MAX_SAMPLE_SPACING,
    );
    const angle = turnAngle(retained, candidate, next);
    const isCorner = angle >= 0.5 && Math.min(retainedDistance, nextDistance) >= cornerDistance;
    const deviation = distanceToSegment(candidate, retained, next);
    const contributesCurvature = deviation >= Math.max(0.18, spacing * 0.3);
    const velocityDelta =
      Math.abs(candidate.velocity - retained.velocity) /
      Math.max(Math.abs(candidate.velocity), Math.abs(retained.velocity), 1);
    const marksVelocityChange = velocityDelta >= 0.65 && retainedDistance >= spacing * 0.5;

    if (retainedDistance >= spacing || isCorner || contributesCurvature || marksVelocityChange) {
      filtered.push(candidate);
    }
  }

  if (filtered.at(-1) !== last) filtered.push(last);
  return Object.freeze(filtered);
}

/** Fits the fewest practical cubics that satisfy adaptive geometric error limits. */
function fitAdaptiveCubicSegments(
  points: readonly StrokePoint[],
): readonly ProfessionalInkSegment[] {
  if (points.length < 2) return Object.freeze([]);
  const tolerance = fittingTolerance(points);
  const boundaries = findCornerBoundaries(points);
  const segments: ProfessionalInkSegment[] = [];
  for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
    const first = boundaries[boundaryIndex];
    const last = boundaries[boundaryIndex + 1];
    if (first === undefined || last === undefined || first >= last) continue;
    segments.push(...fitRange(points, first, last, tolerance));
  }
  return Object.freeze(segments);
}

function fitRange(
  points: readonly StrokePoint[],
  first: number,
  last: number,
  tolerance: number,
): readonly ProfessionalInkSegment[] {
  const leftTangent = forwardTangent(points, first, last);
  const rightTangent = backwardTangent(points, first, last);
  const tasks: FitTask[] = [{ first, last, leftTangent, rightTangent }];
  const segments: ProfessionalInkSegment[] = [];
  const squaredTolerance = tolerance * tolerance;

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (task === undefined) continue;
    if (task.last - task.first === 1) {
      segments.push(freezeSegment(twoPointCurve(points, task)));
      continue;
    }

    const fitted = fitTask(points, task, tolerance, squaredTolerance);
    if (fitted.curve !== null) {
      segments.push(freezeSegment(fitted.curve));
      continue;
    }

    const split = clampSplitIndex(fitted.error.splitIndex, task.first, task.last);
    const centerBackward = centerTangent(points, split);
    tasks.push({
      first: split,
      last: task.last,
      leftTangent: negate(centerBackward),
      rightTangent: task.rightTangent,
    });
    tasks.push({
      first: task.first,
      last: split,
      leftTangent: task.leftTangent,
      rightTangent: centerBackward,
    });
  }
  return segments;
}

function fitTask(
  points: readonly StrokePoint[],
  task: FitTask,
  tolerance: number,
  squaredTolerance: number,
): Readonly<{ curve: CubicCurve | null; error: FitError }> {
  let parameters = centripetalParameters(points, task.first, task.last);
  let curve = guardedCurve(generateCurve(points, task, parameters), points, task, tolerance);
  let error = maximumFitError(points, task, curve, parameters);
  if (error.squaredDistance <= squaredTolerance) return { curve, error };

  if (error.squaredDistance <= squaredTolerance * 4) {
    for (let pass = 0; pass < MAX_REPARAMETERIZATION_PASSES; pass += 1) {
      parameters = reparameterize(points, task, parameters, curve);
      curve = guardedCurve(generateCurve(points, task, parameters), points, task, tolerance);
      error = maximumFitError(points, task, curve, parameters);
      if (error.squaredDistance <= squaredTolerance) return { curve, error };
    }
  }
  return { curve: null, error };
}

/** Least-squares cubic generation using fixed endpoint tangent directions. */
function generateCurve(
  points: readonly StrokePoint[],
  task: FitTask,
  parameters: readonly number[],
): CubicCurve {
  const start = requiredPoint(points, task.first);
  const end = requiredPoint(points, task.last);
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;

  for (let index = task.first; index <= task.last; index += 1) {
    const point = requiredPoint(points, index);
    const parameter = parameters[index - task.first] ?? 0;
    const basis = bernsteinBasis(parameter);
    const tangent1 = scale(task.leftTangent, basis.b1);
    const tangent2 = scale(task.rightTangent, basis.b2);
    const base = add(scale(start, basis.b0 + basis.b1), scale(end, basis.b2 + basis.b3));
    const offset = subtract(point, base);
    c00 += dot(tangent1, tangent1);
    c01 += dot(tangent1, tangent2);
    c11 += dot(tangent2, tangent2);
    x0 += dot(tangent1, offset);
    x1 += dot(tangent2, offset);
  }

  const determinant = c00 * c11 - c01 * c01;
  let alpha1 = Math.abs(determinant) <= EPSILON ? 0 : (x0 * c11 - x1 * c01) / determinant;
  let alpha2 = Math.abs(determinant) <= EPSILON ? 0 : (c00 * x1 - c01 * x0) / determinant;
  const chordLength = distance(start, end);
  const minimumHandle = Math.max(chordLength * 0.000_1, EPSILON);
  if (
    !Number.isFinite(alpha1) ||
    !Number.isFinite(alpha2) ||
    alpha1 < minimumHandle ||
    alpha2 < minimumHandle
  ) {
    alpha1 = chordLength / 3;
    alpha2 = chordLength / 3;
  }
  const maximumHandles = maximumHandleLengths(points, task, chordLength);
  alpha1 = Math.min(alpha1, maximumHandles.start);
  alpha2 = Math.min(alpha2, maximumHandles.end);
  return {
    start,
    control1: add(start, scale(task.leftTangent, alpha1)),
    control2: add(end, scale(task.rightTangent, alpha2)),
    end,
  };
}

/** Limits tangent reach against local curvature without endpoint-box clamping. */
function maximumHandleLengths(
  points: readonly StrokePoint[],
  task: FitTask,
  chordLength: number,
): Readonly<{ start: number; end: number }> {
  let arcLength = 0;
  for (let index = task.first + 1; index <= task.last; index += 1) {
    arcLength += distance(requiredPoint(points, index - 1), requiredPoint(points, index));
  }
  const sharedMaximum = Math.max(
    chordLength / 3,
    Math.min(arcLength * 0.65, chordLength * 1.5 + arcLength * 0.1),
  );
  return Object.freeze({
    start: sharedMaximum * endpointCurvatureLimit(points, task.first, 1, task.last),
    end: sharedMaximum * endpointCurvatureLimit(points, task.last, -1, task.first),
  });
}

function endpointCurvatureLimit(
  points: readonly StrokePoint[],
  endpoint: number,
  direction: 1 | -1,
  boundary: number,
): number {
  const middleIndex = endpoint + direction;
  const farIndex = endpoint + direction * 2;
  if ((direction === 1 && farIndex > boundary) || (direction === -1 && farIndex < boundary)) {
    return 1;
  }
  const angle = turnAngle(
    requiredPoint(points, endpoint),
    requiredPoint(points, middleIndex),
    requiredPoint(points, farIndex),
  );
  return 1 - smoothStep(0.45, 1.35, angle) * 0.55;
}

/** Shrinks only unsafe handles; valid controls may extend beyond the endpoint rectangle. */
function guardedCurve(
  curve: CubicCurve,
  points: readonly StrokePoint[],
  task: FitTask,
  tolerance: number,
): CubicCurve {
  const bounds = expandedRangeBounds(points, task.first, task.last, tolerance * 1.75);
  let control1 = curve.control1;
  let control2 = curve.control2;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const candidate = { ...curve, control1, control2 };
    if (curveWithinBounds(candidate, bounds) && !curveSelfIntersects(candidate)) return candidate;
    control1 = interpolate(curve.start, control1, 0.7);
    control2 = interpolate(curve.end, control2, 0.7);
  }
  return { ...curve, control1, control2 };
}

function maximumFitError(
  points: readonly StrokePoint[],
  task: FitTask,
  curve: CubicCurve,
  parameters: readonly number[],
): FitError {
  let squaredDistance = 0;
  let splitIndex = Math.floor((task.first + task.last) / 2);
  for (let index = task.first + 1; index < task.last; index += 1) {
    const point = requiredPoint(points, index);
    const curvePoint = evaluateCurve(curve, parameters[index - task.first] ?? 0);
    const candidateDistance = squaredLength(subtract(curvePoint, point));
    if (candidateDistance > squaredDistance) {
      squaredDistance = candidateDistance;
      splitIndex = index;
    }
  }
  return Object.freeze({ squaredDistance, splitIndex });
}

function centripetalParameters(
  points: readonly StrokePoint[],
  first: number,
  last: number,
): readonly number[] {
  const parameters = [0];
  let total = 0;
  for (let index = first + 1; index <= last; index += 1) {
    total += Math.sqrt(
      Math.max(distance(requiredPoint(points, index - 1), requiredPoint(points, index)), EPSILON),
    );
    parameters.push(total);
  }
  if (total <= EPSILON) {
    return parameters.map((_, index) => index / Math.max(parameters.length - 1, 1));
  }
  return parameters.map((value) => value / total);
}

function reparameterize(
  points: readonly StrokePoint[],
  task: FitTask,
  parameters: readonly number[],
  curve: CubicCurve,
): readonly number[] {
  const next = [0];
  const count = task.last - task.first;
  for (let offset = 1; offset < count; offset += 1) {
    const previous = next[offset - 1] ?? 0;
    const maximum = 1 - (count - offset) * 0.000_1;
    const refined = newtonParameter(
      curve,
      requiredPoint(points, task.first + offset),
      parameters[offset] ?? 0,
    );
    next.push(clamp(refined, previous + 0.000_1, maximum));
  }
  next.push(1);
  return next;
}

function newtonParameter(curve: CubicCurve, point: StrokePoint, parameter: number): number {
  const value = evaluateCurve(curve, parameter);
  const firstDerivative = evaluateFirstDerivative(curve, parameter);
  const secondDerivative = evaluateSecondDerivative(curve, parameter);
  const difference = subtract(value, point);
  const denominator = dot(firstDerivative, firstDerivative) + dot(difference, secondDerivative);
  if (Math.abs(denominator) <= EPSILON) return parameter;
  return parameter - dot(difference, firstDerivative) / denominator;
}

function findCornerBoundaries(points: readonly StrokePoint[]): readonly number[] {
  const boundaries = [0];
  const minimumLeg = clamp(strokeDiagonal(points) * 0.0015, 0.3, 1.5);
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = requiredPoint(points, index - 1);
    const current = requiredPoint(points, index);
    const next = requiredPoint(points, index + 1);
    if (
      turnAngle(previous, current, next) >= CORNER_ANGLE_RADIANS &&
      Math.min(distance(previous, current), distance(current, next)) >= minimumLeg
    ) {
      boundaries.push(index);
    }
  }
  boundaries.push(points.length - 1);
  return boundaries;
}

function fittingTolerance(points: readonly StrokePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(requiredPoint(points, index - 1), requiredPoint(points, index));
  }
  const averageSpacing = length / Math.max(points.length - 1, 1);
  const detailAllowance = clamp(averageSpacing * 0.18, 0.08, 0.42);
  const sizeAllowance = clamp(strokeDiagonal(points) * 0.001, 0, 0.4);
  return clamp(0.24 + detailAllowance + sizeAllowance, 0.32, 0.9);
}

function twoPointCurve(points: readonly StrokePoint[], task: FitTask): CubicCurve {
  const start = requiredPoint(points, task.first);
  const end = requiredPoint(points, task.last);
  const handle = distance(start, end) / 3;
  return {
    start,
    control1: add(start, scale(task.leftTangent, handle)),
    control2: add(end, scale(task.rightTangent, handle)),
    end,
  };
}

function freezeSegment(curve: CubicCurve): ProfessionalInkSegment {
  return Object.freeze({
    start: curve.start,
    control1X: curve.control1.x,
    control1Y: curve.control1.y,
    control2X: curve.control2.x,
    control2Y: curve.control2.y,
    end: curve.end,
  });
}

function forwardTangent(points: readonly StrokePoint[], first: number, last: number): Vector {
  const start = requiredPoint(points, first);
  for (let index = first + 1; index <= last; index += 1) {
    const tangent = normalize(subtract(requiredPoint(points, index), start));
    if (squaredLength(tangent) > 0) return tangent;
  }
  return Object.freeze({ x: 1, y: 0 });
}

function backwardTangent(points: readonly StrokePoint[], first: number, last: number): Vector {
  const end = requiredPoint(points, last);
  for (let index = last - 1; index >= first; index -= 1) {
    const tangent = normalize(subtract(requiredPoint(points, index), end));
    if (squaredLength(tangent) > 0) return tangent;
  }
  return Object.freeze({ x: -1, y: 0 });
}

function centerTangent(points: readonly StrokePoint[], split: number): Vector {
  const previous = requiredPoint(points, Math.max(0, split - 1));
  const next = requiredPoint(points, Math.min(points.length - 1, split + 1));
  const tangent = normalize(subtract(previous, next));
  if (squaredLength(tangent) > 0) return tangent;
  return normalize(subtract(previous, requiredPoint(points, split)));
}

function curveWithinBounds(
  curve: CubicCurve,
  bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>,
): boolean {
  for (let sample = 1; sample < CURVE_GUARD_SAMPLES; sample += 1) {
    const point = evaluateCurve(curve, sample / CURVE_GUARD_SAMPLES);
    if (
      point.x < bounds.minX ||
      point.x > bounds.maxX ||
      point.y < bounds.minY ||
      point.y > bounds.maxY
    ) {
      return false;
    }
  }
  return true;
}

function curveSelfIntersects(curve: CubicCurve): boolean {
  const samples: Vector[] = [];
  for (let index = 0; index <= CURVE_GUARD_SAMPLES; index += 1) {
    samples.push(evaluateCurve(curve, index / CURVE_GUARD_SAMPLES));
  }
  for (let first = 0; first < samples.length - 1; first += 1) {
    for (let second = first + 2; second < samples.length - 1; second += 1) {
      if (
        first === 0 &&
        second === samples.length - 2 &&
        distance(requiredVector(samples, 0), requiredVector(samples, samples.length - 1)) <= EPSILON
      ) {
        continue;
      }
      if (
        properlyIntersects(
          requiredVector(samples, first),
          requiredVector(samples, first + 1),
          requiredVector(samples, second),
          requiredVector(samples, second + 1),
        )
      )
        return true;
    }
  }
  return false;
}

function properlyIntersects(first: Vector, second: Vector, third: Vector, fourth: Vector): boolean {
  const firstSide = cross(subtract(second, first), subtract(third, first));
  const secondSide = cross(subtract(second, first), subtract(fourth, first));
  const thirdSide = cross(subtract(fourth, third), subtract(first, third));
  const fourthSide = cross(subtract(fourth, third), subtract(second, third));
  return firstSide * secondSide < -EPSILON && thirdSide * fourthSide < -EPSILON;
}

function expandedRangeBounds(
  points: readonly StrokePoint[],
  first: number,
  last: number,
  margin: number,
): Readonly<{ minX: number; minY: number; maxX: number; maxY: number }> {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = first; index <= last; index += 1) {
    const point = requiredPoint(points, index);
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Object.freeze({
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin,
  });
}

function bernsteinBasis(
  parameter: number,
): Readonly<{ b0: number; b1: number; b2: number; b3: number }> {
  const inverse = 1 - parameter;
  const squaredInverse = inverse * inverse;
  const squaredParameter = parameter * parameter;
  return {
    b0: squaredInverse * inverse,
    b1: 3 * parameter * squaredInverse,
    b2: 3 * squaredParameter * inverse,
    b3: squaredParameter * parameter,
  };
}

function evaluateCurve(curve: CubicCurve, parameter: number): Vector {
  const basis = bernsteinBasis(parameter);
  return add(
    add(scale(curve.start, basis.b0), scale(curve.control1, basis.b1)),
    add(scale(curve.control2, basis.b2), scale(curve.end, basis.b3)),
  );
}

function evaluateFirstDerivative(curve: CubicCurve, parameter: number): Vector {
  const inverse = 1 - parameter;
  return add(
    scale(subtract(curve.control1, curve.start), 3 * inverse * inverse),
    add(
      scale(subtract(curve.control2, curve.control1), 6 * inverse * parameter),
      scale(subtract(curve.end, curve.control2), 3 * parameter * parameter),
    ),
  );
}

function evaluateSecondDerivative(curve: CubicCurve, parameter: number): Vector {
  return add(
    scale(
      add(subtract(curve.control2, scale(curve.control1, 2)), curve.start),
      6 * (1 - parameter),
    ),
    scale(add(subtract(curve.end, scale(curve.control2, 2)), curve.control1), 6 * parameter),
  );
}

function strokeDiagonal(points: readonly StrokePoint[]): number {
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
  return points.length === 0 ? 0 : Math.hypot(maximumX - minimumX, maximumY - minimumY);
}

function turnAngle(first: StrokePoint, middle: StrokePoint, last: StrokePoint): number {
  const incomingX = middle.x - first.x;
  const incomingY = middle.y - first.y;
  const outgoingX = last.x - middle.x;
  const outgoingY = last.y - middle.y;
  const denominator = Math.hypot(incomingX, incomingY) * Math.hypot(outgoingX, outgoingY);
  if (denominator <= EPSILON) return 0;
  const cosine = clamp((incomingX * outgoingX + incomingY * outgoingY) / denominator, -1, 1);
  return Math.acos(cosine);
}

function distanceToSegment(point: StrokePoint, start: StrokePoint, end: StrokePoint): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared <= EPSILON) return distance(point, start);
  const progress = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(
    point.x - (start.x + deltaX * progress),
    point.y - (start.y + deltaY * progress),
  );
}

function distance(first: Vector, second: Vector): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function add(first: Vector, second: Vector): Vector {
  return { x: first.x + second.x, y: first.y + second.y };
}

function subtract(first: Vector, second: Vector): Vector {
  return { x: first.x - second.x, y: first.y - second.y };
}

function scale(vector: Vector, factor: number): Vector {
  return { x: vector.x * factor, y: vector.y * factor };
}

function interpolate(start: Vector, end: Vector, progress: number): Vector {
  return add(start, scale(subtract(end, start), progress));
}

function normalize(vector: Vector): Vector {
  const length = Math.hypot(vector.x, vector.y);
  return length <= EPSILON ? { x: 0, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

function negate(vector: Vector): Vector {
  return { x: -vector.x, y: -vector.y };
}

function dot(first: Vector, second: Vector): number {
  return first.x * second.x + first.y * second.y;
}

function cross(first: Vector, second: Vector): number {
  return first.x * second.y - first.y * second.x;
}

function squaredLength(vector: Vector): number {
  return dot(vector, vector);
}

function smoothStep(minimum: number, maximum: number, value: number): number {
  const progress = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return progress * progress * (3 - 2 * progress);
}

function requiredPoint(points: readonly StrokePoint[], index: number): StrokePoint {
  const point = points[index];
  if (point === undefined) throw new RangeError(`Missing stroke point at index ${index}.`);
  return point;
}

function requiredVector(points: readonly Vector[], index: number): Vector {
  const point = points[index];
  if (point === undefined) throw new RangeError(`Missing vector at index ${index}.`);
  return point;
}

function clampSplitIndex(index: number, first: number, last: number): number {
  return Math.max(first + 1, Math.min(last - 1, index));
}

function freezeReferences(points: readonly StrokePoint[]): readonly StrokePoint[] {
  return Object.freeze([...points]);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
