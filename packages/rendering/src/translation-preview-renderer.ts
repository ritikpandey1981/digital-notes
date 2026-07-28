import type { AnimationFrameAdapter, Point, Rect } from "./types";
import {
  TransformPreviewRenderer,
  type TransformPreviewRendererOptions,
  type TransformPreviewStyle,
  type TransformPreviewVisual,
} from "./transform-preview-renderer";
import type { Viewport } from "./viewport";

export type TranslationPreviewVisual = TransformPreviewVisual;

export interface TranslationPreviewTarget {
  readonly objectId: string;
  readonly bounds: Rect;
  readonly translation: Point;
  readonly visual: TranslationPreviewVisual;
}

export type TranslationPreviewStyle = TransformPreviewStyle;

export interface TranslationPreviewRendererOptions {
  readonly context: CanvasRenderingContext2D;
  readonly viewport: Viewport;
  readonly canvas?: HTMLCanvasElement;
  readonly style?: Partial<TranslationPreviewStyle>;
  readonly animationFrameAdapter?: AnimationFrameAdapter;
}

export interface TranslationPreviewRendererSnapshot {
  readonly objectId: string | null;
  readonly translation: Point | null;
  readonly renderCount: number;
  readonly invalidationCount: number;
  readonly hasPendingRender: boolean;
}

/** Source-compatible Translation façade over the generalized transform preview. */
export class TranslationPreviewRenderer {
  private readonly renderer: TransformPreviewRenderer;

  constructor(options: TranslationPreviewRendererOptions) {
    this.renderer = new TransformPreviewRenderer(options as TransformPreviewRendererOptions);
  }

  setPreview(target: TranslationPreviewTarget | null): void {
    this.renderer.setPreview(
      target === null
        ? null
        : {
            objectId: target.objectId,
            bounds: target.bounds,
            transform: Object.freeze({
              translation: target.translation,
              rotation: 0,
              scale: 1,
            }),
            visual: target.visual,
          },
    );
  }

  redraw(): void {
    this.renderer.redraw();
  }

  forceRender(): void {
    this.renderer.forceRender();
  }

  snapshot(): TranslationPreviewRendererSnapshot {
    const snapshot = this.renderer.snapshot();
    return Object.freeze({
      objectId: snapshot.objectId,
      translation: snapshot.transform?.translation ?? null,
      renderCount: snapshot.renderCount,
      invalidationCount: snapshot.invalidationCount,
      hasPendingRender: snapshot.hasPendingRender,
    });
  }

  destroy(): void {
    this.renderer.destroy();
  }
}
