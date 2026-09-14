import { describe, expect, it } from "vitest";
import {
  brushStrategyKey,
  createResolvedBrushSnapshot,
  isSupportedBrushStrategy,
  supportedBrushStrategies,
  type BrushRendererDefinition,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import { InkError } from "../errors";
import {
  createBrushRenderGeometry,
  drawBrushRenderGeometry,
  registeredBrushStrategies,
  resolveStrokeRenderGeometry,
} from "../internal/brush-render-strategy";
import { Stroke } from "../stroke";
import { StrokeBuilder } from "../stroke-builder";
import { StrokeSmoother } from "../stroke-smoother";
import type { StrokePointInput } from "../types";

const LINEAR = Object.freeze({ kind: "linear" as const, exponent: 1 });

function snapshot(renderer: BrushRendererDefinition): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: "vocabulary-test",
    presetVersion: 1,
    family: "pen",
    color: "#111111",
    size: 4,
    opacity: 1,
    smoothing: Object.freeze({ mode: "none", amount: 0 }),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: LINEAR,
      }),
      pressureOpacity: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: LINEAR,
      }),
    }),
    renderer,
  });
}

function point(x: number, y: number, index: number): StrokePointInput {
  return {
    x,
    y,
    timestamp: index * 8,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    twist: 0,
    pointerType: "pen",
    button: 0,
    buttons: 1,
  };
}

function strokeWith(brush: ResolvedBrushSnapshot): Stroke {
  const builder = new StrokeBuilder({
    id: `stroke-${brush.renderer.kind}`,
    timestamp: 0,
    brush,
    smoother: new StrokeSmoother({ mode: "none" }),
  });
  for (let index = 0; index < 6; index += 1) builder.addPoint(point(index * 12, index * 3, index));
  return builder.finalize();
}

/** Forges a snapshot the validators would refuse, to reach the renderer's own guard. */
function forgedSnapshot(kind: string, version: number): ResolvedBrushSnapshot {
  const valid = snapshot({ version: 1, kind: "centerline" });
  return Object.freeze({
    ...valid,
    renderer: Object.freeze({ version, kind }),
  }) as ResolvedBrushSnapshot;
}

describe("brush strategy vocabulary", () => {
  it("accepts exactly the strategies this build renders", () => {
    expect(supportedBrushStrategies()).toEqual(["centerline@1", "outline@1", "technical-pen@1"]);
    expect(isSupportedBrushStrategy("centerline", 1)).toBe(true);
    expect(isSupportedBrushStrategy("outline", 1)).toBe(true);
    expect(isSupportedBrushStrategy("technical-pen", 1)).toBe(true);
  });

  it("keeps the durable vocabulary and the renderer registry in step", () => {
    // Two tables that can disagree is the failure this gate exists to catch: a
    // snapshot the model accepts but no strategy can draw, or the reverse.
    expect(registeredBrushStrategies()).toEqual(supportedBrushStrategies());
  });

  it.each([
    ["an unknown kind", "unknown-brush", 1],
    ["a strategy a later phase will add", "pencil", 1],
    ["a future version of a known kind", "centerline", 2],
    ["a future version of Technical Pen", "technical-pen", 2],
    ["a zero version", "outline", 0],
    ["a negative version", "outline", -1],
    ["a fractional version", "outline", 1.5],
  ] as const)("rejects %s", (_, kind, version) => {
    expect(isSupportedBrushStrategy(kind, version)).toBe(false);
    expect(() => snapshot({ version, kind } as unknown as BrushRendererDefinition)).toThrow(
      TypeError,
    );
  });

  it("rejects a non-string kind and a non-numeric version without throwing", () => {
    expect(isSupportedBrushStrategy(null, 1)).toBe(false);
    expect(isSupportedBrushStrategy("centerline", "1")).toBe(false);
    expect(isSupportedBrushStrategy("centerline", Number.NaN)).toBe(false);
  });

  it("builds one lookup key per durable identity", () => {
    expect(brushStrategyKey("centerline", 1)).toBe("centerline@1");
    expect(brushStrategyKey("outline", 3)).toBe("outline@3");
  });

  it("preserves the exact version a snapshot names rather than pinning it to one", () => {
    // The field carried a literal 1 before it meant anything. It now round-trips,
    // which is what lets a later version of a strategy exist beside its ancestor.
    expect(snapshot({ version: 1, kind: "outline" }).renderer).toEqual({
      version: 1,
      kind: "outline",
    });
  });

  it("refuses to render a forged strategy instead of substituting a nearby one", () => {
    const forged = forgedSnapshot("technical-pen", 99);
    const stroke = strokeWith(snapshot({ version: 1, kind: "centerline" }));
    const unsupported = Object.freeze({ ...stroke, brush: forged }) as unknown as Stroke;

    expect(() => createBrushRenderGeometry(stroke.points, forged)).toThrow(InkError);
    expect(() => resolveStrokeRenderGeometry(unsupported)).toThrow(InkError);
    expect(() =>
      drawBrushRenderGeometry(
        {} as CanvasRenderingContext2D,
        { kind: "centerline" } as never,
        forged,
      ),
    ).toThrow(InkError);

    try {
      createBrushRenderGeometry(stroke.points, forged);
      expect.unreachable("An unregistered strategy must not render.");
    } catch (error) {
      expect(error).toBeInstanceOf(InkError);
      expect((error as InkError).code).toBe("UNSUPPORTED_BRUSH_STRATEGY");
      expect((error as InkError).details).toEqual({ kind: "technical-pen", version: 99 });
    }
  });
});
