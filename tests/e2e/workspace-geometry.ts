import type { Page } from "@playwright/test";

/**
 * Where a gesture actually lands.
 *
 * Specs that drive the editor by page or workspace coordinates were written
 * against one window size, and a coordinate that was clear of the tool options
 * palette or the workspace chrome at that size is not clear of it at another.
 * Rather than trading one hard-coded coordinate for another, these ask the
 * running app what is under a point and move until the answer is the canvas.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Screen-space step used when searching for an unobstructed position. */
const SEARCH_STEP_PIXELS = 24;
/** Enough steps to cross any workspace surface at a supported window size. */
const SEARCH_LIMIT = 40;

/**
 * The topmost interesting things at a screen point, outermost last.
 *
 * Returns test ids where a surface has one and tag names otherwise, which is
 * all a caller needs to tell "the drawing canvas" from "a panel over it".
 */
export async function hitTargetsAt(window: Page, point: Point): Promise<readonly string[]> {
  return window.evaluate(
    (at: { x: number; y: number }) =>
      document
        .elementsFromPoint(at.x, at.y)
        .map((element) => {
          const node = element as HTMLElement;
          return node.dataset.testid ?? node.dataset.folioLayer ?? node.tagName;
        })
        .slice(0, 6),
    point,
  );
}

/**
 * True when a press at this screen point reaches the drawing canvas.
 *
 * The topmost element has to belong to the canvas surface itself -- its layer
 * canvases count, a panel that happens to sit over it does not.
 */
export async function reachesCanvas(window: Page, point: Point): Promise<boolean> {
  return window.evaluate((at: { x: number; y: number }) => {
    const top = document.elementsFromPoint(at.x, at.y)[0];
    return top?.closest('[data-testid="canvas-surface"]') !== null && top !== undefined;
  }, point);
}

/**
 * Moves a set of page points clear of whatever currently covers the canvas.
 *
 * The whole constellation travels together by one derived offset, so every
 * relationship the spec depends on -- strokes that must cross, an eraser that
 * must pass over them -- survives the move. Points that already reach the
 * canvas are returned unchanged.
 */
export async function clearOfWorkspaceSurfaces(
  window: Page,
  pageToScreen: (x: number, y: number) => Point,
  points: readonly Point[],
): Promise<readonly Point[]> {
  const zoom = await pageZoom(window);
  for (let step = 0; step <= SEARCH_LIMIT; step += 1) {
    const offset = (step * SEARCH_STEP_PIXELS) / zoom;
    const moved = points.map((point) => ({ x: point.x + offset, y: point.y }));
    const screen = moved.map((point) => pageToScreen(point.x, point.y));
    const reachable = await Promise.all(screen.map((point) => reachesCanvas(window, point)));
    if (reachable.every(Boolean)) return Object.freeze(moved);
  }
  throw new Error("No unobstructed page position was found for this gesture.");
}

/** One page point that reaches the canvas, searching rightwards from `from`. */
export async function clearPagePoint(
  window: Page,
  pageToScreen: (x: number, y: number) => Point,
  from: Point,
): Promise<Point> {
  const [point] = await clearOfWorkspaceSurfaces(window, pageToScreen, [from]);
  if (point === undefined) throw new Error("No unobstructed page point was produced.");
  return point;
}

/**
 * A workspace point beside the page that belongs to no control.
 *
 * This is the "press empty workspace" target: a press there dismisses whatever
 * is open and, being off the page, cannot start a stroke or a selection. Specs
 * used to reach for a corner of the workspace box, which was surround when the
 * workspace began below a toolbar and is chrome now that it reaches the top of
 * the window -- so ask the running app where the surround actually is.
 */
export async function findEmptyWorkspacePoint(window: Page): Promise<Point> {
  const host = await window.getByTestId("canvas-host").boundingBox();
  if (host === null) throw new Error("The canvas host has no visible bounds.");
  const page = await window.getByTestId("canvas-surface").evaluate((node) => {
    const set = (node as HTMLElement).dataset;
    return {
      x: Number(set.viewportPageX),
      y: Number(set.viewportPageY),
      width: Number(set.viewportPageWidth),
      height: Number(set.viewportPageHeight),
    };
  });
  // Beside the page where the window is wider than the page, and above or
  // below it where the page fills the width instead.
  const columns = [page.x - SEARCH_STEP_PIXELS, page.x + page.width + SEARCH_STEP_PIXELS];
  const rows = [page.y - SEARCH_STEP_PIXELS, page.y + page.height + SEARCH_STEP_PIXELS];
  const candidates: Point[] = [];
  for (const x of columns) {
    for (let step = 1; step <= SEARCH_LIMIT; step += 1) {
      candidates.push({ x, y: step * SEARCH_STEP_PIXELS });
    }
  }
  for (const y of rows) {
    for (let step = 1; step <= SEARCH_LIMIT; step += 1) {
      candidates.push({ x: step * SEARCH_STEP_PIXELS, y });
    }
  }
  for (const local of candidates) {
    if (local.x < 0 || local.x > host.width || local.y < 0 || local.y > host.height) continue;
    const overPage =
      local.x >= page.x &&
      local.x <= page.x + page.width &&
      local.y >= page.y &&
      local.y <= page.y + page.height;
    if (overPage) continue;
    const candidate = { x: host.x + local.x, y: host.y + local.y };
    // Nothing may be stacked over the workspace here: the press has to reach
    // the surround rather than a control that happens to sit on it.
    if (await reachesCanvas(window, candidate)) return candidate;
  }
  throw new Error("No empty workspace point was found.");
}

async function pageZoom(window: Page): Promise<number> {
  const zoom = Number(
    await window.getByTestId("canvas-surface").getAttribute("data-viewport-zoom"),
  );
  if (!Number.isFinite(zoom) || zoom <= 0) throw new Error("The viewport zoom is unavailable.");
  return zoom;
}
