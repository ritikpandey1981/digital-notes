import { cn } from "@folio/ui";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface ToolTooltipProps {
  readonly label: string;
  readonly side?: "right" | "bottom";
  readonly hidden?: boolean;
}

interface TooltipRequest {
  readonly anchor: HTMLElement;
  readonly label: string;
  readonly side: "right" | "bottom";
  readonly bounds: DOMRect;
}

interface TooltipLayerControls {
  readonly show: (request: Omit<TooltipRequest, "bounds">) => void;
  readonly hide: (anchor: HTMLElement) => void;
}

interface TooltipLayerState {
  readonly request: TooltipRequest | null;
  readonly visible: boolean;
}

const TooltipLayerContext = createContext<TooltipLayerControls | null>(null);

/** Owns the single document-level layer used by every editor tooltip. */
export function TooltipLayerProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<TooltipLayerState>(() =>
    Object.freeze({ request: null, visible: false }),
  );
  const { request, visible } = state;

  const show = useCallback((next: Omit<TooltipRequest, "bounds">): void => {
    setState(
      Object.freeze({
        request: Object.freeze({ ...next, bounds: next.anchor.getBoundingClientRect() }),
        visible: true,
      }),
    );
  }, []);
  const hide = useCallback((anchor: HTMLElement): void => {
    setState((current) =>
      current.request?.anchor === anchor
        ? Object.freeze({ request: current.request, visible: false })
        : current,
    );
  }, []);
  const controls = useMemo(() => Object.freeze({ show, hide }), [hide, show]);

  useEffect(() => {
    const anchor = request?.anchor;
    if (!visible || anchor === undefined) return;
    const updateBounds = (): void => {
      setState((current) =>
        current.request?.anchor === anchor
          ? Object.freeze({
              ...current,
              request: Object.freeze({
                ...current.request,
                bounds: anchor.getBoundingClientRect(),
              }),
            })
          : current,
      );
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(anchor);
    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds, true);
    };
  }, [request?.anchor, visible]);

  return (
    <TooltipLayerContext.Provider value={controls}>
      {children}
      {createPortal(
        <div
          className="pointer-events-none fixed inset-0"
          style={{ zIndex: 1_000 }}
          data-tooltip-layer="global"
          aria-hidden={request === null || !visible}
        >
          <span
            className={cn(
              "folio-tool-tooltip pointer-events-none fixed whitespace-nowrap px-2.5 py-1.5 text-xs font-medium leading-none text-folio-ink",
              visible && request !== null ? "visible opacity-100" : "invisible opacity-0",
            )}
            style={tooltipPosition(request)}
            role="tooltip"
            data-side={request?.side ?? "right"}
            data-tooltip-motion="fade-120ms"
            data-tooltip-surface="auxiliary-soft"
          >
            {request?.label ?? ""}
          </span>
        </div>,
        document.body,
      )}
    </TooltipLayerContext.Provider>
  );
}

/** Registers a compact editor control with the shared global tooltip layer. */
export function ToolTooltip({ label, side = "right", hidden = false }: ToolTooltipProps) {
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const layer = useContext(TooltipLayerContext);

  useEffect(() => {
    const anchor = probeRef.current?.parentElement;
    if (!(anchor instanceof HTMLElement) || layer === null) return;
    let hovered = false;
    let focused = false;
    let hoverSuppressed = false;
    let focusSuppressed = false;
    const show = (source: "hover" | "focus"): void => {
      if (!hidden && (source === "hover" ? !hoverSuppressed : !focusSuppressed)) {
        layer.show({ anchor, label, side });
      }
    };
    const hideIfInactive = (): void => {
      if ((!hovered || hoverSuppressed) && (!focused || focusSuppressed)) layer.hide(anchor);
    };
    const handleMouseEnter = (): void => {
      hovered = true;
      show("hover");
    };
    const handleMouseLeave = (): void => {
      hovered = false;
      hoverSuppressed = false;
      hideIfInactive();
    };
    const handleFocusIn = (): void => {
      focused = true;
      show("focus");
    };
    const handleFocusOut = (): void => {
      focused = false;
      focusSuppressed = false;
      hideIfInactive();
    };
    const handleActivation = (event: Event): void => {
      hoverSuppressed = hovered || anchor.matches(":hover");
      focusSuppressed =
        event.type === "pointerdown" || focused || anchor.contains(document.activeElement);
      layer.hide(anchor);
    };
    anchor.addEventListener("mouseenter", handleMouseEnter);
    anchor.addEventListener("mouseleave", handleMouseLeave);
    anchor.addEventListener("focusin", handleFocusIn);
    anchor.addEventListener("focusout", handleFocusOut);
    anchor.addEventListener("pointerdown", handleActivation);
    anchor.addEventListener("click", handleActivation);
    if (hidden) layer.hide(anchor);
    else if (anchor.matches(":hover")) show("hover");
    else if (anchor.matches(":focus-visible")) show("focus");
    return () => {
      layer.hide(anchor);
      anchor.removeEventListener("mouseenter", handleMouseEnter);
      anchor.removeEventListener("mouseleave", handleMouseLeave);
      anchor.removeEventListener("focusin", handleFocusIn);
      anchor.removeEventListener("focusout", handleFocusOut);
      anchor.removeEventListener("pointerdown", handleActivation);
      anchor.removeEventListener("click", handleActivation);
    };
  }, [hidden, label, layer, side]);

  return <span ref={probeRef} className="hidden" aria-hidden="true" />;
}

function tooltipPosition(request: TooltipRequest | null): CSSProperties {
  if (request === null) return { left: 0, top: 0 };
  if (request.side === "bottom") {
    return {
      left: request.bounds.left + request.bounds.width / 2,
      top: request.bounds.bottom + 12,
      transform: "translateX(-50%)",
    };
  }
  return {
    left: request.bounds.right + 12,
    top: request.bounds.top + request.bounds.height / 2,
    transform: "translateY(-50%)",
  };
}
