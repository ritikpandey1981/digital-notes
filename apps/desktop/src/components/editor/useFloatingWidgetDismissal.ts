import { useEffect, useRef, type RefObject } from "react";

export function useFloatingWidgetDismissal<TBoundary extends HTMLElement = HTMLElement>(
  open: boolean,
  onDismiss: () => void,
): RefObject<TBoundary | null> {
  const boundaryRef = useRef<TBoundary | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (boundaryRef.current?.contains(event.target) === true) return;
      if (
        event.target instanceof Element &&
        event.target.closest('[data-floating-widget-owned-portal="true"]') !== null
      ) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest("[data-tool-dock-layout]") !== null
      ) {
        return;
      }
      const canvasRegion = resolveCanvasPointerRegion(event);
      if (canvasRegion === "workspace") {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
        return;
      }
      if (canvasRegion === "page") {
        queueMicrotask(onDismiss);
        return;
      }
      onDismiss();
    };
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onDismiss();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [onDismiss, open]);

  return boundaryRef;
}

type CanvasPointerRegion = "outside" | "page" | "workspace";

function resolveCanvasPointerRegion(event: PointerEvent): CanvasPointerRegion {
  if (!(event.target instanceof Element)) return "outside";
  const surface = event.target.closest('[data-testid="canvas-surface"]');
  if (surface === null) return "outside";
  const canvas = surface.querySelector('canvas[data-folio-renderer="true"]');
  if (!(canvas instanceof HTMLCanvasElement)) return "page";
  const bounds = canvas.getBoundingClientRect();
  const logicalWidth = Number(canvas.dataset.logicalWidth);
  const logicalHeight = Number(canvas.dataset.logicalHeight);
  const pageX = Number(canvas.dataset.pageX);
  const pageY = Number(canvas.dataset.pageY);
  const pageWidth = Number(canvas.dataset.pageWidth);
  const pageHeight = Number(canvas.dataset.pageHeight);
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    ![logicalWidth, logicalHeight, pageX, pageY, pageWidth, pageHeight].every(Number.isFinite)
  ) {
    return "page";
  }
  const canvasX = (event.clientX - bounds.left) * (logicalWidth / bounds.width);
  const canvasY = (event.clientY - bounds.top) * (logicalHeight / bounds.height);
  const isPage =
    canvasX >= pageX &&
    canvasX <= pageX + pageWidth &&
    canvasY >= pageY &&
    canvasY <= pageY + pageHeight;
  return isPage ? "page" : "workspace";
}
