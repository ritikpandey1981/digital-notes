import { CanvasSurface } from "@folio/editor";
import { memo } from "react";

export const CanvasHost = memo(function CanvasHost() {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-testid="canvas-host"
      data-canvas-state="ready"
      data-document-state="ready"
      data-ink-state="ready"
    >
      <CanvasSurface className="relative size-full" />
    </div>
  );
});
