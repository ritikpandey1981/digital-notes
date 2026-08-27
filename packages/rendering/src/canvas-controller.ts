import { CoordinateConverter } from "./coordinate-converter";
import { Diagnostics } from "./diagnostics";
import { RenderingError } from "./errors";
import { CanvasOverlayLayerImplementation } from "./internal/canvas-overlay-layer";
import {
  assertRect,
  freezeRenderPage,
  freezeRenderTheme,
  normalizeInsets,
} from "./internal/geometry";
import { Renderer } from "./renderer";
import { RenderScheduler } from "./render-scheduler";
import {
  DEFAULT_FIT_PADDING,
  DEFAULT_PAGE,
  DEFAULT_RENDER_THEME,
  type CanvasControllerOptions,
  type CanvasControllerSnapshot,
  type CanvasOverlayLayer,
  type CanvasOverlayLayerOptions,
  type DirtyRegion,
  type RenderPage,
  type RenderTheme,
  type ResizeObserverFactory,
  type Size,
  type ViewportMode,
} from "./types";
import { Viewport } from "./viewport";

type ControllerStatus = CanvasControllerSnapshot["status"];

const defaultResizeObserverFactory: ResizeObserverFactory = (callback) => {
  if (typeof ResizeObserver === "undefined") {
    throw new RenderingError("RESIZE_FAILED", "ResizeObserver is unavailable in this environment.");
  }
  return new ResizeObserver(callback);
};

function defaultDevicePixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio;
}

function defaultDprObserver(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  let mediaQuery: MediaQueryList | null = null;
  const observeResolution = (): void => {
    mediaQuery?.removeEventListener("change", handleResolutionChange);
    mediaQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mediaQuery.addEventListener("change", handleResolutionChange, { once: true });
  };
  const handleResolutionChange = (): void => {
    observeResolution();
    listener();
  };

  observeResolution();
  window.addEventListener("resize", listener);
  return () => {
    mediaQuery?.removeEventListener("change", handleResolutionChange);
    window.removeEventListener("resize", listener);
  };
}

export class CanvasController {
  private readonly options: CanvasControllerOptions;
  private readonly diagnosticsValue = new Diagnostics();
  private statusValue: ControllerStatus = "idle";
  private container: HTMLElement | null = null;
  private canvasValue: HTMLCanvasElement | null = null;
  private viewportValue: Viewport | null = null;
  private rendererValue: Renderer | null = null;
  private schedulerValue: RenderScheduler | null = null;
  private resizeObserver: ReturnType<ResizeObserverFactory> | null = null;
  private readonly overlayLayers = new Set<CanvasOverlayLayerImplementation>();
  private stopObservingDpr: (() => void) | null = null;
  private page: RenderPage;
  private theme: RenderTheme;
  private readonly fitPadding;
  private hasFitNonZeroViewport = false;
  private viewportModeValue: ViewportMode = "fit-page";

  constructor(options: CanvasControllerOptions = {}) {
    this.options = options;
    const page = options.page ?? DEFAULT_PAGE;
    assertRect(page.rect, "renderPage.rect");
    this.page = freezeRenderPage(page);
    this.theme = freezeRenderTheme(options.theme ?? DEFAULT_RENDER_THEME);
    this.fitPadding = normalizeInsets(
      options.fitPadding ?? DEFAULT_FIT_PADDING,
      DEFAULT_FIT_PADDING,
    );
  }

  get status(): ControllerStatus {
    return this.statusValue;
  }

  get canvas(): HTMLCanvasElement | null {
    return this.canvasValue;
  }

  get viewport(): Viewport | null {
    return this.viewportValue;
  }

  get viewportMode(): ViewportMode {
    return this.viewportModeValue;
  }

  get coordinateConverter(): CoordinateConverter | null {
    return this.viewportValue === null ? null : new CoordinateConverter(this.viewportValue);
  }

  get diagnostics(): Diagnostics {
    return this.diagnosticsValue;
  }

