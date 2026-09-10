import type { InkPointerType, StrokeSmoothingMode, StrokeStyle } from "./types";

export type BrushFamily = "pencil" | "pen" | "marker" | "highlighter";
export type BrushRendererKind = "centerline" | "outline";
export type BrushPressureCurveKind = "linear" | "power";

export interface BrushSmoothing {
  readonly mode: StrokeSmoothingMode;
  readonly amount: number;
}

/** Durable pressure behavior is data-defined so finalized strokes remain serializable. */
export interface BrushPressureCurve {
  readonly kind: BrushPressureCurveKind;
  readonly exponent: number;
}

export interface BrushPressureResponse {
  readonly enabled: boolean;
  readonly minimumFactor: number;
  readonly maximumFactor: number;
  readonly curve: BrushPressureCurve;
}

export interface BrushDynamics {
  readonly pressureSize: BrushPressureResponse;
  readonly pressureOpacity: BrushPressureResponse;
}

export interface BrushRendererDefinition {
  readonly version: 1;
  readonly kind: BrushRendererKind;
}

export interface BrushPresetDefaults {
  readonly color: string;
  readonly size: number;
  readonly opacity: number;
  readonly smoothing: BrushSmoothing;
}

export interface BrushPreset {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly family: BrushFamily;
  readonly defaults: BrushPresetDefaults;
  readonly dynamics: BrushDynamics;
  readonly renderer: BrushRendererDefinition;
}

export interface ResolvedBrushOverrides {
  readonly color?: string;
  readonly size?: number;
  readonly opacity?: number;
  readonly smoothing?: BrushSmoothing;
}

export interface ResolvedBrushSnapshot {
  readonly schemaVersion: 1;
  readonly presetId: string;
  readonly presetVersion: number;
  readonly family: BrushFamily;
  readonly color: string;
  readonly size: number;
  readonly opacity: number;
  readonly smoothing: BrushSmoothing;
  readonly dynamics: BrushDynamics;
  readonly renderer: BrushRendererDefinition;
}

/** Validates, clones, and deeply freezes one static JSON-safe brush definition. */
export function createBrushPreset(input: BrushPreset): BrushPreset {
  assertIdentity(input.id, "Brush preset id");
  assertIdentity(input.name, "Brush preset name");
  assertVersion(input.version, "Brush preset version");
  assertFamily(input.family);
  return Object.freeze({
    id: input.id,
    version: input.version,
    name: input.name,
    family: input.family,
    defaults: freezeDefaults(input.defaults),
    dynamics: freezeDynamics(input.dynamics),
    renderer: freezeRenderer(input.renderer),
  });
}

/** Resolves mutable tool overrides into a catalog-independent immutable stroke snapshot. */
export function resolveBrushPreset(
  preset: BrushPreset,
  overrides: ResolvedBrushOverrides = {},
): ResolvedBrushSnapshot {
  const definition = createBrushPreset(preset);
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId: definition.id,
    presetVersion: definition.version,
    family: definition.family,
    color: overrides.color ?? definition.defaults.color,
    size: overrides.size ?? definition.defaults.size,
    opacity: overrides.opacity ?? definition.defaults.opacity,
    smoothing: overrides.smoothing ?? definition.defaults.smoothing,
    dynamics: definition.dynamics,
    renderer: definition.renderer,
  });
}

/** Resolves a preset-capable brush to the actual renderer frozen into a new stroke. */
export function resolveBrushForPointerType(
  brush: ResolvedBrushSnapshot,
  pointerType: InkPointerType,
): ResolvedBrushSnapshot {
  const snapshot = createResolvedBrushSnapshot(brush);
  // Mouse pressure is intentionally synthetic and fixed at 0.5, so expressive outline brushes
  // use the constant-width centerline strategy. Pen and touch retain the preset capability.
  if (pointerType !== "mouse" || snapshot.renderer.kind !== "outline") {
    return snapshot;
  }
  return createResolvedBrushSnapshot({
    ...snapshot,
    renderer: Object.freeze({ version: 1, kind: "centerline" }),
  });
}

/** Validates and deeply freezes brush metadata supplied at a Stroke boundary. */
export function createResolvedBrushSnapshot(input: ResolvedBrushSnapshot): ResolvedBrushSnapshot {
  if (input.schemaVersion !== 1) {
    throw new TypeError("Resolved brush snapshot schema version must be 1.");
  }
  assertIdentity(input.presetId, "Resolved brush preset id");
  assertVersion(input.presetVersion, "Resolved brush preset version");
  assertFamily(input.family);
  assertColor(input.color);
  assertPositive(input.size, "Resolved brush size");
  assertUnitInterval(input.opacity, "Resolved brush opacity");
  return Object.freeze({
    schemaVersion: 1,
    presetId: input.presetId,
    presetVersion: input.presetVersion,
    family: input.family,
    color: input.color,
    size: input.size,
    opacity: input.opacity,
    smoothing: freezeSmoothing(input.smoothing),
    dynamics: freezeDynamics(input.dynamics),
    renderer: freezeRenderer(input.renderer),
  });
}

