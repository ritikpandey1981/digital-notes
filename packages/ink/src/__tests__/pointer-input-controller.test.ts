import { CoordinateConverter, Viewport } from "@folio/rendering";
import { describe, expect, it, vi } from "vitest";
import { PointerInputController } from "../pointer-input-controller";
import {
  createResolvedBrushSnapshot,
  type BrushFamily,
  type BrushRendererKind,
  type ResolvedBrushSnapshot,
} from "../brush-model";
import { StrokeSmoother } from "../stroke-smoother";

function createTarget() {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const viewListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  const captured = new Set<number>();
  let failCapture = false;
  const view = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const group = viewListeners.get(type) ?? new Set();
      group.add(listener);
      viewListeners.set(type, group);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      viewListeners.get(type)?.delete(listener);
    },
  } as unknown as Window;
  const target = {
    ownerDocument: { defaultView: view },
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      const group = listeners.get(type) ?? new Set();
      group.add(listener);
      listeners.set(type, group);
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(listener);
    },
    setPointerCapture(pointerId: number) {
      if (failCapture) throw new Error("capture failed");
      captured.add(pointerId);
    },
    releasePointerCapture(pointerId: number) {
      captured.delete(pointerId);
    },
    hasPointerCapture(pointerId: number) {
      return captured.has(pointerId);
    },
  } as unknown as HTMLElement;
  return {
    target,
    listeners,
    viewListeners,
    captured,
    dispatchWindowBlur() {
      for (const listener of viewListeners.get("blur") ?? []) {
        if (typeof listener === "function") listener(new Event("blur"));
        else listener.handleEvent(new Event("blur"));
      }
    },
    setCaptureFailure(value: boolean) {
      failCapture = value;
    },
  };
}

interface EventOptions {
  readonly pointerId?: number;
  readonly pointerType?: string;
  readonly x?: number;
  readonly y?: number;
  readonly timestamp?: number;
  readonly pressure?: number;
  readonly button?: number;
  readonly buttons?: number;
  readonly isPrimary?: boolean;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly twist?: number;
  readonly coalesced?: readonly PointerEvent[];
}

function pointerEvent(options: EventOptions = {}): PointerEvent {
  return {
    pointerId: options.pointerId ?? 1,
    pointerType: options.pointerType ?? "mouse",
    clientX: options.x ?? 500,
    clientY: options.y ?? 400,
    timeStamp: options.timestamp ?? 100,
    pressure: options.pressure ?? 0.5,
    tiltX: options.tiltX ?? 0,
    tiltY: options.tiltY ?? 0,
    twist: options.twist ?? 0,
    altitudeAngle: undefined,
    azimuthAngle: undefined,
    button: options.button ?? 0,
    buttons: options.buttons ?? 1,
    isPrimary: options.isPrimary ?? true,
    preventDefault: vi.fn(),
    getCoalescedEvents: () => options.coalesced ?? [],
  } as unknown as PointerEvent;
}

function createHarness(
  bounds = { x: 0, y: 0, width: 1_000, height: 800 },
  useDefaultSmoother = false,
  resolveBrush?: () => ResolvedBrushSnapshot,
) {
  const viewport = new Viewport({
    size: { width: 1_000, height: 800 },
    pageRect: { x: 0, y: 0, width: 600, height: 700 },
  });
  viewport.centerPage();
  const targetHarness = createTarget();
  const onStrokeStart = vi.fn();
  const onStrokeUpdate = vi.fn();
  const onStrokeFinalized = vi.fn();
  const onStrokeCancelled = vi.fn();
  const onError = vi.fn();
  const getCanvasBounds = vi.fn(() => bounds);
  const controller = new PointerInputController({
    coordinateConverter: new CoordinateConverter(viewport),
    getCanvasBounds,
    ...(useDefaultSmoother ? {} : { smoother: new StrokeSmoother({ mode: "none" }) }),
    ...(resolveBrush === undefined ? {} : { resolveBrush }),
    createId: () => "pointer-stroke",
    onStrokeStart,
    onStrokeUpdate,
    onStrokeFinalized,
    onStrokeCancelled,
    onError,
  });
  controller.attach(targetHarness.target);
  return {
    controller,
    ...targetHarness,
    onStrokeStart,
    onStrokeUpdate,
    onStrokeFinalized,
    onStrokeCancelled,
    onError,
    getCanvasBounds,
  };
}

