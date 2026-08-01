import { useLayoutEffect, useRef } from "react";
import type { ToolOptionsDescriptor } from "./tool-options-registry";

interface StrokePreviewCanvasProps {
  readonly descriptor: ToolOptionsDescriptor;
  readonly renderScale: number;
}

const LOGICAL_WIDTH = 278;
const LOGICAL_HEIGHT = 64;

export function StrokePreviewCanvas({ descriptor, renderScale }: StrokePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { color, width, opacity } = descriptor.preview;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || context === null || context === undefined) return;

    const devicePixelRatio = window.devicePixelRatio || 1;
    const physicalWidth = Math.round(LOGICAL_WIDTH * devicePixelRatio);
    const physicalHeight = Math.round(LOGICAL_HEIGHT * devicePixelRatio);
    if (canvas.width !== physicalWidth) canvas.width = physicalWidth;
    if (canvas.height !== physicalHeight) canvas.height = physicalHeight;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    context.save();
    context.globalAlpha *= opacity;
    context.strokeStyle = color;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = width * renderScale;
    context.beginPath();
    context.moveTo(12, 43);
    context.bezierCurveTo(70, 10, 178, 55, 256, 20);
    context.stroke();
    context.restore();
  }, [color, opacity, renderScale, width]);

  return (
    <canvas
      ref={canvasRef}
      className="h-16 w-full rounded-xl border border-folio-border bg-folio-paper"
      role="img"
      aria-label={`${descriptor.displayName} stroke preview`}
      data-preview-renderer="canvas2d-bezier"
      data-preview-width={width}
      data-preview-render-scale={renderScale}
      data-preview-rendered-width={width * renderScale}
      data-preview-opacity={opacity}
    />
  );
}