/** Internal compatibility projection for direct StrokeStyle consumers predating Phase 17A. */
export function createLegacyBrushSnapshot(
  style: Pick<StrokeStyle, "color" | "width" | "opacity" | "pressureEnabled">,
  family: Extract<BrushFamily, "pen" | "highlighter"> = "pen",
  presetId = "legacy-stroke-style",
): ResolvedBrushSnapshot {
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId,
    presetVersion: 1,
    family,
    color: style.color,
    size: style.width,
    opacity: style.opacity,
    smoothing: Object.freeze({ mode: "none", amount: 0 }),
    dynamics: Object.freeze({
      pressureSize: Object.freeze({
        enabled: style.pressureEnabled,
        minimumFactor: style.pressureEnabled ? 0.5 : 1,
        maximumFactor: style.pressureEnabled ? 1.5 : 1,
        curve: Object.freeze({ kind: "linear", exponent: 1 }),
      }),
      pressureOpacity: Object.freeze({
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: Object.freeze({ kind: "linear", exponent: 1 }),
      }),
    }),
    renderer: Object.freeze({ version: 1, kind: "centerline" }),
  });
}

/** Evaluates one serializable pressure response without executable preset callbacks. */
export function evaluatePressureResponse(
  response: BrushPressureResponse,
  pressure: number,
): number {
  const definition = freezePressureResponse(response, "Pressure response");
  if (!definition.enabled) return 1;
  const normalized = Math.min(1, Math.max(0, Number.isFinite(pressure) ? pressure : 0.5));
  const curved =
    definition.curve.kind === "power"
      ? Math.pow(normalized, definition.curve.exponent)
      : normalized;
  return definition.minimumFactor + (definition.maximumFactor - definition.minimumFactor) * curved;
}

function freezeDefaults(input: BrushPresetDefaults): BrushPresetDefaults {
  assertColor(input.color);
  assertPositive(input.size, "Brush default size");
  assertUnitInterval(input.opacity, "Brush default opacity");
  return Object.freeze({
    color: input.color,
    size: input.size,
    opacity: input.opacity,
    smoothing: freezeSmoothing(input.smoothing),
  });
}

function freezeSmoothing(input: BrushSmoothing): BrushSmoothing {
  if (
    input.mode !== "none" &&
    input.mode !== "average" &&
    input.mode !== "catmull-rom" &&
    input.mode !== "bezier"
  ) {
    throw new TypeError("Brush smoothing mode is invalid.");
  }
  assertUnitInterval(input.amount, "Brush smoothing amount");
  return Object.freeze({ mode: input.mode, amount: input.amount });
}

function freezeDynamics(input: BrushDynamics): BrushDynamics {
  return Object.freeze({
    pressureSize: freezePressureResponse(input.pressureSize, "Pressure-size response"),
    pressureOpacity: freezePressureResponse(input.pressureOpacity, "Pressure-opacity response"),
  });
}

function freezePressureResponse(
  input: BrushPressureResponse,
  label: string,
): BrushPressureResponse {
  assertNonNegative(input.minimumFactor, `${label} minimum factor`);
  assertNonNegative(input.maximumFactor, `${label} maximum factor`);
  if (input.minimumFactor > input.maximumFactor) {
    throw new RangeError(`${label} minimum factor must not exceed its maximum factor.`);
  }
  if (input.curve.kind !== "linear" && input.curve.kind !== "power") {
    throw new TypeError(`${label} curve kind is invalid.`);
  }
  assertPositive(input.curve.exponent, `${label} curve exponent`);
  return Object.freeze({
    enabled: input.enabled,
    minimumFactor: input.minimumFactor,
    maximumFactor: input.maximumFactor,
    curve: Object.freeze({ kind: input.curve.kind, exponent: input.curve.exponent }),
  });
}

function freezeRenderer(input: BrushRendererDefinition): BrushRendererDefinition {
  if (input.version !== 1 || (input.kind !== "centerline" && input.kind !== "outline")) {
    throw new TypeError("Brush renderer definition is invalid.");
  }
  return Object.freeze({ version: 1, kind: input.kind });
}

function assertIdentity(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must not be empty.`);
  }
}

function assertVersion(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function assertFamily(value: BrushFamily): void {
  if (value !== "pencil" && value !== "pen" && value !== "marker" && value !== "highlighter") {
    throw new TypeError("Brush family is invalid.");
  }
}

function assertColor(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Brush color must not be empty.");
  }
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive.`);
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be finite and non-negative.`);
  }
}

function assertUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be between zero and one.`);
  }
}
