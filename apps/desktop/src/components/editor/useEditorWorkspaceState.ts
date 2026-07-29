import {
  createEditorColorSystem,
  createPenPresetStore,
  type CanvasDrawingStyle,
  type DrawingToolKind,
  type PenPresetPatch,
} from "@folio/editor";
import * as React from "react";
import type { EditorTool } from "./editor-types";

export function useEditorWorkspaceState() {
  const [activeTool, setActiveTool] = React.useState<EditorTool>("Select");
  const [, setFoundationVersion] = React.useState(0);
  const [colorSystem] = React.useState(() => createEditorColorSystem());
  const [presetStore] = React.useState(() => createPenPresetStore());

  const drawingKind: DrawingToolKind = activeTool === "Highlighter" ? "highlighter" : "pen";
  const activePreset = presetStore.activePreset(drawingKind);
  const drawingStyle: CanvasDrawingStyle = Object.freeze({
    color: activePreset.style.strokeColor.hex,
    width: activePreset.style.strokeWidth,
    opacity: activePreset.style.strokeColor.opacity,
    pressureEnabled: activePreset.pressure.enabled,
  });
  const refresh = (): void => setFoundationVersion((version) => version + 1);
  const updatePreset = (patch: PenPresetPatch): void => {
    presetStore.updateActivePreset(drawingKind, patch);
    const color =
      typeof patch.color === "string"
        ? colorSystem.createColor({
            hex: patch.color,
            opacity: patch.opacity ?? activePreset.style.strokeColor.opacity,
          })
        : patch.color;
    if (color !== undefined) colorSystem.remember(color);
    refresh();
  };

  return {
    activeTool,
    selectTool: setActiveTool,
    drawingStyle,
    activePreset,
    availablePresets: presetStore.presetsFor(drawingKind),
    colors: colorSystem.snapshot(),
    selectPreset: (presetId: string) => {
      presetStore.selectPreset(drawingKind, presetId);
      refresh();
    },
    setDrawingColor: (color: string) => updatePreset({ color }),
    setDrawingWidth: (strokeWidth: number) => updatePreset({ strokeWidth }),
    setDrawingOpacity: (opacity: number) => updatePreset({ opacity }),
  };
}
