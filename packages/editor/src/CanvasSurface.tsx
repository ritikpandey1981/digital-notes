import {
  CanvasController,
  type CanvasControllerSnapshot,
  type RenderTheme,
} from "@folio/rendering";
import { useEffect, useRef } from "react";

export interface CanvasSurfaceProps {
  readonly className?: string;
  readonly onControllerReady?: (controller: CanvasController) => void;
  readonly onDiagnostics?: (snapshot: CanvasControllerSnapshot) => void;
  readonly onError?: (error: Error) => void;
}

function readTheme(): RenderTheme {
  const styles = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;

  return Object.freeze({
    workspaceColor: value("--folio-workspace", "#f1f1ef"),
    pageColor: value("--folio-page", "#fffdf8"),
    pageBorderColor: value("--folio-border", "rgba(37, 37, 34, 0.11)"),
    pageShadowColor:
      document.documentElement.dataset.theme === "dark"
        ? "rgba(0, 0, 0, 0.34)"
        : "rgba(0, 0, 0, 0.16)",
    pageLineColor: value("--folio-page-rule", "rgba(102, 118, 151, 0.16)"),
  });
}

export function CanvasSurface({
  className,
  onControllerReady,
  onDiagnostics,
  onError,
}: CanvasSurfaceProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const controller = new CanvasController({
      theme: readTheme(),
      onError: (error) => onError?.(error),
    });
    let themeObserver: MutationObserver | null = null;

    try {
      controller.mount(host);
      host.dataset.rendererState = "ready";
      onControllerReady?.(controller);
      onDiagnostics?.(controller.snapshot());
      themeObserver = new MutationObserver(() => {
        if (controller.status === "mounted") {
          controller.setTheme(readTheme());
          onDiagnostics?.(controller.snapshot());
        }
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "style", "class"],
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Canvas initialization failed.");
      host.dataset.rendererState = "error";
      onError?.(error);
    }

    return () => {
      themeObserver?.disconnect();
      controller.destroy();
    };
  }, [onControllerReady, onDiagnostics, onError]);

  return (
    <div
      ref={hostRef}
      className={className}
      data-testid="canvas-surface"
      data-renderer-state="initializing"
    />
  );
}
