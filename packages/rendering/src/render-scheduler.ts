import { RenderingError } from "./errors";
import type { AnimationFrameAdapter } from "./types";

function defaultAnimationFrameAdapter(): AnimationFrameAdapter {
  return {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  };
}

export class RenderScheduler {
  private frameHandle: number | null = null;
  private destroyed = false;

  constructor(
    private readonly renderFrame: (timestamp: number) => void,
    private readonly animationFrame = defaultAnimationFrameAdapter(),
  ) {}

  get pending(): boolean {
    return this.frameHandle !== null;
  }

  requestRender(): void {
    this.assertActive();
    if (this.frameHandle !== null) {
      return;
    }
    this.frameHandle = this.animationFrame.request((timestamp) => {
      this.frameHandle = null;
      if (!this.destroyed) {
        this.renderFrame(timestamp);
      }
    });
  }

  cancelRender(): void {
    this.assertActive();
    this.cancelPendingFrame();
  }

  forceRender(timestamp = performance.now()): void {
    this.assertActive();
    this.cancelPendingFrame();
    this.renderFrame(timestamp);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.cancelPendingFrame();
    this.destroyed = true;
  }

  private cancelPendingFrame(): void {
    if (this.frameHandle !== null) {
      this.animationFrame.cancel(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new RenderingError("SCHEDULER_DESTROYED", "The render scheduler has been destroyed.");
    }
  }
}
