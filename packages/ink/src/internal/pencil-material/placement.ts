import { evaluatePressureResponse, type ResolvedBrushSnapshot } from "../../brush-model";
import type { StrokePoint } from "../../types";
import { brushSizeAtPressure } from "../brush-dynamics";
import type { MaterialDab } from "./deposition";

/**
 * Where the tip touched down, and what it was carrying when it did.
 *
 * Placement is by **distance, not by sample**: an arc-length cursor walks the
 * smoothed centreline and drops a dab every fixed advance, so the material is
 * the same whether the device reported 60 or 240 samples a second, and a fast
 * flick cannot leave a gap. That is also what makes the arc distance each dab
 * carries meaningful, and the arc distance is what the accumulation rule reads
 * to tell a retrace from an ordinary overlap.
 *
 * Deposition happens in **page space at the material resolution**, with no
 * rendered scale anywhere in it. The material is deposited once, in the frame
 * the artist drew it in, and a transform is applied to the finished material
 * rather than being folded into how it was made -- which is what lets a moved
 * or scaled object keep the marks it was drawn with instead of resampling a
 * different patch of sheet.
 */

/** Advance between dabs, as a fraction of nominal width, with page guard rails. */
const SPACING_WIDTH_FACTOR = 0.5;
const MINIMUM_SPACING_FLOOR = 0.4;
const MINIMUM_SPACING_CEILING = 1.5;

const MAXIMUM_SMOOTHING_RADIUS = 4;

const EPSILON = 0.000_001;

/**
 * The most of a tip that ever deposits, before the sheet gets its say.
 *
 * Below one so even a hard press leaves tooth showing, which is what stops a
 * pressed pencil from resolving into the line a pen draws. It is numerically
 * the same as the constant of the same name in `pencil.ts`, and deliberately
 * not shared with it: that one is pinned by the geometry model and read against
 * its tip profile, this one is pinned by the material model and read into the
 * contact equation. They agree today because both describe one pencil. The two
 * become one when E4.2B retires the geometry model.
 */
const FULL_COVERAGE = 0.82;

/**
 * The nominal advance between dabs for one brush.
 *
 * Read by the placement cursor and, separately, by the accumulation rule as its
 * passage threshold -- so it is one function rather than one constant applied
 * twice.
 */
export function pencilDabSpacing(brush: ResolvedBrushSnapshot): number {
  return clamp(brush.size * SPACING_WIDTH_FACTOR, MINIMUM_SPACING_FLOOR, MINIMUM_SPACING_CEILING);
}

/** One sample resolved into what the tip was doing there. */
interface PlacedSample {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly coverage: number;
}

/**
 * An arc-length cursor over the centreline.
 *
 * Copyable, because the open tail is walked from the settled cursor every frame
 * and must not disturb it: the copy consumes the unsettled samples, the
 * original stays exactly where the last settled sample left it.
 */
class DabCursor {
  readonly #spacing: number;
  #previous: PlacedSample | null = null;
  #last: MaterialDab | null = null;
  #residual = 0;
  #arc = 0;

  constructor(spacing: number) {
    this.#spacing = spacing;
  }

  clone(): DabCursor {
    const copy = new DabCursor(this.#spacing);
    copy.#previous = this.#previous;
    copy.#last = this.#last;
    copy.#residual = this.#residual;
    copy.#arc = this.#arc;
    return copy;
  }

  consume(next: PlacedSample, into: MaterialDab[]): void {
    const previous = this.#previous;
    this.#previous = next;
    if (previous === null) return;
    const spanX = next.x - previous.x;
    const spanY = next.y - previous.y;
    const length = Math.hypot(spanX, spanY);
    if (length < EPSILON) return;
    while (this.#residual <= length) {
      const progress = this.#residual / length;
      const dab: MaterialDab = {
        x: previous.x + spanX * progress,
        y: previous.y + spanY * progress,
        radius: previous.radius + (next.radius - previous.radius) * progress,
        coverage: previous.coverage + (next.coverage - previous.coverage) * progress,
        arc: this.#arc + this.#residual,
      };
      into.push(dab);
      this.#last = dab;
      this.#residual += this.#spacing;
    }
    this.#residual -= length;
    this.#arc += length;
  }

  /**
   * Where the pencil stopped is information no later sample can supply, so the
   * last position always receives graphite even when the cursor has not come
   * round again. A dab already standing there is not repeated.
   */
  terminal(into: MaterialDab[]): void {
    const previous = this.#previous;
    if (previous === null) return;
    const last = this.#last;
    if (last !== null && Math.hypot(last.x - previous.x, last.y - previous.y) <= EPSILON) return;
    into.push({
      x: previous.x,
      y: previous.y,
      radius: previous.radius,
      coverage: previous.coverage,
      arc: this.#arc,
    });
  }
}

/** One frame's worth of placement: what has settled, and what is still moving. */
export interface PlacedDabs {
  /** Permanent. Never re-evaluated, and therefore safe to index and cache. */
  readonly settled: readonly MaterialDab[];
  /** The open tail, discarded and re-derived on the next append. */
  readonly tail: readonly MaterialDab[];
}

/**
 * Turns a growing sample array into a dab stream without re-walking it.
 *
 * The settled-prefix contract is the same one every engine strategy honours: a
 * sample that has the smoothing window's worth of successors behind it can
 * never move again, so the dabs it produced are permanent. Only the tail is
 * rebuilt per frame, which is what keeps a frame independent of how long the
 * stroke already is.
 */
export class PencilDabPlacement {
  readonly #brush: ResolvedBrushSnapshot;
  readonly #spacing: number;
  readonly #smoothingRadius: number;
  readonly #smoothingAmount: number;
  readonly #lookaheadSamples: number;
  #cursor: DabCursor;
  #settledSamples = 0;

