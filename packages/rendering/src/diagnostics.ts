import { assertFiniteNumber, assertSize, freezeSize } from "./internal/geometry";
import type { RenderDiagnosticsSnapshot, Size } from "./types";

const ZERO_SIZE: Size = Object.freeze({ width: 0, height: 0 });

export class Diagnostics {
  private frameCountValue = 0;
  private renderCountValue = 0;
  private invalidationCountValue = 0;
  private contextLossCountValue = 0;
  private totalFrameDurationMs = 0;
  private lastFrameDurationMsValue = 0;
  private maxFrameDurationMsValue = 0;
  private viewportSizeValue = ZERO_SIZE;
  private canvasLogicalSizeValue = ZERO_SIZE;
  private canvasPhysicalSizeValue = ZERO_SIZE;
  private devicePixelRatioValue = 1;

  recordFrame(durationMs: number, rendered: boolean): void {
    assertFiniteNumber(durationMs, "frame.durationMs");
    const safeDuration = Math.max(0, durationMs);
    this.frameCountValue += 1;
    this.renderCountValue += rendered ? 1 : 0;
    this.totalFrameDurationMs += safeDuration;
    this.lastFrameDurationMsValue = safeDuration;
    this.maxFrameDurationMsValue = Math.max(this.maxFrameDurationMsValue, safeDuration);
  }

  recordInvalidation(): void {
    this.invalidationCountValue += 1;
  }

  recordContextLoss(): void {
    this.contextLossCountValue += 1;
  }

  recordResize(
    viewportSize: Size,
    canvasLogicalSize: Size,
    canvasPhysicalSize: Size,
    devicePixelRatio: number,
  ): void {
    assertSize(viewportSize, "diagnostics.viewportSize");
    assertSize(canvasLogicalSize, "diagnostics.canvasLogicalSize");
    assertSize(canvasPhysicalSize, "diagnostics.canvasPhysicalSize");
    assertFiniteNumber(devicePixelRatio, "diagnostics.devicePixelRatio");
    this.viewportSizeValue = freezeSize(viewportSize);
    this.canvasLogicalSizeValue = freezeSize(canvasLogicalSize);
    this.canvasPhysicalSizeValue = freezeSize(canvasPhysicalSize);
    this.devicePixelRatioValue = devicePixelRatio;
  }

  reset(): void {
    this.frameCountValue = 0;
    this.renderCountValue = 0;
    this.invalidationCountValue = 0;
    this.contextLossCountValue = 0;
    this.totalFrameDurationMs = 0;
    this.lastFrameDurationMsValue = 0;
    this.maxFrameDurationMsValue = 0;
  }

  snapshot(): RenderDiagnosticsSnapshot {
    return Object.freeze({
      frameCount: this.frameCountValue,
      renderCount: this.renderCountValue,
      invalidationCount: this.invalidationCountValue,
      contextLossCount: this.contextLossCountValue,
      lastFrameDurationMs: this.lastFrameDurationMsValue,
      averageFrameDurationMs:
        this.frameCountValue === 0 ? 0 : this.totalFrameDurationMs / this.frameCountValue,
      maxFrameDurationMs: this.maxFrameDurationMsValue,
      viewportSize: freezeSize(this.viewportSizeValue),
      canvasLogicalSize: freezeSize(this.canvasLogicalSizeValue),
      canvasPhysicalSize: freezeSize(this.canvasPhysicalSizeValue),
      devicePixelRatio: this.devicePixelRatioValue,
    });
  }
}
