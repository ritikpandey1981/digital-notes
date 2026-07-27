import { RenderingError } from "./errors";
import { DirtyRegionAccumulator } from "./internal/dirty-regions";
import {
  assertFiniteNumber,
  assertRect,
  freezeRenderPage,
  freezeRenderTheme,
} from "./internal/geometry";
import type { DirtyRegion, OverlayRenderHook, RenderInput, RenderPage, RenderTheme } from "./types";
import type { Viewport } from "./viewport";

export interface RendererOptions {
  readonly context: CanvasRenderingContext2D;
  readonly viewport: Viewport;
  readonly page: RenderPage;
  readonly theme: RenderTheme;
  readonly overlayHooks?: readonly OverlayRenderHook[];
}

export class Renderer {
  private readonly context: CanvasRenderingContext2D;
  private readonly viewport: Viewport;
  private readonly dirtyRegions = new DirtyRegionAccumulator();
  private readonly overlayHooks: readonly OverlayRenderHook[];
  private page: RenderPage;
  private theme: RenderTheme;
  private destroyed = false;

  constructor(options: RendererOptions) {
    assertRect(options.page.rect, "renderPage.rect");
    this.context = options.context;
    this.viewport = options.viewport;
    this.page = freezeRenderPage(options.page);
    this.theme = freezeRenderTheme(options.theme);
    this.overlayHooks = Object.freeze([...(options.overlayHooks ?? [])]);
  }

  get hasPendingInvalidation(): boolean {
    return this.dirtyRegions.hasDirtyRegions;
  }

  invalidate(region: DirtyRegion = { kind: "viewport" }): void {
    this.assertActive();
    this.dirtyRegions.add(region);
  }

  setPage(page: RenderPage): void {
    this.assertActive();
    assertRect(page.rect, "renderPage.rect");
    this.page = freezeRenderPage(page);
    this.viewport.setPageRect(page.rect);
    this.invalidate({ kind: "viewport" });
  }

  setTheme(theme: RenderTheme): void {
    this.assertActive();
    this.theme = freezeRenderTheme(theme);
    this.invalidate({ kind: "viewport" });
  }

  render(timestamp: number): boolean {
    this.assertActive();
    assertFiniteNumber(timestamp, "render.timestamp");
    if (!this.dirtyRegions.hasDirtyRegions) {
      return false;
    }

    const input: RenderInput = Object.freeze({
      viewport: this.viewport.snapshot(),
      page: this.page,
      theme: this.theme,
      dirtyRegions: this.dirtyRegions.consume(),
      timestamp,
    });
    this.renderFrame(input);
    return true;
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.dirtyRegions.clear();
    this.destroyed = true;
  }

  private renderFrame(input: RenderInput): void {
    const { context } = this;
    const { size, devicePixelRatio, camera } = input.viewport;

    context.save();
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    context.beginPath();
    context.rect(0, 0, size.width, size.height);
    context.clip();
    context.fillStyle = input.theme.workspaceColor;
    context.fillRect(0, 0, size.width, size.height);

    context.translate(size.width / 2, size.height / 2);
    context.scale(camera.zoom, camera.zoom);
    context.translate(-camera.position.x, -camera.position.y);
    this.renderPage(input);
    for (const hook of this.overlayHooks) {
      hook(context, input);
    }
    context.restore();
  }

  private renderPage(input: RenderInput): void {
    const { context } = this;
    const { x, y, width, height } = input.page.rect;

    context.save();
    context.shadowColor = input.theme.pageShadowColor;
    context.shadowBlur = 28 / input.viewport.camera.zoom;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 10 / input.viewport.camera.zoom;
    context.fillStyle = input.theme.pageColor;
    context.fillRect(x, y, width, height);
    context.restore();

    this.renderPageBackground(input);
    context.strokeStyle = input.theme.pageBorderColor;
    context.lineWidth = 1 / input.viewport.camera.zoom;
    context.strokeRect(x, y, width, height);
  }

  private renderPageBackground(input: RenderInput): void {
    const background = input.page.background;
    if (background.kind === "plain") {
      return;
    }

    const { context } = this;
    const { x, y, width, height } = input.page.rect;
    const spacing = background.spacing ?? (background.kind === "grid" ? 24 : 28);
    if (!Number.isFinite(spacing) || spacing <= 0) {
      throw new RenderingError("INVALID_GEOMETRY", "Page background spacing must be positive.", {
        spacing,
      });
    }

    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.beginPath();
    context.strokeStyle = background.lineColor ?? input.theme.pageLineColor;
    context.lineWidth = 1 / input.viewport.camera.zoom;

    for (let lineY = y + spacing; lineY < y + height; lineY += spacing) {
      context.moveTo(x, lineY);
      context.lineTo(x + width, lineY);
    }
    if (background.kind === "grid") {
      for (let lineX = x + spacing; lineX < x + width; lineX += spacing) {
        context.moveTo(lineX, y);
        context.lineTo(lineX, y + height);
      }
    }
    context.stroke();
    context.restore();
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new RenderingError("RENDERER_DESTROYED", "The renderer has been destroyed.");
    }
  }
}
