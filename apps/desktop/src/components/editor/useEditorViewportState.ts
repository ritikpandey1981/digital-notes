import {
  DEFAULT_EDITOR_VIEWPORT_SNAPSHOT,
  type EditorViewportSnapshot,
  type ViewportActions,
} from "@folio/editor";
import { useCallback, useRef, useState } from "react";

export function useEditorViewportState() {
  const actionsRef = useRef<ViewportActions | null>(null);
  const [snapshot, setSnapshot] = useState<EditorViewportSnapshot>(
    DEFAULT_EDITOR_VIEWPORT_SNAPSHOT,
  );
  const handleActionsReady = useCallback((actions: ViewportActions | null) => {
    actionsRef.current = actions;
  }, []);
  const handleViewportChange = useCallback((nextSnapshot: EditorViewportSnapshot) => {
    setSnapshot(nextSnapshot);
  }, []);
  const zoomIn = useCallback(() => actionsRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => actionsRef.current?.zoomOut(), []);
  const setZoom = useCallback((zoom: number) => actionsRef.current?.setZoom(zoom), []);
  const resetZoom = useCallback(() => actionsRef.current?.resetZoom(), []);
  const fitPage = useCallback(() => actionsRef.current?.fitPage(), []);
  const fitWidth = useCallback(() => actionsRef.current?.fitWidth(), []);

  return {
    snapshot,
    handleActionsReady,
    handleViewportChange,
    zoomIn,
    zoomOut,
    setZoom,
    resetZoom,
    fitPage,
    fitWidth,
  } as const;
}
