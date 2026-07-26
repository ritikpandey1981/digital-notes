import { memo } from "react";
import { WorkspacePlaceholder } from "./WorkspacePlaceholder";

export const CanvasHost = memo(function CanvasHost() {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      data-testid="canvas-host"
      data-canvas-state="placeholder"
    >
      <WorkspacePlaceholder />
    </div>
  );
});