  mount(container: HTMLElement): void {
    this.assertNotDestroyed();
    if (this.statusValue !== "idle") {
      throw new RenderingError(
        "CANVAS_ALREADY_MOUNTED",
        "The canvas controller is already mounted.",
      );
    }

    const canvas = this.options.canvasFactory?.() ?? document.createElement("canvas");
    canvas.dataset.folioRenderer = "true";
    canvas.dataset.renderCount = "0";
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.pointerEvents = "none";
    canvas.dataset.folioLayer = "page";
    canvas.setAttribute("aria-label", "Blank notebook page");
    canvas.setAttribute("role", "img");

    const context = canvas.getContext("2d");
    if (context === null) {
      throw new RenderingError(
        "CANVAS_CONTEXT_UNAVAILABLE",
        "A 2D canvas context could not be acquired.",
      );
    }

    const viewport = new Viewport({
      size: { width: 0, height: 0 },
      pageRect: this.page.rect,
      devicePixelRatio: this.readDevicePixelRatio(),
    });
    this.container = container;
    this.canvasValue = canvas;
    this.viewportValue = viewport;

    try {
      this.rendererValue = this.createRenderer(context);
      this.schedulerValue = new RenderScheduler(
        (timestamp) => this.renderFrame(timestamp),
        this.options.animationFrameAdapter,
      );
      container.appendChild(canvas);
      canvas.addEventListener("contextlost", this.handleContextLost);
      canvas.addEventListener("contextrestored", this.handleContextRestored);
      const resizeObserverFactory =
        this.options.resizeObserverFactory ?? defaultResizeObserverFactory;
      this.resizeObserver = resizeObserverFactory(this.handleResizeObserved);
      this.resizeObserver.observe(container);
      this.stopObservingDpr = (this.options.observeDevicePixelRatio ?? defaultDprObserver)(() => {
        if (this.statusValue === "mounted") {
          this.refreshDevicePixelRatio();
        }
      });
      this.statusValue = "mounted";
      const bounds = container.getBoundingClientRect();
      this.resize({ width: bounds.width, height: bounds.height });
    } catch (cause) {
      this.cleanupMount();
      this.statusValue = "idle";
      if (cause instanceof RenderingError) {
        throw cause;
      }
      throw new RenderingError(
        "RESIZE_FAILED",
        "Canvas resize observation could not be initialized.",
        {},
        { cause },
      );
    }
  }

  resize(size: Size): void {
    this.assertMounted();
    const canvas = this.requireCanvas();
    const viewport = this.requireViewport();
    const dpr = this.readDevicePixelRatio();
    const logicalSize = {
      width: size.width,
      height: size.height,
    };
    viewport.resize(logicalSize, dpr);
    const physicalSize = {
      width: Math.round(logicalSize.width * dpr),
      height: Math.round(logicalSize.height * dpr),
    };
    if (canvas.width !== physicalSize.width) {
      canvas.width = physicalSize.width;
    }
    if (canvas.height !== physicalSize.height) {
      canvas.height = physicalSize.height;
    }

    if (!this.hasFitNonZeroViewport && logicalSize.width > 0 && logicalSize.height > 0) {
      viewport.fitPage(this.fitPadding);
      this.hasFitNonZeroViewport = true;
    } else if (this.hasFitNonZeroViewport) {
      if (this.viewportModeValue === "fit-page") {
        viewport.fitPage(this.fitPadding);
      } else if (this.viewportModeValue === "fit-width") {
        viewport.fitWidth(this.fitPadding);
      }
    }
    this.diagnosticsValue.recordResize(logicalSize, logicalSize, physicalSize, dpr);
    this.requestRender({ kind: "viewport" });
    for (const layer of this.overlayLayers) {
      layer.resize(logicalSize, dpr);
    }
    this.notifyViewportChange();
  }