describe("PointerInputController", () => {
  it("captures, moves, and finalizes a mouse stroke with constant fallback pressure", () => {
    const harness = createHarness();
    harness.controller.handlePointerDown(pointerEvent({ x: 500, y: 400 }));
    harness.controller.handlePointerMove(
      pointerEvent({ x: 510, y: 410, timestamp: 110, pressure: 0.1 }),
    );
    harness.controller.handlePointerUp(
      pointerEvent({ x: 520, y: 420, timestamp: 120, pressure: 0, buttons: 0 }),
    );

    expect(harness.onStrokeStart).toHaveBeenCalledOnce();
    expect(harness.onStrokeUpdate).toHaveBeenCalledTimes(2);
    expect(harness.onStrokeFinalized).toHaveBeenCalledOnce();
    const stroke = harness.onStrokeFinalized.mock.calls[0]?.[0];
    expect(stroke.points).toHaveLength(3);
    expect(stroke.points.every((point: { pressure: number }) => point.pressure === 0.5)).toBe(true);
    expect(stroke.points[0]).toMatchObject({ x: 300, y: 350, pointerType: "mouse" });
    expect(harness.controller.hasActivePointer).toBe(false);
    expect(harness.captured.size).toBe(0);
  });

  it("preserves raw pointer endpoints for the adaptive finalized path", () => {
    const harness = createHarness({ x: 0, y: 0, width: 1_000, height: 800 }, true);
    harness.controller.handlePointerDown(pointerEvent({ x: 500, y: 400, timestamp: 100 }));
    harness.controller.handlePointerMove(pointerEvent({ x: 510, y: 410, timestamp: 110 }));
    harness.controller.handlePointerUp(
      pointerEvent({ x: 520, y: 420, timestamp: 120, buttons: 0 }),
    );

    const stroke = harness.onStrokeFinalized.mock.calls[0]?.[0];
    expect(stroke.points[0]).toMatchObject({ x: 300, y: 350 });
    expect(stroke.points.at(-1)).toMatchObject({ x: 320, y: 370 });
  });

  it.each([
    ["pen", 0.8],
    ["touch", 0.65],
  ] as const)("supports primary %s input and normalized pressure", (pointerType, pressure) => {
    const harness = createHarness();
    harness.controller.handlePointerDown(pointerEvent({ pointerType, pressure }));
    harness.controller.handlePointerUp(
      pointerEvent({ pointerType, pressure, timestamp: 110, buttons: 0 }),
    );
    expect(harness.onStrokeFinalized.mock.calls[0]?.[0].points[0]).toMatchObject({
      pointerType,
      pressure,
    });
  });

  it("processes high-frequency coalesced samples in order", () => {
    const harness = createHarness();
    harness.controller.handlePointerDown(pointerEvent());
    const coalesced = [
      pointerEvent({ x: 510, timestamp: 105, pointerType: "pen", pressure: 0.2 }),
      pointerEvent({ x: 520, timestamp: 110, pointerType: "pen", pressure: 0.4 }),
      pointerEvent({ x: 530, timestamp: 115, pointerType: "pen", pressure: 0.6 }),
    ];
    harness.controller.handlePointerMove(
      pointerEvent({ pointerType: "pen", coalesced, timestamp: 115 }),
    );
    harness.controller.handlePointerUp(
      pointerEvent({ pointerType: "pen", x: 540, timestamp: 120, buttons: 0 }),
    );
    expect(harness.onStrokeUpdate).toHaveBeenCalledTimes(4);
    expect(harness.onStrokeFinalized.mock.calls[0]?.[0].pointCount).toBe(5);
  });

  it("reads layout once for a coalesced event batch and refreshes it for the next event", () => {
    const harness = createHarness();
    harness.controller.handlePointerDown(pointerEvent());
    harness.controller.handlePointerMove(
      pointerEvent({
        pointerType: "pen",
        coalesced: Array.from({ length: 240 }, (_, index) =>
          pointerEvent({
            x: 501 + index,
            timestamp: 101 + index,
            pointerType: "pen",
            pressure: 0.4,
          }),
        ),
      }),
    );
    harness.controller.handlePointerMove(
      pointerEvent({ pointerType: "pen", x: 750, timestamp: 350, pressure: 0.5 }),
    );

    expect(harness.onStrokeUpdate).toHaveBeenCalledTimes(241);
    expect(harness.getCanvasBounds).toHaveBeenCalledTimes(3);
  });

  it("retains meaningful coalesced stationary process samples without duplicate geometry", () => {
    const harness = createHarness();
    harness.controller.handlePointerDown(
      pointerEvent({ pointerType: "pen", x: 500, y: 400, timestamp: 100, pressure: 0.2 }),
    );
    harness.controller.handlePointerMove(
      pointerEvent({
        pointerType: "pen",
        timestamp: 120,
        coalesced: [
          pointerEvent({
            pointerType: "pen",
            x: 500,
            y: 400,
            timestamp: 104,
            pressure: 0.7,
            tiltX: 3,
            tiltY: -2,
            twist: 10,
          }),
          pointerEvent({
            pointerType: "pen",
            x: 500,
            y: 400,
            timestamp: 120,
            pressure: 0.7,
            tiltX: 3,
            tiltY: -2,
            twist: 10,
          }),
        ],
      }),
    );
    harness.controller.handlePointerUp(
      pointerEvent({ pointerType: "pen", x: 500, y: 400, timestamp: 124, buttons: 0 }),
    );

    const stroke = harness.onStrokeFinalized.mock.calls[0]?.[0];
    expect(stroke.pointCount).toBe(1);
    expect(stroke.sourceSampleCount).toBe(4);
    expect(stroke.sourceSamples[1]).toMatchObject({
      pressure: 0.7,
      tiltX: 3,
      tiltY: -2,
      twist: 10,
    });
    expect(stroke.sourceSamples.at(-1)?.timestamp).toBe(124);
  });

  it("snapshots resolved brush metadata once at pointer-down", () => {
    let active = brushSnapshot("pen-black", "#111111", 2);
    const harness = createHarness(undefined, false, () => active);
    harness.controller.handlePointerDown(pointerEvent({ pointerType: "pen", timestamp: 100 }));
    active = brushSnapshot("pen-blue", "#2563eb", 8);
    harness.controller.handlePointerUp(
      pointerEvent({ pointerType: "pen", x: 520, timestamp: 120, buttons: 0 }),
    );

    expect(harness.onStrokeFinalized.mock.calls[0]?.[0].brush).toMatchObject({
      presetId: "pen-black",
      color: "#111111",
      size: 2,
    });
  });

  it.each([
    ["mouse", "pen", "outline", "centerline"],
    ["pen", "pen", "outline", "outline"],
    ["touch", "pen", "outline", "outline"],
    ["mouse", "highlighter", "centerline", "centerline"],
  ] as const)(
    "freezes the actual %s %s renderer at pointer-down",
    (pointerType, family, preferredKind, expectedKind) => {
      const candidate = brushSnapshot("device-aware", "#111111", 8, family, preferredKind);
      const harness = createHarness(undefined, false, () => candidate);

      harness.controller.handlePointerDown(pointerEvent({ pointerType, timestamp: 100 }));
      harness.controller.handlePointerUp(
        pointerEvent({ pointerType, x: 520, timestamp: 120, buttons: 0 }),
      );

      expect(harness.onStrokeStart.mock.calls[0]?.[0].brush.renderer.kind).toBe(expectedKind);
      const stroke = harness.onStrokeFinalized.mock.calls[0]?.[0];
      expect(stroke).toMatchObject({ brush: { renderer: { kind: expectedKind } } });
      expect(
        stroke.sourceSamples.every(
          (sample: { pointerType: string }) => sample.pointerType === pointerType,
        ),
      ).toBe(true);
      expect(candidate.renderer.kind).toBe(preferredKind);
    },
  );

  it("compensates for CSS scaling and device-pixel-ratio-independent coordinates", () => {
    const harness = createHarness({ x: 0, y: 0, width: 500, height: 400 });
    harness.controller.handlePointerDown(pointerEvent({ x: 250, y: 200 }));
    expect(harness.onStrokeStart.mock.calls[0]?.[0].point).toMatchObject({ x: 300, y: 350 });
  });

  it("falls back from invalid pen pressure and reports a structured error", () => {
    const harness = createHarness();
    harness.controller.handlePointerDown(
      pointerEvent({ pointerType: "pen", pressure: Number.NaN }),
    );
    expect(harness.onStrokeStart.mock.calls[0]?.[0].point.pressure).toBe(0.5);
    expect(harness.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVALID_PRESSURE" }),
    );
  });

  it("cancels PointerCancel and releases all active state", () => {
    const harness = createHarness();
    harness.controller.handlePointerDown(pointerEvent({ pointerType: "touch" }));
    harness.controller.handlePointerCancel(pointerEvent({ pointerType: "touch" }));
    expect(harness.onStrokeCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "pointer-cancel", dirtyRect: expect.any(Object) }),
    );
    expect(harness.controller.pointerId).toBeNull();
    expect(harness.captured.size).toBe(0);
  });

  it("keeps a captured pointer alive across leave and cancels an uncaptured leave", () => {
    const harness = createHarness();
    const event = pointerEvent({ pointerType: "pen" });
    harness.controller.handlePointerDown(event);
    harness.controller.handlePointerLeave(event);
    expect(harness.controller.hasActivePointer).toBe(true);
    harness.captured.clear();
    harness.controller.handlePointerLeave(event);
    expect(harness.controller.hasActivePointer).toBe(false);
    expect(harness.onStrokeCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "pointer-leave" }),
    );
    expect(harness.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "LOST_POINTER" }));
  });

  it("handles lost capture and missing mouse PointerUp", () => {
    const capture = createHarness();
    const pen = pointerEvent({ pointerType: "pen" });
    capture.controller.handlePointerDown(pen);
    capture.controller.handleLostPointerCapture(pen);
    expect(capture.onStrokeCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "lost-capture" }),
    );

    const mouse = createHarness();
    mouse.controller.handlePointerDown(pointerEvent());
    mouse.controller.handlePointerMove(pointerEvent({ buttons: 0, timestamp: 110 }));
    expect(mouse.onError).toHaveBeenCalledWith(expect.objectContaining({ code: "LOST_POINTER" }));
    expect(mouse.controller.hasActivePointer).toBe(false);
  });

  it("cancels active buffers on window blur and removes the listener on destroy", () => {
    const harness = createHarness();
    harness.controller.handlePointerDown(pointerEvent({ pointerType: "pen" }));
    harness.dispatchWindowBlur();

    expect(harness.controller.hasActivePointer).toBe(false);
    expect(harness.onStrokeCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "lost-capture" }),
    );
    harness.controller.destroy();
    expect(harness.viewListeners.get("blur")?.size ?? 0).toBe(0);
  });

  it("rejects unsupported, non-primary, simultaneous, and non-primary-button pointers", () => {
    const harness = createHarness();
    harness.controller.handlePointerDown(pointerEvent({ pointerType: "unknown" }));
    harness.controller.handlePointerDown(pointerEvent({ pointerType: "touch", isPrimary: false }));
    harness.controller.handlePointerDown(pointerEvent({ button: 2 }));
    harness.controller.handlePointerDown(pointerEvent({ pointerType: "pen", pointerId: 1 }));
    harness.controller.handlePointerDown(pointerEvent({ pointerType: "touch", pointerId: 2 }));
    expect(harness.onStrokeStart).toHaveBeenCalledOnce();
    expect(harness.onError.mock.calls.map(([error]) => error.code)).toEqual([
      "UNSUPPORTED_POINTER",
      "UNSUPPORTED_POINTER",
      "UNSUPPORTED_POINTER",
      "ACTIVE_POINTER_EXISTS",
    ]);
  });

  it("reports pointer capture failure and duplicate PointerUp without creating strokes", () => {
    const harness = createHarness();
    harness.setCaptureFailure(true);
    harness.controller.handlePointerDown(pointerEvent());
    harness.controller.handlePointerUp(pointerEvent({ buttons: 0 }));
    expect(harness.onStrokeStart).not.toHaveBeenCalled();
    expect(harness.onError.mock.calls.map(([error]) => error.code)).toEqual([
      "POINTER_CAPTURE_FAILED",
      "DUPLICATE_POINTER_UP",
    ]);
  });

  it("detaches listeners and cancels live buffers on destroy", () => {
    const harness = createHarness();
    harness.controller.handlePointerDown(pointerEvent());
    harness.controller.destroy();
    expect(harness.onStrokeCancelled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "destroyed" }),
    );
    for (const listeners of harness.listeners.values()) expect(listeners.size).toBe(0);
    expect(() => harness.controller.attach(harness.target)).toThrowError(
      expect.objectContaining({ code: "INVALID_POINTER_DATA" }),
    );
  });
});

function brushSnapshot(
  presetId: string,
  color: string,
  size: number,
  family: BrushFamily = "pen",
  rendererKind: BrushRendererKind = "outline",
): ResolvedBrushSnapshot {
  const pressureEnabled = family === "pen";
  return createResolvedBrushSnapshot({
    schemaVersion: 1,
    presetId,
    presetVersion: 1,
    family,
    color,
    size,
    opacity: 1,
    smoothing: { mode: "none", amount: 0 },
    dynamics: {
      pressureSize: {
        enabled: pressureEnabled,
        minimumFactor: pressureEnabled ? 0.5 : 1,
        maximumFactor: pressureEnabled ? 1.5 : 1,
        curve: { kind: "linear", exponent: 1 },
      },
      pressureOpacity: {
        enabled: false,
        minimumFactor: 1,
        maximumFactor: 1,
        curve: { kind: "linear", exponent: 1 },
      },
    },
    renderer: { version: 1, kind: rendererKind },
  });
}
