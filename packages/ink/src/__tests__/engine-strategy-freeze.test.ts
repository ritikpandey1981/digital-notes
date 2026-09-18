import { describe, expect, it } from "vitest";
import {
  createResolvedBrushSnapshot,
  type BrushPressureResponse,
  type BrushSmoothing,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import {
  resolveStrokeRenderGeometry,
  type BrushRenderGeometry,
} from "../internal/brush-render-strategy";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { Stroke } from "../stroke";
import type { StrokePointInput } from "../types";

/**
 * A shipped `(kind, version)` draws the same pixels for ever.
 *
 * [`legacy-strategy-freeze.test.ts`](legacy-strategy-freeze.test.ts) guards the
 * two strategies that predate the engine, and does it partly by transcribing
 * the dispatch they used to reach. The strategies built on the engine have no
 * such prior implementation to compare against, so their gate is a pinned
 * digest of everything a painter would read. Whether that geometry is *right*
 * is settled by the behavioural suites; what this file settles is that it never
 * quietly becomes something else.
 */

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });
const OFF: BrushPressureResponse = Object.freeze({
  enabled: false,
  minimumFactor: 1,
  maximumFactor: 1,
  curve: LINEAR,
});

type EngineStrategy = "technical-pen" | "pressure-pen" | "pencil";

function engineBrush(kind: EngineStrategy, smoothing: BrushSmoothing): ResolvedBrushSnapshot {
  const expressive = kind !== "technical-pen";
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: `frozen-${kind}`,
    presetVersion: 1,
    family: kind === "pencil" ? "pencil" : "pen",
    color: "#111111",
    size: 6,
    opacity: 0.9,
    smoothing,
    dynamics: Object.freeze({
      pressureSize: expressive
        ? Object.freeze({
            enabled: true,
            minimumFactor: 0.35,
            maximumFactor: 1.65,
            curve: LINEAR,
          })
        : OFF,
      pressureOpacity: expressive
        ? Object.freeze({
            enabled: true,
            minimumFactor: 0.7,
            maximumFactor: 1,
            curve: Object.freeze({ kind: "power" as const, exponent: 0.55 }),
          })
        : OFF,
    }),
    renderer: Object.freeze({ version: 1, kind }),
  });
}