  createOverlayLayer(options: CanvasOverlayLayerOptions): CanvasOverlayLayer {
    this.assertMounted();
    const canvas =
      this.options.overlayCanvasFactory?.(options.name) ?? document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new RenderingError(
        "CANVAS_CONTEXT_UNAVAILABLE",
        `A 2D canvas context could not be acquired for overlay layer ${options.name}.`,
        { layer: options.name },
      );
    }
    const layer = new CanvasOverlayLayerImplementation({
      canvas,
      context,
      container: this.requireContainer(),
      options,
      onDestroy: (destroyedLayer) => this.overlayLayers.delete(destroyedLayer),
    });
    this.overlayLayers.add(layer);
    const viewport = this.requireViewport();
    layer.resize(viewport.size, viewport.devicePixelRatio);
    return layer;
  }

  refreshDevicePixelRatio(): void {
    this.assertMounted();
    const viewport = this.requireViewport();
    this.resize(viewport.size);
  }

  setPage(page: RenderPage, fit = true): void {
    this.assertMounted();
    this.page = freezeRenderPage(page);
    const viewport = this.requireViewport();
    this.requireRenderer().setPage(page);
    if (fit) {
      viewport.fitPage(this.fitPadding);
      this.viewportModeValue = "fit-page";
    } else {
      viewport.centerPage();
      this.viewportModeValue = "manual";
    }
    this.commitViewportChange();
  }

  /** Replaces current page presentation without changing the user's camera or viewport mode. */
  updatePage(page: RenderPage): void {
    this.assertMounted();
    this.page = freezeRenderPage(page);
    this.requireRenderer().setPage(page);
    this.commitViewportChange();
  }

  setZoom(zoom: number): number {
    const viewport = this.requireViewport();
    return this.zoomAt(zoom, {
      x: viewport.size.width / 2,
      y: viewport.size.height / 2,
    });
  }

  resetZoom(): number {
    return this.setZoom(1);
  }

  zoomAt(zoom: number, viewportAnchor: Readonly<{ x: number; y: number }>): number {
    this.assertMounted();
    const viewport = this.requireViewport();
    const clampedZoom = Math.min(viewport.camera.maxZoom, Math.max(viewport.camera.minZoom, zoom));
    viewport.zoomAt(clampedZoom, viewportAnchor);
    this.viewportModeValue = "manual";
    this.commitViewportChange();
    return clampedZoom;
  }

  panBy(viewportDelta: Readonly<{ x: number; y: number }>): void {
    this.assertMounted();
    const viewport = this.requireViewport();
    viewport.panBy({
      x: -viewportDelta.x / viewport.camera.zoom,
      y: -viewportDelta.y / viewport.camera.zoom,
    });
    this.viewportModeValue = "manual";
    this.commitViewportChange();
  }

  fitPage(): number {
    this.assertMounted();
    const zoom = this.requireViewport().fitPage(this.fitPadding);
    this.viewportModeValue = "fit-page";
    this.commitViewportChange();
    return zoom;
  }

  fitWidth(): number {
    this.assertMounted();
    const zoom = this.requireViewport().fitWidth(this.fitPadding);
    this.viewportModeValue = "fit-width";
    this.commitViewportChange();
    return zoom;
  }

  setTheme(theme: RenderTheme): void {
    this.assertMounted();
    this.theme = freezeRenderTheme(theme);
    this.requireRenderer().setTheme(theme);
    this.requestRender({ kind: "viewport" });
  }

  requestRender(region: DirtyRegion = { kind: "viewport" }): void {
    this.assertMounted();
    this.requireRenderer().invalidate(region);
    this.diagnosticsValue.recordInvalidation();
    this.requireScheduler().requestRender();
  }

  cancelRender(): void {
    this.assertMounted();
    this.requireScheduler().cancelRender();
  }

  forceRender(): void {
    this.assertMounted();
    this.requireRenderer().invalidate({ kind: "viewport" });
    this.diagnosticsValue.recordInvalidation();
    this.requireScheduler().forceRender(this.now());
  }

  /** Flushes already-scheduled render work without creating a new invalidation. */
  flushRender(): boolean {
    this.assertMounted();
    const scheduler = this.requireScheduler();
    if (!scheduler.pending) return false;
    scheduler.forceRender(this.now());
    return true;
  }

  snapshot(): CanvasControllerSnapshot {
    return Object.freeze({
      status: this.statusValue,
      viewport: this.viewportValue?.snapshot() ?? null,
      viewportMode: this.viewportModeValue,
      diagnostics: this.diagnosticsValue.snapshot(),
    });
  }

  destroy(): void {
    if (this.statusValue === "destroyed") {
      return;
    }
    this.cleanupMount();
    this.statusValue = "destroyed";
  }

  private readonly handleResizeObserved: ResizeObserverCallback = (entries) => {
    const entry = entries[0];
    if (entry === undefined || this.statusValue !== "mounted") {
      return;
    }
    try {
      this.resize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    } catch (cause) {
      this.reportError(
        cause instanceof RenderingError
          ? cause
          : new RenderingError("RESIZE_FAILED", "The canvas could not be resized.", {}, { cause }),
      );
    }
  };

  private readonly handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.statusValue !== "mounted") {
      return;
    }
    this.schedulerValue?.destroy();
    this.schedulerValue = null;
    this.rendererValue?.destroy();
    this.rendererValue = null;
    this.statusValue = "context-lost";
    this.diagnosticsValue.recordContextLoss();
    this.reportError(new RenderingError("CONTEXT_LOST", "The canvas context was lost."));
  };

  private readonly handleContextRestored = (): void => {
    if (this.statusValue !== "context-lost") {
      return;
    }
    const context = this.requireCanvas().getContext("2d");
    if (context === null) {
      this.reportError(
        new RenderingError(
          "CONTEXT_RESTORATION_FAILED",
          "The canvas context could not be restored.",
        ),
      );
      return;
    }
    this.rendererValue = this.createRenderer(context);
    this.schedulerValue = new RenderScheduler(
      (timestamp) => this.renderFrame(timestamp),
      this.options.animationFrameAdapter,
    );
    this.statusValue = "mounted";
    const bounds = this.container?.getBoundingClientRect();
    if (bounds === undefined) {
      this.requestRender({ kind: "viewport" });
    } else {
      this.resize({ width: bounds.width, height: bounds.height });
    }
  };

  private createRenderer(context: CanvasRenderingContext2D): Renderer {
    return new Renderer({
      context,
      viewport: this.requireViewport(),
      page: this.page,
      theme: this.theme,
      ...(this.options.overlayHooks === undefined
        ? {}
        : { overlayHooks: this.options.overlayHooks }),
    });
  }

  private renderFrame(timestamp: number): void {
    if (this.statusValue !== "mounted") {
      return;
    }
    const startedAt = this.now();
    const rendered = this.requireRenderer().render(timestamp);
    const duration = this.now() - startedAt;
    this.diagnosticsValue.recordFrame(duration, rendered);
    const canvas = this.requireCanvas();
    const viewport = this.requireViewport();
    const pageRect = viewport.pageViewportRect;
    canvas.dataset.renderCount = String(this.diagnosticsValue.snapshot().renderCount);
    canvas.dataset.pageX = String(pageRect.x);
    canvas.dataset.pageY = String(pageRect.y);
    canvas.dataset.pageWidth = String(pageRect.width);
    canvas.dataset.pageHeight = String(pageRect.height);
    canvas.dataset.logicalWidth = String(viewport.size.width);
    canvas.dataset.logicalHeight = String(viewport.size.height);
    canvas.dataset.devicePixelRatio = String(viewport.devicePixelRatio);
  }

  private commitViewportChange(): void {
    this.requestRender({ kind: "viewport" });
    this.notifyViewportChange();
  }

  private notifyViewportChange(): void {
    this.options.onViewportChange?.(this.snapshot());
  }

  private cleanupMount(): void {
    for (const layer of [...this.overlayLayers]) layer.destroy();
    this.overlayLayers.clear();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stopObservingDpr?.();
    this.stopObservingDpr = null;
    this.schedulerValue?.destroy();
    this.schedulerValue = null;
    this.rendererValue?.destroy();
    this.rendererValue = null;
    if (this.canvasValue !== null) {
      this.canvasValue.removeEventListener("contextlost", this.handleContextLost);
      this.canvasValue.removeEventListener("contextrestored", this.handleContextRestored);
      if (this.canvasValue.parentElement === this.container) {
        this.container?.removeChild(this.canvasValue);
      }
    }
    this.canvasValue = null;
    this.viewportValue = null;
    this.container = null;
  }

  private readDevicePixelRatio(): number {
    const dpr = (this.options.getDevicePixelRatio ?? defaultDevicePixelRatio)();
    if (!Number.isFinite(dpr) || dpr <= 0) {
      throw new RenderingError("INVALID_DPR", "Device pixel ratio must be positive.", { dpr });
    }
    return dpr;
  }

  private now(): number {
    return (this.options.now ?? (() => performance.now()))();
  }

  private reportError(error: RenderingError): void {
    this.options.onError?.(error);
  }

  private assertNotDestroyed(): void {
    if (this.statusValue === "destroyed") {
      throw new RenderingError("CONTROLLER_DESTROYED", "The canvas controller has been destroyed.");
    }
  }

  private assertMounted(): void {
    this.assertNotDestroyed();
    if (this.statusValue === "context-lost") {
      throw new RenderingError("CONTEXT_LOST", "The canvas context is lost.");
    }
    if (this.statusValue !== "mounted") {
      throw new RenderingError("CONTROLLER_NOT_MOUNTED", "The canvas controller is not mounted.");
    }
  }

  private requireCanvas(): HTMLCanvasElement {
    if (this.canvasValue === null) {
      throw new RenderingError("CONTROLLER_NOT_MOUNTED", "The canvas controller has no canvas.");
    }
    return this.canvasValue;
  }

  private requireContainer(): HTMLElement {
    if (this.container === null) {
      throw new RenderingError("CONTROLLER_NOT_MOUNTED", "The canvas controller has no container.");
    }
    return this.container;
  }

  private requireViewport(): Viewport {
    if (this.viewportValue === null) {
      throw new RenderingError("CONTROLLER_NOT_MOUNTED", "The canvas controller has no viewport.");
    }
    return this.viewportValue;
  }

  private requireRenderer(): Renderer {
    if (this.rendererValue === null) {
      throw new RenderingError("CONTROLLER_NOT_MOUNTED", "The canvas controller has no renderer.");
    }
    return this.rendererValue;
  }

  private requireScheduler(): RenderScheduler {
    if (this.schedulerValue === null) {
      throw new RenderingError("CONTROLLER_NOT_MOUNTED", "The canvas controller has no scheduler.");
    }
    return this.schedulerValue;
  }
}
