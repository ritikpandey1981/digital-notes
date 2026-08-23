import { describe, expect, it } from "vitest";
import {
  createBrushPreset,
  evaluatePressureResponse,
  resolveBrushPreset,
  type BrushPreset,
} from "../brush-model";

function presetInput(): BrushPreset {
  return {
    id: "test-pen",
    version: 1,
    name: "Test Pen",
    family: "pen",
    defaults: {
      color: "#111111",
      size: 2,
      opacity: 1,
      smoothing: { mode: "none", amount: 0 },
    },
    dynamics: {
      pressureSize: {
        enabled: true,
        minimumFactor: 0.5,
        maximumFactor: 1.5,
        curve: { kind: "linear", exponent: 1 },
      },
      pressureOpacity: {
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: { kind: "linear", exponent: 1 },
      },
    },
    renderer: { version: 1, kind: "centerline" },
  };
}

describe("Brush model", () => {
  it("creates deterministic deeply immutable versioned preset definitions", () => {
    const first = createBrushPreset(presetInput());
    const second = createBrushPreset(presetInput());

    expect(first).toEqual(second);
    expect(first.version).toBe(1);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.defaults)).toBe(true);
    expect(Object.isFrozen(first.defaults.smoothing)).toBe(true);
    expect(Object.isFrozen(first.dynamics.pressureSize.curve)).toBe(true);
    expect(Object.isFrozen(first.renderer)).toBe(true);
  });

  it("rejects invalid identities, versions, factors, smoothing, and renderer definitions", () => {
    expect(() => createBrushPreset({ ...presetInput(), id: "" })).toThrow(TypeError);
    expect(() => createBrushPreset({ ...presetInput(), version: 0 })).toThrow(RangeError);
    expect(() =>
      createBrushPreset({
        ...presetInput(),
        dynamics: {
          ...presetInput().dynamics,
          pressureSize: {
            ...presetInput().dynamics.pressureSize,
            minimumFactor: 2,
            maximumFactor: 1,
          },
        },
      }),
    ).toThrow(RangeError);
    expect(() =>
      createBrushPreset({
        ...presetInput(),
        defaults: {
          ...presetInput().defaults,
          smoothing: { mode: "none", amount: Number.NaN },
        },
      }),
    ).toThrow(RangeError);
    expect(() =>
      createBrushPreset({
        ...presetInput(),
        renderer: { version: 1, kind: "stamp" as "centerline" },
      }),
    ).toThrow(TypeError);
  });

  it("resolves active overrides into a deeply immutable JSON-safe snapshot", () => {
    const snapshot = resolveBrushPreset(createBrushPreset(presetInput()), {
      color: "#2563eb",
      size: 6,
      opacity: 0.7,
      smoothing: { mode: "average", amount: 0.4 },
    });

    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      presetId: "test-pen",
      presetVersion: 1,
      family: "pen",
      color: "#2563eb",
      size: 6,
      opacity: 0.7,
      smoothing: { mode: "average", amount: 0.4 },
      renderer: { version: 1, kind: "centerline" },
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(containsNonJsonValue(snapshot)).toBe(false);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.dynamics.pressureOpacity.curve)).toBe(true);
  });

  it("evaluates named linear and power pressure curves without callbacks", () => {
    const linear = presetInput().dynamics.pressureSize;
    expect(evaluatePressureResponse(linear, 0)).toBe(0.5);
    expect(evaluatePressureResponse(linear, 0.5)).toBe(1);
    expect(evaluatePressureResponse(linear, 1)).toBe(1.5);
    expect(
      evaluatePressureResponse({ ...linear, curve: { kind: "power", exponent: 2 } }, 0.5),
    ).toBe(0.75);
    expect(evaluatePressureResponse(presetInput().dynamics.pressureOpacity, 0.2)).toBe(1);
  });
});

function containsNonJsonValue(value: unknown): boolean {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return true;
  if (value === null || typeof value !== "object") {
    return typeof value === "number" && !Number.isFinite(value);
  }
  if (Array.isArray(value)) return value.some(containsNonJsonValue);
  if (Object.getPrototypeOf(value) !== Object.prototype) return true;
  return Object.values(value as Record<string, unknown>).some(containsNonJsonValue);
}