  constructor(brush: ResolvedBrushSnapshot) {
    this.#brush = brush;
    const smoothing = brush.smoothing;
    const active = smoothing.mode !== "none" && smoothing.amount > 0;
    this.#smoothingAmount = active ? clamp(smoothing.amount, 0, 1) : 0;
    this.#smoothingRadius = active
      ? Math.min(MAXIMUM_SMOOTHING_RADIUS, 1 + Math.floor(this.#smoothingAmount * 3))
      : 0;
    this.#lookaheadSamples = Math.max(this.#smoothingRadius, 1);
    this.#spacing = pencilDabSpacing(brush);
    this.#cursor = new DabCursor(this.#spacing);
  }

  /** The nominal advance, which the accumulation rule reads as its passage threshold. */
  get spacing(): number {
    return this.#spacing;
  }

  get lookaheadSamples(): number {
    return this.#lookaheadSamples;
  }

  get settledSampleCount(): number {
    return this.#settledSamples;
  }

  append(points: readonly StrokePoint[], final: boolean): PlacedDabs {
    const settled: MaterialDab[] = [];
    const tail: MaterialDab[] = [];
    const last = points.length - 1;
    const limit = final ? points.length : Math.max(0, points.length - this.#lookaheadSamples);
    while (this.#settledSamples < limit) {
      const index = this.#settledSamples;
      this.#cursor.consume(this.#evaluate(points, index, final && index === last), settled);
      this.#settledSamples = index + 1;
    }
    if (final) {
      this.#cursor.terminal(settled);
      return { settled, tail };
    }
    // The newest sample is treated as terminal whether or not the stroke has
    // ended, so the last graphite sits exactly under the tip rather than
    // lagging a dab behind it -- which is why lifting the pencil moves nothing.
    const cursor = this.#cursor.clone();
    for (let index = limit; index < points.length; index += 1) {
      cursor.consume(this.#evaluate(points, index, index === last), tail);
    }
    cursor.terminal(tail);
    return { settled, tail };
  }

  /**
   * Position, radius and coverage under one fixed window.
   *
   * All three take the same weights for the same reason: a quantity that stops
   * changing once it has a fixed number of successors is a quantity that can
   * settle. Both ends stay exactly where the pencil was, at exactly the
   * pressure it reported -- smoothing an endpoint pulls the mark away from
   * where the artist started or stopped it.
   */
  #evaluate(points: readonly StrokePoint[], index: number, terminal: boolean): PlacedSample {
    const current = requirePoint(points, index);
    const radius = this.#smoothingRadius;
    if (radius === 0 || index === 0 || terminal) {
      return this.#resolve(current.x, current.y, normalizePressure(current.pressure));
    }
    const first = Math.max(0, index - radius);
    const last = Math.min(points.length - 1, index + radius);
    let totalWeight = 0;
    let weightedX = 0;
    let weightedY = 0;
    let weightedPressure = 0;
    for (let sampleIndex = first; sampleIndex <= last; sampleIndex += 1) {
      const sample = requirePoint(points, sampleIndex);
      const weight = radius + 1 - Math.abs(sampleIndex - index);
      totalWeight += weight;
      weightedX += sample.x * weight;
      weightedY += sample.y * weight;
      weightedPressure += normalizePressure(sample.pressure) * weight;
    }
    const amount = this.#smoothingAmount;
    const pressure = normalizePressure(current.pressure);
    return this.#resolve(
      current.x + (weightedX / totalWeight - current.x) * amount,
      current.y + (weightedY / totalWeight - current.y) * amount,
      clamp(pressure + (weightedPressure / totalWeight - pressure) * amount, 0, 1),
    );
  }

  /**
   * What one pressure means for this brush.
   *
   * Width reads `pressureSize` exactly as every other strategy does. Coverage
   * reads `pressureOpacity`, which for a dry medium is the honest reading of
   * that response: a lighter touch deposits less graphite across the tip rather
   * than depositing translucent graphite. With the response disabled -- which
   * is how a mouse resolves -- the factor is one and the pencil deposits at its
   * full configured coverage.
   */
  #resolve(x: number, y: number, pressure: number): PlacedSample {
    return {
      x,
      y,
      radius: Math.max(brushSizeAtPressure(this.#brush, pressure) / 2, EPSILON),
      coverage: clamp(
        FULL_COVERAGE * evaluatePressureResponse(this.#brush.dynamics.pressureOpacity, pressure),
        0,
        1,
      ),
    };
  }
}

/** Every dab of one complete stroke, in one pass. */
export function placePencilDabs(
  points: readonly StrokePoint[],
  brush: ResolvedBrushSnapshot,
): readonly MaterialDab[] {
  return new PencilDabPlacement(brush).append(points, true).settled;
}

function requirePoint(points: readonly StrokePoint[], index: number): StrokePoint {
  const point = points[index];
  if (point === undefined) throw new RangeError(`Stroke point ${String(index)} is missing.`);
  return point;
}

function normalizePressure(pressure: number): number {
  return Number.isFinite(pressure) ? clamp(pressure, 0, 1) : 0.5;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}
