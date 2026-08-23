export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Rect extends Point, Size {}

export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type CanvasBounds = Rect;

export interface CameraSnapshot {
  readonly position: Point;
  readonly zoom: number;
  readonly rotation: 0;
}

export interface ViewportSnapshot {
  readonly camera: CameraSnapshot;
  readonly size: Size;
  readonly visibleWorldRect: Rect;
  readonly pageRect: Rect;
  readonly pageViewportRect: Rect;
  readonly devicePixelRatio: number;
  readonly worldBounds: Rect;
}

export type ViewportMode = "manual" | "fit-page" | "fit-width";

export type PageBackground =
  | { readonly kind: "plain" }
  | {
      readonly kind: "grid";
      readonly spacing?: number;
      readonly lineColor?: string;
    }
  | {
      readonly kind: "ruled";
      readonly spacing?: number;
      readonly lineColor?: string;
    };

export interface RenderPage {
  readonly rect: Rect;
  readonly background: PageBackground;
}

export interface RenderTheme {
  readonly workspaceColor: string;
  readonly pageColor: string;
  readonly pageBorderColor: string;
  readonly pageShadowColor: string;
  readonly pageLineColor: string;
}

export type DirtyRegion =
  | { readonly kind: "viewport" }
  | { readonly kind: "page" }
  | {
      readonly kind: "rect";
      readonly rect: Rect;
      readonly coordinateSpace: "viewport" | "world" | "page";
    };

export interface RenderInput {
  readonly viewport: ViewportSnapshot;
  readonly page: RenderPage;
  readonly theme: RenderTheme;
  readonly dirtyRegions: readonly DirtyRegion[];
  readonly timestamp: number;
}

export type OverlayRenderHook = (context: CanvasRenderingContext2D, input: RenderInput) => void;

export interface AnimationFrameAdapter {
  readonly request: (callback: FrameRequestCallback) => number;
  readonly cancel: (handle: number) => void;
}

export interface ResizeObserverAdapter {
  readonly observe: (target: Element) => void;
  readonly disconnect: () => void;
}

export type ResizeObserverFactory = (callback: ResizeObserverCallback) => ResizeObserverAdapter;

export interface RenderDiagnosticsSnapshot {
  readonly frameCount: number;
  readonly renderCount: number;
  readonly invalidationCount: number;
  readonly contextLossCount: number;
  readonly lastFrameDurationMs: number;
  readonly averageFrameDurationMs: number;
  readonly maxFrameDurationMs: number;
  readonly viewportSize: Size;
  readonly canvasLogicalSize: Size;
  readonly canvasPhysicalSize: Size;
  readonly devicePixelRatio: number;
}

export interface CanvasControllerSnapshot {
  readonly status: "idle" | "mounted" | "context-lost" | "destroyed";
  readonly viewport: ViewportSnapshot | null;
  readonly viewportMode: ViewportMode;
  readonly diagnostics: RenderDiagnosticsSnapshot;
}

export interface CanvasOverlayLayerOptions {
  readonly name: string;
  readonly interactive?: boolean;
  readonly ariaLabel?: string;
}

export interface CanvasOverlayLayer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly name: string;
  setResizeHandler(handler: (() => void) | null): void;
  destroy(): void;
}

export interface CanvasControllerOptions {
  readonly page?: RenderPage;
  readonly theme?: RenderTheme;
  readonly fitPadding?: number | Partial<Insets>;
  readonly canvasFactory?: () => HTMLCanvasElement;
  readonly overlayCanvasFactory?: (name: string) => HTMLCanvasElement;
  readonly resizeObserverFactory?: ResizeObserverFactory;
  readonly animationFrameAdapter?: AnimationFrameAdapter;
  readonly getDevicePixelRatio?: () => number;
  readonly observeDevicePixelRatio?: (listener: () => void) => () => void;
  readonly now?: () => number;
  readonly overlayHooks?: readonly OverlayRenderHook[];
  readonly onViewportChange?: (snapshot: CanvasControllerSnapshot) => void;
  readonly onError?: (error: Error) => void;
}

export const DEFAULT_PAGE: RenderPage = Object.freeze({
  rect: Object.freeze({ x: 0, y: 0, width: 794, height: 1123 }),
  background: Object.freeze({ kind: "plain" }),
});

export const DEFAULT_RENDER_THEME: RenderTheme = Object.freeze({
  workspaceColor: "#f1f1ef",
  pageColor: "#fffdf8",
  pageBorderColor: "rgba(37, 37, 34, 0.11)",
  pageShadowColor: "rgba(0, 0, 0, 0.16)",
  pageLineColor: "rgba(102, 118, 151, 0.16)",
});

export const DEFAULT_FIT_PADDING: Insets = Object.freeze({
  top: 88,
  right: 56,
  bottom: 56,
  left: 56,
});
