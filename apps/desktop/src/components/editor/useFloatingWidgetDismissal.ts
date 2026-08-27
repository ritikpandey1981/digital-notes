import { useEffect, useId, useRef, type RefObject } from "react";
import { pushDismissal } from "./floating-dismissal-stack";

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
  // Handlers change identity freely; the stack entry must not be re-ordered by
  // it, so the live callbacks are read from refs kept current by one effect.
  const escapeRef = useRef<() => void>(onDismiss);
  const dismissRef = useRef(onDismiss);
  const pointerPolicyRef = useRef(options.outsidePointerDismissal);
  const canvasPolicyRef = useRef(options.canvasPageDismissal);
  const { onEscape, outsidePointerDismissal, canvasPageDismissal } = options;

  useEffect(() => {
    escapeRef.current = onEscape ?? onDismiss;
    dismissRef.current = onDismiss;
    pointerPolicyRef.current = outsidePointerDismissal;
    canvasPolicyRef.current = canvasPageDismissal;
  }, [canvasPageDismissal, onDismiss, onEscape, outsidePointerDismissal]);

  useEffect(() => {
    if (!open) return;
    return pushDismissal(scopeId, () => escapeRef.current());
  }, [open, scopeId]);

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointerDown = (event: PointerEvent): void => {
      if (pointerPolicyRef.current === "ignore") return;
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
        dismissRef.current();
        return;
      }
      if (canvasRegion === "page") {
        if (canvasPolicyRef.current === "synchronous") dismissRef.current();
        else queueMicrotask(() => dismissRef.current());
        return;
      }
      dismissRef.current();
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [boundaryRef, open, scopeId]);

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
