import { useEffect, useId, type RefObject } from "react";

/** Owns dismissal for one floating widget and any portaled descendants carrying its scope. */
export function useFloatingWidgetDismissal(
  open: boolean,
  onDismiss: () => void,
  boundaryRef: RefObject<HTMLElement | null>,
  options: Readonly<{
    onEscape?: () => void;
    canvasPageDismissal?: "microtask" | "synchronous";
    /**
     * Workspace panels such as Layers stay open until they are explicitly
     * closed. Tool widgets keep the default outside-pointer dismissal.
     */
    outsidePointerDismissal?: "dismiss" | "ignore";
    scopeId?: string;
  }> = {},
): string {
  const generatedScopeId = useId();
  const scopeId = options.scopeId ?? generatedScopeId;

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointerDown = (event: PointerEvent): void => {
      if (options.outsidePointerDismissal === "ignore") return;
      if (!(event.target instanceof Node)) return;
      if (boundaryRef.current?.contains(event.target) === true) return;
      if (event.target instanceof Element && isOwnedFloatingSurface(event.target, scopeId)) return;
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
        if (options.canvasPageDismissal === "synchronous") onDismiss();
        else queueMicrotask(onDismiss);
        return;
      }
      onDismiss();
    };
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof Element && isOwnedFloatingSurface(event.target, scopeId)) return;
      event.preventDefault();
      (options.onEscape ?? onDismiss)();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [boundaryRef, onDismiss, open, options.canvasPageDismissal, options.onEscape, scopeId]);

  return scopeId;
}

function isOwnedFloatingSurface(target: Element, scopeId: string): boolean {
  let candidate: Element | null = target;
  while (candidate !== null) {
    const owners = candidate.getAttribute("data-floating-widget-owner")?.split(/\s+/u) ?? [];
    if (owners.includes(scopeId)) return true;
    candidate = candidate.parentElement;
  }
  return false;
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
