import {
  isVectorObject,
  type LineGeometry,
  type PageObject,
  type Transform,
  type VectorPageObject,
} from "@folio/document";
import { RenderScheduler, type AnimationFrameAdapter, type Viewport } from "@folio/rendering";
import type { LineEndpoint, LineHandle } from "./LineEndpointInteraction";
import { resolveOrientedSelectionFrame } from "./SelectionManipulationTarget";
import { appendVectorGeometryPath } from "./VectorShapeRendering";

export interface VectorInteractionOverlayRendererOptions {
  readonly context: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  readonly viewport: Viewport;
  readonly animationFrameAdapter?: AnimationFrameAdapter;
}

/** Editor-owned presentation overlay for vector hover and line-specific selection feedback. */
export class VectorInteractionOverlayRenderer {
  readonly #context: CanvasRenderingContext2D;
  readonly #canvas: HTMLCanvasElement;
  readonly #viewport: Viewport;
  readonly #scheduler: RenderScheduler;
  #selection: VectorPageObject | null = null;
  #selectionPreviewTransform: Transform | null = null;
  #hover: PageObject | null = null;
  #hoverPresentation: "hover" | "candidate" = "hover";
  #lineHandleHover: LineHandle | null = null;
  #lineEndpointPreview: Readonly<{
    object: Extract<VectorPageObject, { readonly type: "line" }>;
    transform: Transform;
    activeEndpoint: LineEndpoint;
  }> | null = null;
  #destroyed = false;

  constructor(options: VectorInteractionOverlayRendererOptions) {
    this.#context = options.context;
    this.#canvas = options.canvas;
    this.#viewport = options.viewport;
    this.#scheduler = new RenderScheduler(() => this.#render(), options.animationFrameAdapter);
    this.#updateDiagnostics();
  }

  setSelection(object: VectorPageObject | null): void {
    this.#assertActive();
    if (this.#selection === object) return;
    this.#selection = object;
    this.#selectionPreviewTransform = null;
    this.#scheduler.requestRender();
    this.#updateDiagnostics();
  }

  setSelectionPreviewTransform(transform: Transform | null): void {
    this.#assertActive();
    if (sameTransform(this.#selectionPreviewTransform, transform)) return;
    this.#selectionPreviewTransform = transform;
    this.#scheduler.requestRender();
    this.#updateDiagnostics();
  }

  setHover(object: PageObject | null, presentation: "hover" | "candidate" = "hover"): void {
    this.#assertActive();
    if (this.#hover === object && this.#hoverPresentation === presentation) return;
    this.#hover = object;
    this.#hoverPresentation = presentation;
    this.#scheduler.requestRender();
    this.#updateDiagnostics();
  }

  setLineHandleHover(handle: LineHandle | null): void {
    this.#assertActive();
    if (this.#lineHandleHover === handle) return;
    this.#lineHandleHover = handle;
    this.#scheduler.requestRender();
    this.#updateDiagnostics();
  }

  setLineEndpointPreview(
    preview: Readonly<{
      object: Extract<VectorPageObject, { readonly type: "line" }>;
      transform: Transform;
      activeEndpoint: LineEndpoint;
    }> | null,
  ): void {
    this.#assertActive();
    this.#lineEndpointPreview = preview === null ? null : Object.freeze({ ...preview });
    this.#scheduler.requestRender();
    this.#updateDiagnostics();
  }

  redraw(): void {
    this.#assertActive();
    this.#scheduler.requestRender();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#scheduler.destroy();
    this.#selection = null;
    this.#selectionPreviewTransform = null;
    this.#hover = null;
    this.#hoverPresentation = "hover";
    this.#lineHandleHover = null;
    this.#lineEndpointPreview = null;
    this.#destroyed = true;
    this.#updateDiagnostics();
  }

  #render(): void {
    if (this.#destroyed) return;
    const snapshot = this.#viewport.snapshot();
    const context = this.#context;
    context.save();
    context.setTransform(snapshot.devicePixelRatio, 0, 0, snapshot.devicePixelRatio, 0, 0);
    context.clearRect(0, 0, snapshot.size.width, snapshot.size.height);
    context.translate(snapshot.size.width / 2, snapshot.size.height / 2);
    context.scale(snapshot.camera.zoom, snapshot.camera.zoom);
    context.translate(-snapshot.camera.position.x, -snapshot.camera.position.y);
    context.translate(snapshot.pageRect.x, snapshot.pageRect.y);
    context.beginPath();
    context.rect(0, 0, snapshot.pageRect.width, snapshot.pageRect.height);
    context.clip();
    if (this.#hover !== null && this.#hover !== this.#selection) {
      if (isVectorObject(this.#hover)) {
        this.#drawEmphasis(this.#hover, this.#hoverPresentation, snapshot.camera.zoom);
      } else {
        this.#drawBoundsHover(this.#hover, snapshot.camera.zoom, this.#hoverPresentation);
      }
    }
    if (this.#selection !== null) {
      const endpointPreview = this.#lineEndpointPreview;
      this.#drawEmphasis(
        this.#selection,
        "selected",
        snapshot.camera.zoom,
        endpointPreview?.object.id === this.#selection.id
          ? endpointPreview.transform
          : (this.#selectionPreviewTransform ?? this.#selection.transform),
        endpointPreview?.object.id === this.#selection.id
          ? endpointPreview.activeEndpoint
          : this.#lineHandleHover,
      );
    }
    context.restore();
  }

  #drawSelectionFrame(object: VectorPageObject, transform: Transform, zoom: number): void {
    const context = this.#context;
    const frame = resolveOrientedSelectionFrame(object.localBounds, transform, zoom);
    const first = frame.corners[0];
    if (first === undefined) return;
    context.save();
    context.strokeStyle = "#7183ce";
    context.lineWidth = 2 / zoom;
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const corner of frame.corners.slice(1)) context.lineTo(corner.x, corner.y);
    context.closePath();
    context.stroke();
    context.beginPath();
    context.moveTo(frame.topMidpoint.x, frame.topMidpoint.y);
    context.lineTo(frame.rotationHandle.x, frame.rotationHandle.y);
    context.stroke();
    const handleSize = 10 / zoom;
    const halfHandle = handleSize / 2;
    context.fillStyle = "#ffffff";
    for (const corner of frame.corners) {
      context.fillRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
      context.strokeRect(corner.x - halfHandle, corner.y - halfHandle, handleSize, handleSize);
    }
    context.beginPath();
    context.arc(frame.rotationHandle.x, frame.rotationHandle.y, halfHandle, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  #drawEmphasis(
    object: VectorPageObject,
    state: "hover" | "candidate" | "selected",
    zoom: number,
    transform = object.transform,
    activeLineHandle: LineHandle | null = null,
  ): void {
    const context = this.#context;
    const { localBounds } = object;
    const pivotX = localBounds.x + localBounds.width / 2;
    const pivotY = localBounds.y + localBounds.height / 2;
    context.save();
    context.translate(transform.translation.x, transform.translation.y);
    context.translate(pivotX, pivotY);
    context.rotate(transform.rotation);
    context.scale(transform.scale, transform.scale);
    context.translate(-pivotX, -pivotY);
    if (state !== "selected") {
      context.strokeStyle = state === "hover" ? "rgba(113, 131, 206, 0.42)" : "#7183ce";
      context.lineCap = "round";
      context.lineJoin = "round";
      const emphasisPixels = state === "candidate" ? 2.25 : 1.5;
      context.lineWidth =
        object.style.strokeWidth / transform.scale + emphasisPixels / zoom / transform.scale;
      context.beginPath();
      appendVectorGeometryPath(context, object.type, object.geometry);
      context.stroke();
    }
    if (state === "selected" && object.type === "line") {
      this.#drawLineHandles(object.geometry, zoom, transform.scale, activeLineHandle);
    }
    context.restore();
    if (state === "selected" && object.type !== "line") {
      this.#drawSelectionFrame(object, transform, zoom);
    }
  }

  #drawBoundsHover(object: PageObject, zoom: number, presentation: "hover" | "candidate"): void {
    const context = this.#context;
    const padding = 2 / zoom;
    context.save();
    context.strokeStyle = presentation === "candidate" ? "#7183ce" : "rgba(113, 131, 206, 0.42)";
    context.lineWidth = (presentation === "candidate" ? 2.25 : 1.5) / zoom;
    context.setLineDash(presentation === "candidate" ? [] : [4 / zoom, 3 / zoom]);
    context.strokeRect(
      object.bounds.x - padding,
      object.bounds.y - padding,
      object.bounds.width + padding * 2,
      object.bounds.height + padding * 2,
    );
    context.restore();
  }

  #drawLineHandles(
    geometry: LineGeometry,
    zoom: number,
    scale: number,
    activeHandle: LineHandle | null,
  ): void {
    const context = this.#context;
    const radius = 4.5 / zoom / scale;
    const points = [
      { handle: "start", point: geometry.start },
      { handle: "end", point: geometry.end },
      {
        handle: "midpoint",
        point: Object.freeze({
          x: (geometry.start.x + geometry.end.x) / 2,
          y: (geometry.start.y + geometry.end.y) / 2,
        }),
      },
    ] as const;
    context.lineWidth = 1.25 / zoom / scale;
    for (const { handle, point } of points) {
      const active = handle === activeHandle;
      context.fillStyle = active ? "#7183ce" : "#ffffff";
      context.strokeStyle = "#7183ce";
      context.beginPath();
      context.arc(point.x, point.y, active ? radius * 1.35 : radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }
  }

  #updateDiagnostics(): void {
    this.#canvas.dataset.vectorHoverState = this.#hover === null ? "idle" : "hovered";
    this.#canvas.dataset.hoveredObjectId = this.#hover?.id ?? "";
    this.#canvas.dataset.vectorHoverPresentation =
      this.#hover === null ? "none" : this.#hoverPresentation;
    this.#canvas.dataset.lineHandleHover = this.#lineHandleHover ?? "";
    this.#canvas.dataset.lineEndpointPreview = String(this.#lineEndpointPreview !== null);
    this.#canvas.dataset.activeLineEndpoint = this.#lineEndpointPreview?.activeEndpoint ?? "";
    this.#canvas.dataset.vectorSelectionStyle =
      this.#selection?.type === "line"
        ? "line-handles"
        : this.#selection === null
          ? "empty"
          : "outline-emphasis";
    this.#canvas.dataset.vectorSelectionPresentation = "soft";
    this.#canvas.dataset.vectorSelectionRotation = String(
      this.#selectionPreviewTransform?.rotation ?? this.#selection?.transform.rotation ?? 0,
    );
    const selectionTransform = this.#selectionPreviewTransform ?? this.#selection?.transform;
    if (
      this.#selection !== null &&
      this.#selection.type !== "line" &&
      selectionTransform !== undefined
    ) {
      const frame = resolveOrientedSelectionFrame(
        this.#selection.localBounds,
        selectionTransform,
        this.#viewport.camera.zoom,
      );
      this.#canvas.dataset.vectorSelectionFrameCorners = JSON.stringify(frame.corners);
      this.#canvas.dataset.vectorRotationHandle = JSON.stringify(frame.rotationHandle);
    } else {
      this.#canvas.dataset.vectorSelectionFrameCorners = "[]";
      this.#canvas.dataset.vectorRotationHandle = "";
    }
  }

  #assertActive(): void {
    if (this.#destroyed) throw new Error("Vector interaction overlay is destroyed.");
  }
}

function sameTransform(first: Transform | null, second: Transform | null): boolean {
  if (first === null || second === null) return first === second;
  return (
    first.translation.x === second.translation.x &&
    first.translation.y === second.translation.y &&
    first.rotation === second.rotation &&
    first.scale === second.scale
  );
}
