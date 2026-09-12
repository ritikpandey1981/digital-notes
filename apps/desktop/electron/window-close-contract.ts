export const WINDOW_CLOSE_REQUEST_CHANNEL = "folio:window:close-request";
export const WINDOW_CLOSE_DECISION_CHANNEL = "folio:window:close-decision";

/**
 * One close question main asked, identified so a stale answer cannot close a
 * window the user has since decided to keep.
 */
export interface WindowCloseDecision {
  readonly requestId: number;
  readonly allow: boolean;
}

export type WindowCloseDecisionResult = Readonly<{ status: "accepted" | "ignored" }>;

/**
 * The renderer's whole window authority: it may answer a close question main
 * asked, and nothing else. It cannot open, close, move, or inspect a window on
 * its own.
 */
export interface DesktopWindowClosePort {
  readonly onCloseRequest: (handler: (requestId: number) => void) => () => void;
  readonly respondToCloseRequest: (
    decision: WindowCloseDecision,
  ) => Promise<WindowCloseDecisionResult>;
}

export function isWindowCloseDecision(value: unknown): value is WindowCloseDecision {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<WindowCloseDecision>;
  return Number.isSafeInteger(candidate.requestId) && typeof candidate.allow === "boolean";
}
