import { CanvasSurface } from "@folio/editor";
import { memo } from "react";

export const CanvasHost = memo(function CanvasHost() {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-testid="canvas-host"
      data-canvas-state="ready"
    >
      <CanvasSurface className="size-full" />
    </div>
  );
});
