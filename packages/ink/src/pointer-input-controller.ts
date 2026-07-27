import type { CanvasBounds } from "@folio/rendering";
import { InkError } from "./errors";
import { StrokeBuilder } from "./stroke-builder";
import type {
  InkPointerType,
  PointerInputControllerOptions,
  StrokeCancellation,
  StrokePointInput,
  StrokeUpdate,
} from "./types";

const DEFAULT_POINTER_TYPES: readonly InkPointerType[] = Object.freeze(["mouse", "pen", "touch"]);

function isPointerType(value: string): value is InkPointerType {
  return value === "mouse" || value === "pen" || value === "touch";
}

export class PointerInputController {
  private readonly options: PointerInputControllerOptions;
  private readonly supportedPointerTypes: ReadonlySet<InkPointerType>;
  private target: HTMLElement | null = null;
  private activePointerId: number | null = null;
  private activeBuilder: StrokeBuilder | null = null;
  private destroyed = false;

  constructor(options: PointerInputControllerOptions) {
    this.options = options;
    this.supportedPointerTypes = new Set(options.supportedPointerTypes ?? DEFAULT_POINTER_TYPES);
  }

  get hasActivePointer(): boolean {
    return this.activePointerId !== null;
  }

  get pointerId(): number | null {
    return this.activePointerId;
  }

  attach(target: HTMLElement): void {
    this.assertActive();
    if (this.target === target) return;
    this.detach();
    this.target = target;
    target.addEventListener("pointerdown", this.handlePointerDown);
    target.addEventListener("pointermove", this.handlePointerMove);
    target.addEventListener("pointerup", this.handlePointerUp);
    target.addEventListener("pointercancel", this.handlePointerCancel);
    target.addEventListener("pointerleave", this.handlePointerLeave);
    target.addEventListener("lostpointercapture", this.handleLostPointerCapture);
  }

  detach(): void {
    if (this.target === null) return;
    if (this.activeBuilder !== null) this.cancelActive("destroyed");
    this.target.removeEventListener("pointerdown", this.handlePointerDown);
    this.target.removeEventListener("pointermove", this.handlePointerMove);
    this.target.removeEventListener("pointerup", this.handlePointerUp);
    this.target.removeEventListener("pointercancel", this.handlePointerCancel);
    this.target.removeEventListener("pointerleave", this.handlePointerLeave);
    this.target.removeEventListener("lostpointercapture", this.handleLostPointerCapture);
    this.target = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.detach();
    this.destroyed = true;
  }

  readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.destroyed || !this.acceptPointer(event)) return;
    if (this.activePointerId !== null) {
      this.report(
        new InkError("ACTIVE_POINTER_EXISTS", "Only one ink pointer is supported in Phase 7.", {
          activePointerId: this.activePointerId,
          pointerId: event.pointerId,
        }),
      );
      return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
      this.report(
        new InkError("UNSUPPORTED_POINTER", "Only the primary mouse button can draw.", {
          button: event.button,
        }),
      );
      return;
    }

    const target = this.target ?? (event.currentTarget as HTMLElement | null);
    if (target === null) return;
    try {
      target.setPointerCapture(event.pointerId);
    } catch (cause) {
      this.report(
        new InkError(
          "POINTER_CAPTURE_FAILED",
          "Pointer capture could not be acquired.",
          { pointerId: event.pointerId },
          { cause },
        ),
      );
      return;
    }

    let builder: StrokeBuilder;
    let update: StrokeUpdate | null;
    try {
      const point = this.normalizeEvent(event);
      builder = new StrokeBuilder({
        timestamp: point.timestamp,
        ...(this.options.style === undefined ? {} : { style: this.options.style }),
        ...(this.options.smoother === undefined ? {} : { smoother: this.options.smoother }),
        ...(this.options.createId === undefined ? {} : { createId: this.options.createId }),
        ...(this.options.now === undefined ? {} : { now: this.options.now }),
      });
      update = builder.addPoint(point);
    } catch (cause) {
      try {
        target.releasePointerCapture(event.pointerId);
      } catch {
        // The primary structured error below is more useful than a secondary release failure.
      }
      this.report(
        cause instanceof InkError
          ? cause
          : new InkError(
              "INVALID_POINTER_DATA",
              "PointerDown could not start a stroke.",
              {},
              {
                cause,
              },
            ),
      );
      return;
    }
    if (update === null) return;
    this.activePointerId = event.pointerId;
    this.activeBuilder = builder;
    event.preventDefault();
    this.options.onStrokeStart?.(update);
  };

  readonly handlePointerMove = (event: PointerEvent): void => {
    if (!this.isActiveEvent(event)) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      this.report(
        new InkError("LOST_POINTER", "The active mouse pointer was released without PointerUp.", {
          pointerId: event.pointerId,
        }),
      );
      this.cancelActive("lost-capture");
      return;
    }
    event.preventDefault();
    const coalesced = event.getCoalescedEvents?.() ?? [];
    const samples = coalesced.length === 0 ? [event] : coalesced;
    for (const sample of samples) this.appendEvent(sample);
  };

  readonly handlePointerUp = (event: PointerEvent): void => {
    if (this.activePointerId === null || this.activeBuilder === null) {
      this.report(
        new InkError("DUPLICATE_POINTER_UP", "PointerUp arrived without an active stroke.", {
          pointerId: event.pointerId,
        }),
      );
      return;
    }
    if (event.pointerId !== this.activePointerId) return;
    event.preventDefault();
    this.appendEvent(event);
    const target = this.target ?? (event.currentTarget as HTMLElement | null);
    const builder = this.activeBuilder;
    this.activePointerId = null;
    this.activeBuilder = null;
    try {
      target?.releasePointerCapture(event.pointerId);
    } catch (cause) {
      this.report(
        new InkError(
          "POINTER_CAPTURE_FAILED",
          "Pointer capture could not be released.",
          { pointerId: event.pointerId },
          { cause },
        ),
      );
    }
    this.options.onStrokeFinalized?.(builder.finalize());
  };

  readonly handlePointerCancel = (event: PointerEvent): void => {
    if (!this.isActiveEvent(event)) return;
    event.preventDefault();
    this.cancelActive("pointer-cancel");
  };

  readonly handlePointerLeave = (event: PointerEvent): void => {
    if (!this.isActiveEvent(event)) return;
    const target = this.target ?? (event.currentTarget as HTMLElement | null);
    if (target?.hasPointerCapture(event.pointerId) === true) return;
    this.report(
      new InkError("LOST_POINTER", "The active pointer left without capture.", {
        pointerId: event.pointerId,
      }),
    );
    this.cancelActive("pointer-leave");
  };

  readonly handleLostPointerCapture = (event: PointerEvent): void => {
    if (!this.isActiveEvent(event)) return;
    this.report(
      new InkError("LOST_POINTER", "Pointer capture was lost during a stroke.", {
        pointerId: event.pointerId,
      }),
    );
    this.cancelActive("lost-capture");
  };

  private appendEvent(event: PointerEvent): void {
    if (this.activeBuilder === null) return;
    try {
      const update = this.activeBuilder.addPoint(this.normalizeEvent(event));
      if (update !== null) this.options.onStrokeUpdate?.(update);
    } catch (cause) {
      this.report(
        cause instanceof InkError
          ? cause
          : new InkError(
              "INVALID_POINTER_DATA",
              "Pointer input could not be processed.",
              { pointerId: event.pointerId },
              { cause },
            ),
      );
    }
  }

  private normalizeEvent(event: PointerEvent): StrokePointInput {
    const pointerType = isPointerType(event.pointerType) ? event.pointerType : "mouse";
    const bounds: CanvasBounds = this.options.getCanvasBounds();
    let position;
    try {
      position = this.options.coordinateConverter.screenToPage(
        { x: event.clientX, y: event.clientY },
        bounds,
      );
    } catch (cause) {
      throw new InkError(
        "INVALID_COORDINATE",
        "Pointer coordinates could not be converted to page space.",
        { clientX: event.clientX, clientY: event.clientY },
        { cause },
      );
    }

    let pressure = pointerType === "mouse" ? 0.5 : event.pressure;
    if (!Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
      this.report(
        new InkError("INVALID_PRESSURE", "Invalid pointer pressure was replaced by 0.5.", {
          pressure,
          pointerType,
        }),
      );
      pressure = 0.5;
    }
    const timestamp = Number.isFinite(event.timeStamp)
      ? event.timeStamp
      : (this.options.now ?? (() => performance.now()))();
    const altitudeAngle = this.normalizeOptionalAngle(
      event.altitudeAngle,
      0,
      Math.PI / 2,
      "altitudeAngle",
    );
    const azimuthAngle = this.normalizeOptionalAngle(
      event.azimuthAngle,
      0,
      Math.PI * 2,
      "azimuthAngle",
    );

    return Object.freeze({
      x: position.x,
      y: position.y,
      timestamp,
      pressure,
      tiltX: Math.min(90, Math.max(-90, Number.isFinite(event.tiltX) ? event.tiltX : 0)),
      tiltY: Math.min(90, Math.max(-90, Number.isFinite(event.tiltY) ? event.tiltY : 0)),
      twist: Number.isFinite(event.twist) ? ((event.twist % 360) + 360) % 360 : 0,
      pointerType,
      button: Number.isFinite(event.button) ? Math.trunc(event.button) : 0,
      buttons: Number.isFinite(event.buttons) ? Math.max(0, Math.trunc(event.buttons)) : 0,
      ...(altitudeAngle === undefined ? {} : { altitudeAngle }),
      ...(azimuthAngle === undefined ? {} : { azimuthAngle }),
    });
  }

  private normalizeOptionalAngle(
    value: number | undefined,
    minimum: number,
    maximum: number,
    name: string,
  ): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isFinite(value)) {
      this.report(
        new InkError("INVALID_POINTER_DATA", `${name} was ignored because it is invalid.`, {
          value,
        }),
      );
      return undefined;
    }
    return Math.min(maximum, Math.max(minimum, value));
  }

  private acceptPointer(event: PointerEvent): boolean {
    if (!isPointerType(event.pointerType) || !this.supportedPointerTypes.has(event.pointerType)) {
      this.report(
        new InkError("UNSUPPORTED_POINTER", "This pointer type is not supported for ink.", {
          pointerType: event.pointerType,
        }),
      );
      return false;
    }
    if (!event.isPrimary) {
      this.report(
        new InkError("UNSUPPORTED_POINTER", "Non-primary pointers are reserved for future input.", {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
        }),
      );
      return false;
    }
    return true;
  }

  private isActiveEvent(event: PointerEvent): boolean {
    return this.activePointerId === event.pointerId && this.activeBuilder !== null;
  }

  private cancelActive(reason: StrokeCancellation["reason"]): void {
    if (this.activeBuilder === null) return;
    const builder = this.activeBuilder;
    const pointerId = this.activePointerId;
    const dirtyRect = builder.cancel();
    this.activeBuilder = null;
    this.activePointerId = null;
    if (pointerId !== null) {
      try {
        this.target?.releasePointerCapture(pointerId);
      } catch {
        // The cancellation is already complete; capture failure was the likely cause.
      }
    }
    this.options.onStrokeCancelled?.(Object.freeze({ strokeId: builder.id, reason, dirtyRect }));
  }

  private report(error: InkError): void {
    this.options.onError?.(error);
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new InkError("INVALID_POINTER_DATA", "The pointer input controller is destroyed.");
    }
  }
}
