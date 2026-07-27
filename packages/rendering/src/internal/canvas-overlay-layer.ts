import type { CanvasOverlayLayer, CanvasOverlayLayerOptions, Size } from "../types";

interface CanvasOverlayLayerDependencies {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly container: HTMLElement;
  readonly options: CanvasOverlayLayerOptions;
  readonly onDestroy: (layer: CanvasOverlayLayerImplementation) => void;
}

export class CanvasOverlayLayerImplementation implements CanvasOverlayLayer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly name: string;
  private readonly container: HTMLElement;
  private readonly onDestroy: (layer: CanvasOverlayLayerImplementation) => void;
  private resizeHandler: (() => void) | null = null;
  private destroyed = false;

  constructor(dependencies: CanvasOverlayLayerDependencies) {
    this.canvas = dependencies.canvas;
    this.context = dependencies.context;
    this.container = dependencies.container;
    this.name = dependencies.options.name;
    this.onDestroy = dependencies.onDestroy;

    this.canvas.dataset.folioLayer = this.name;
    this.canvas.style.position = "absolute";
    this.canvas.style.inset = "0";
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = dependencies.options.interactive === true ? "auto" : "none";
    this.canvas.style.touchAction = dependencies.options.interactive === true ? "none" : "auto";
    if (dependencies.options.ariaLabel === undefined) {
      this.canvas.setAttribute("aria-hidden", "true");
    } else {
      this.canvas.setAttribute("aria-label", dependencies.options.ariaLabel);
    }
    this.container.appendChild(this.canvas);
  }

  setResizeHandler(handler: (() => void) | null): void {
    if (this.destroyed) return;
    this.resizeHandler = handler;
  }

  resize(size: Size, devicePixelRatio: number): void {
    if (this.destroyed) return;
    const width = Math.round(size.width * devicePixelRatio);
    const height = Math.round(size.height * devicePixelRatio);
    const changed = this.canvas.width !== width || this.canvas.height !== height;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    this.canvas.dataset.logicalWidth = String(size.width);
    this.canvas.dataset.logicalHeight = String(size.height);
    this.canvas.dataset.devicePixelRatio = String(devicePixelRatio);
    if (changed) this.resizeHandler?.();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeHandler = null;
    if (this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
    this.onDestroy(this);
  }
}
