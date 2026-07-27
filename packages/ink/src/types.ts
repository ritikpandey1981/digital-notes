import type { Point, Rect } from "@folio/rendering";

export type InkPointerType = "mouse" | "pen" | "touch";
export type StrokeSmoothingMode = "none" | "average" | "catmull-rom" | "bezier";

export interface StrokePointInput extends Point {
  readonly timestamp: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly pointerType: InkPointerType;
  readonly button: number;
  readonly buttons: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
}

export interface StrokePoint extends StrokePointInput {
  readonly delta: Point;
  readonly velocity: number;
  readonly acceleration: number;
}

export interface StrokeBounds extends Rect {
  readonly center: Point;
}

export interface StrokeMetrics {
  readonly bounds: StrokeBounds;
  readonly inflatedBounds: StrokeBounds;
  readonly dirtyRect: Rect;
  readonly center: Point;
  readonly length: number;
  readonly duration: number;
}

export interface StrokeStatistics {
  readonly pointCount: number;
  readonly averagePressure: number;
  readonly minimumPressure: number;
  readonly maximumPressure: number;
  readonly averageVelocity: number;
  readonly minimumVelocity: number;
  readonly maximumVelocity: number;
  readonly averageAcceleration: number;
  readonly maximumAcceleration: number;
}

export type PressureCurve = (pressure: number) => number;

export interface StrokeStyle {
  readonly color: string;
  readonly width: number;
  readonly opacity: number;
  readonly pressureEnabled: boolean;
  readonly lineCap: "round";
  readonly lineJoin: "round";
  readonly pressureCurve?: PressureCurve;
  readonly brushTextureId?: string;
}

export interface StrokeUpdate {
  readonly strokeId: string;
  readonly style: StrokeStyle;
  readonly point: StrokePoint;
  readonly points: ReadonlyArray<StrokePoint>;
  readonly bounds: StrokeBounds;
  readonly dirtyRect: Rect;
}

export interface StrokeCancellation {
  readonly strokeId: string;
  readonly reason: "pointer-cancel" | "pointer-leave" | "lost-capture" | "destroyed";
  readonly dirtyRect: Rect | null;
}

export interface SmoothingHook {
  readonly name: string;
  readonly smooth: (points: readonly StrokePointInput[], index: number) => Point;
}

export interface StrokeSmootherOptions {
  readonly mode?: StrokeSmoothingMode;
  readonly windowSize?: number;
  readonly strength?: number;
  readonly catmullRomHook?: SmoothingHook;
  readonly bezierHook?: SmoothingHook;
}

export interface StrokeBuilderOptions {
  readonly id?: string;
  readonly timestamp?: number;
  readonly style?: Partial<StrokeStyle>;
  readonly smoother?: import("./stroke-smoother").StrokeSmoother;
  readonly createId?: () => string;
  readonly now?: () => number;
}

export interface PointerInputCallbacks {
  readonly onStrokeStart?: (update: StrokeUpdate) => void;
  readonly onStrokeUpdate?: (update: StrokeUpdate) => void;
  readonly onStrokeFinalized?: (stroke: import("./stroke").Stroke) => void;
  readonly onStrokeCancelled?: (cancellation: StrokeCancellation) => void;
  readonly onError?: (error: InkErrorLike) => void;
}

export interface InkErrorLike extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface PointerInputControllerOptions extends PointerInputCallbacks {
  readonly coordinateConverter: import("@folio/rendering").CoordinateConverter;
  readonly getCanvasBounds: () => import("@folio/rendering").CanvasBounds;
  readonly style?: Partial<StrokeStyle>;
  readonly smoother?: import("./stroke-smoother").StrokeSmoother;
  readonly supportedPointerTypes?: readonly InkPointerType[];
  readonly createId?: () => string;
  readonly now?: () => number;
}

export interface StrokeRendererOptions {
  readonly context: CanvasRenderingContext2D;
  readonly viewport: import("@folio/rendering").Viewport;
  readonly canvas?: HTMLCanvasElement;
  readonly animationFrameAdapter?: import("@folio/rendering").AnimationFrameAdapter;
  readonly onInvalidate?: (dirtyRect: Rect) => void;
}

export interface StrokeRendererSnapshot {
  readonly finalizedStrokeCount: number;
  readonly finalizedPointCount: number;
  readonly livePointCount: number;
  readonly renderCount: number;
  readonly invalidationCount: number;
  readonly lastDirtyRect: Rect | null;
}

export const DEFAULT_STROKE_STYLE: StrokeStyle = Object.freeze({
  color: "#111111",
  width: 2,
  opacity: 1,
  pressureEnabled: true,
  lineCap: "round",
  lineJoin: "round",
});