/** A curve, a corner and a full pressure sweep in one stroke. */
function frozenStroke(brush: ResolvedBrushSnapshot, id: string): Stroke {
  const builder = new StrokeBuilder({
    id,
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  const count = 64;
  for (let index = 0; index < count; index += 1) {
    const turning = index >= 40;
    const input: StrokePointInput = {
      x: turning ? 200 : 40 + index * 4,
      y: turning ? 40 + (index - 39) * 5 : 40 + Math.sin(index / 5) * 28,
      timestamp: index * 8,
      pressure: 0.05 + (0.9 * index) / (count - 1),
      tiltX: 0,
      tiltY: 0,
      twist: 0,
      pointerType: "pen",
      button: 0,
      buttons: 1,
    };
    builder.addPoint(input);
  }
  return builder.finalize();
}

function digest(geometry: BrushRenderGeometry): string {
  const round = (value: number): string => value.toFixed(6);
  const point = (value: Readonly<{ x: number; y: number }>): string =>
    `${round(value.x)},${round(value.y)}`;
  const parts = [
    geometry.kind,
    round(geometry.bounds.x),
    round(geometry.bounds.y),
    round(geometry.bounds.width),
    round(geometry.bounds.height),
  ];
  if (geometry.kind === "stroked-path") {
    parts.push(round(geometry.width), String(geometry.keptPointCount));
    parts.push(geometry.origin === null ? "none" : point(geometry.origin));
    for (const segment of geometry.segments) {
      parts.push(
        round(segment.startX),
        round(segment.startY),
        round(segment.control1X),
        round(segment.control1Y),
        round(segment.control2X),
        round(segment.control2Y),
        round(segment.endX),
        round(segment.endY),
      );
    }
  }
  if (geometry.kind === "filled-path") {
    parts.push(String(geometry.keptPointCount), String(geometry.bands.length));
    parts.push(
      geometry.dot === null
        ? "none"
        : `${point(geometry.dot.center)},${round(geometry.dot.radius)}`,
    );
    for (const entry of geometry.hitGeometry) parts.push(point(entry), round(entry.radius));
    for (const band of geometry.bands) {
      parts.push(
        round(band.alpha),
        band.roundStart ? "s" : "-",
        band.roundEnd ? "e" : "-",
        point(band.startCenter),
        round(band.startRadius),
        point(band.endCenter),
        round(band.endRadius),
      );
      for (const vertex of band.left) parts.push(point(vertex));
      for (const vertex of band.right) parts.push(point(vertex));
    }
  }
  if (geometry.kind === "material") {
    // A deposited medium's pixels are not in its geometry, so what is pinned
    // here is everything that decides them: the dab stream, and which tiles it
    // reaches. The bytes themselves are pinned by the material suites, against
    // the resources and the equation that produce them.
    parts.push(
      round(geometry.alpha),
      String(geometry.markCount),
      String(geometry.stamps.length),
      String(geometry.tileKeys.length),
    );
    parts.push(
      geometry.dot === null
        ? "none"
        : `${point(geometry.dot.center)},${round(geometry.dot.radius)}`,
    );
    for (const stamp of geometry.stamps) {
      parts.push(point(stamp), round(stamp.radius), round(stamp.coverage), String(stamp.markCount));
    }
    for (const key of geometry.tileKeys) parts.push(key);
  }
  return parts.join("|");
}

describe("frozen engine brush strategies", () => {
  it("pins the exact geometry each engine strategy produces", () => {
    const cases = [
      ["technical-pen", Object.freeze({ mode: "none", amount: 0 }) as BrushSmoothing],
      ["technical-pen", Object.freeze({ mode: "average", amount: 0.3 }) as BrushSmoothing],
      ["pressure-pen", Object.freeze({ mode: "none", amount: 0 }) as BrushSmoothing],
      ["pressure-pen", Object.freeze({ mode: "average", amount: 0.18 }) as BrushSmoothing],
      ["pencil", Object.freeze({ mode: "none", amount: 0 }) as BrushSmoothing],
      ["pencil", Object.freeze({ mode: "average", amount: 0.2 }) as BrushSmoothing],
    ] as const;
    const digests = cases.map(([kind, smoothing]) => {
      const brush = engineBrush(kind, smoothing);
      const stroke = frozenStroke(brush, `frozen-${kind}-${smoothing.amount}`);
      return `${kind}@${smoothing.amount}:${hash(digest(resolveStrokeRenderGeometry(stroke)))}`;
    });

    // Regenerating these to make a failing run pass would defeat the gate. A
    // change here means artwork already saved would look different than it did.
    //
    // The Pencil pair has been re-pinned twice, in E4.1 and again in E4.2 when
    // the strategy stopped drawing contours and started depositing material.
    // Both were before the strategy had shipped in a release, which is the only
    // circumstance in which one of these moves without a new version: no saved
    // artwork could yet be looking at the old digest. After the release that
    // ships Pencil the same refinement is `pencil@2`, without exception. The two
    // pens have shipped, and theirs have never moved.
    expect(digests).toEqual([
      "technical-pen@0:x1q4l0",
      "technical-pen@0.3:a2i6kf",
      "pressure-pen@0:6bm694",
      "pressure-pen@0.18:92y0oo",
      "pencil@0:4w2vy8",
      "pencil@0.2:1gzmcdl",
    ]);
  });

  it("pins them at a non-unit rendered scale too", () => {
    // Scale is where a variable-width silhouette differs from a stroked path:
    // it resamples, so a change to its spacing rule would show up only here.
    const brush = engineBrush("pressure-pen", Object.freeze({ mode: "average", amount: 0.18 }));
    const stroke = frozenStroke(brush, "frozen-pressure-pen-scaled");
    const digests = [0.5, 2.5].map(
      (scale) => `${scale}:${hash(digest(resolveStrokeRenderGeometry(stroke, scale)))}`,
    );
    expect(digests).toEqual(["0.5:58sh20", "2.5:1drflrf"]);
  });

  it("gives Pencil one deposit whatever the object's scale", () => {
    // Material is deposited once in the artwork's own frame and the object
    // transform is applied when it is painted, so scale cannot reach the
    // deposit. A digest that moved with scale would mean a resized object was
    // resampling the sheet -- and coming back a different drawing.
    const brush = engineBrush("pencil", Object.freeze({ mode: "average", amount: 0.2 }));
    const stroke = frozenStroke(brush, "frozen-pencil-scaled");
    const digests = [0.5, 1, 2.5].map((scale) =>
      hash(digest(resolveStrokeRenderGeometry(stroke, scale))),
    );
    expect(new Set(digests).size).toBe(1);
    expect(digests[0]).toBe("1gzmcdl");
  });
});

/** Compact, order-sensitive digest so a golden expectation stays readable. */
function hash(value: string): string {
  let accumulator = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    accumulator ^= value.charCodeAt(index);
    accumulator = Math.imul(accumulator, 0x01000193);
  }
  return (accumulator >>> 0).toString(36);
}
