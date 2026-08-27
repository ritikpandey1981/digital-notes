import { RenderingError } from "./errors";

/** Below this screen spacing the pattern is pure moiré and is skipped outright. */
const MINIMUM_PATTERN_SCREEN_SPACING = 4;
/** Above this screen spacing the pattern draws at full strength. */
const FULL_PATTERN_SCREEN_SPACING = 12;

/**
 * Fades paper patterns out as their spacing approaches the pixel grid.
 *
 * A grid drawn at six screen pixels of spacing reads as noise rather than as
 * paper, so density drives opacity instead of the pattern simply appearing.
 */
export function paperPatternAlpha(screenSpacing: number): number {
  if (!Number.isFinite(screenSpacing) || screenSpacing <= MINIMUM_PATTERN_SCREEN_SPACING) return 0;
  if (screenSpacing >= FULL_PATTERN_SCREEN_SPACING) return 1;
  return (
    (screenSpacing - MINIMUM_PATTERN_SCREEN_SPACING) /
    (FULL_PATTERN_SCREEN_SPACING - MINIMUM_PATTERN_SCREEN_SPACING)
  );
}
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
    // Paper color is page state; the theme only supplies the fallback.
    context.fillStyle = input.page.paperColor ?? input.theme.pageColor;
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
    const spacing = background.spacing ?? (background.kind === "ruled" ? 28 : 24);
    if (!Number.isFinite(spacing) || spacing <= 0) {
      throw new RenderingError("INVALID_GEOMETRY", "Page background spacing must be positive.", {
        spacing,
      });
    }

    const zoom = input.viewport.camera.zoom;
    // Pattern spacing is page-anchored, so zooming magnifies the same physical
    // paper. Below roughly two screen pixels of spacing the pattern reads as a
    // flat tint, so it is skipped rather than drawn as millions of primitives.
    const patternAlpha = paperPatternAlpha(spacing * zoom);
    if (patternAlpha <= 0) return;

    context.save();
    context.globalAlpha *= patternAlpha;
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.strokeStyle = background.lineColor ?? input.theme.pageLineColor;
    context.fillStyle = background.lineColor ?? input.theme.pageLineColor;
    context.lineWidth = 1 / zoom;

    if (background.kind === "dotted") {
      const radius = Math.min(1.1 / zoom, spacing / 6);
      context.beginPath();
      for (let dotY = y + spacing; dotY < y + height; dotY += spacing) {
        for (let dotX = x + spacing; dotX < x + width; dotX += spacing) {
          context.moveTo(dotX + radius, dotY);
          context.arc(dotX, dotY, radius, 0, Math.PI * 2);
        }
      }
      context.fill();
      context.restore();
      return;
    }

    context.beginPath();
    if (background.kind === "isometric") {
      // Two 30-degree families plus verticals, laid out from page-space origin.
      const step = spacing;
      const slope = Math.tan(Math.PI / 6);
      const span = width * slope;
      for (let originY = y - span; originY < y + height + span; originY += step) {
        context.moveTo(x, originY);
        context.lineTo(x + width, originY + span);
        context.moveTo(x, originY + span);
        context.lineTo(x + width, originY);
      }
      for (let lineX = x + step; lineX < x + width; lineX += step) {
        context.moveTo(lineX, y);
        context.lineTo(lineX, y + height);
      }
      context.stroke();
      context.restore();
      return;
    }

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
