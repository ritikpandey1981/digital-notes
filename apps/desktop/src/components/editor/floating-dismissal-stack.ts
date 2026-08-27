/**
 * One shared last-in-first-out dismissal stack for every floating editor surface.
 *
 * Escape must always reach the most recently opened surface, never whichever
 * component happened to mount first. Each surface registers exactly once while
 * it is open, so the registration order is the user's own opening order.
 */

interface DismissalEntry {
  readonly scopeId: string;
  readonly escape: () => void;
}

const stack: DismissalEntry[] = [];
let canvasFallback: (() => boolean) | null = null;
let listenerTarget: Window | null = null;

/** Selectors for overlay libraries that own their own Escape handling. */
const OVERLAY_SELECTOR =
  '[data-radix-popper-content-wrapper],[data-radix-menu-content],[role="menu"],[role="dialog"]';

/**
 * True when a portaled library overlay owns this Escape.
 *
 * Folio's own surfaces carry a dismissal scope and are driven by the stack even
 * when they use an overlay role, so only a library overlay that sits outside
 * every registered surface is allowed to consume the key by itself.
 */
function escapeOwnedByOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const overlay = target.closest(OVERLAY_SELECTOR);
  if (overlay === null) return false;
  const ownSurface = target.closest("[data-floating-widget-scope]");
  return ownSurface === null || !overlay.contains(ownSurface);
}

/** True when the event originates inside a portal explicitly owned by one scope. */
function ownedByScope(target: EventTarget | null, scopeId: string): boolean {
  if (!(target instanceof Element)) return false;
  let candidate: Element | null = target;
  while (candidate !== null) {
    const owners = candidate.getAttribute("data-floating-widget-owner")?.split(/\s+/u) ?? [];
    if (owners.includes(scopeId)) return true;
    candidate = candidate.parentElement;
  }
  return false;
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  // A dropdown, popover, or dialog closes itself first.
  if (escapeOwnedByOverlay(event.target)) return;
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index];
    if (entry === undefined) continue;
    // A surface never dismisses itself because of its own portaled descendant.
    if (ownedByScope(event.target, entry.scopeId)) return;
    event.preventDefault();
    entry.escape();
    return;
  }
  if (canvasFallback === null) return;
  if (canvasFallback()) event.preventDefault();
}

function ensureListener(): void {
  if (listenerTarget !== null || typeof window === "undefined") return;
  listenerTarget = window;
  listenerTarget.addEventListener("keydown", handleEscape);
}

function releaseListener(): void {
  if (listenerTarget === null || stack.length > 0 || canvasFallback !== null) return;
  listenerTarget.removeEventListener("keydown", handleEscape);
  listenerTarget = null;
}

/** Registers one open surface at the top of the stack. Returns its release function. */
export function pushDismissal(scopeId: string, escape: () => void): () => void {
  const entry: DismissalEntry = Object.freeze({ scopeId, escape });
  stack.push(entry);
  ensureListener();
  return () => {
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    releaseListener();
  };
}

/**
 * Registers the canvas-level Escape handler beneath every floating surface.
 *
 * The handler reports whether it consumed the key so an idle canvas leaves
 * Escape untouched for the platform.
 */
export function registerCanvasEscape(handler: () => boolean): () => void {
  canvasFallback = handler;
  ensureListener();
  return () => {
    if (canvasFallback === handler) canvasFallback = null;
    releaseListener();
  };
}

/** Test-only view of the current stack depth and order. */
export function dismissalStackScopes(): readonly string[] {
  return Object.freeze(stack.map(({ scopeId }) => scopeId));
}

/** Test-only reset so suites never leak stack entries between cases. */
export function resetDismissalStack(): void {
  stack.length = 0;
  canvasFallback = null;
  releaseListener();
}
