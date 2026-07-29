import { useLayoutEffect, useRef } from "react";
import type { ToolOptionsDescriptor } from "./tool-options-registry";

interface StrokePreviewCanvasProps {
  readonly descriptor: ToolOptionsDescriptor;
}

const LOGICAL_WIDTH = 278;
const LOGICAL_HEIGHT = 64;

export function StrokePreviewCanvas({ descriptor }: StrokePreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { color, width, opacity } = descriptor.preview;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas === null || context === null || context === undefined) return;

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(LOGICAL_WIDTH * devicePixelRatio);
    canvas.height = Math.round(LOGICAL_HEIGHT * devicePixelRatio);
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    context.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    context.save();
    context.globalAlpha *= opacity;
    context.strokeStyle = color;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(12, 43);
    context.bezierCurveTo(70, 10, 178, 55, 256, 20);
    context.stroke();
    context.restore();
  }, [color, opacity, width]);

  return (
    <canvas
      ref={canvasRef}
      className="h-16 w-full rounded-xl border border-folio-border bg-folio-paper"
      role="img"
      aria-label={`${descriptor.displayName} stroke preview`}
      data-preview-renderer="canvas2d-bezier"
      data-preview-width={width}
      data-preview-opacity={opacity}
    />
  );
}
