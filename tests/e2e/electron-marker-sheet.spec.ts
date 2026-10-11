import path from "node:path";
import { expect, test, _electron as electron, type CDPSession, type Page } from "@playwright/test";
import { activateDockSlot, openSlotToolOptions } from "./dock-helpers";

/**
 * The Marker inspection sheet: what `marker@1` actually looks like.
 *
 * Drawn with the real production renderer through the real slot, preset and
 * input path, at a deterministic set of positions, so two runs of the same
 * build produce the same sheet and two builds can be compared side by side.
 *
 * This exists to be *looked at*. The appearance of `marker@1` is not frozen and
 * nothing here asserts a pixel: what it asserts is that every case drew
 * something and that the console stayed quiet. The decision is a person's.
 *
 * Opt in with `FOLIO_MARKER_SHEET=1`; `MARKER_LABEL` names the run. Sheets land
 * in `test-results/marker/`, which is gitignored.
 */

const REPOSITORY_ROOT = process.cwd();
const LABEL = process.env.MARKER_LABEL ?? "current";
const OUT = "test-results/marker";

async function launch() {
  return electron.launch({
    args: [path.join(REPOSITORY_ROOT, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      REPOSITORY_ROOT,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Draws one path with the mouse, which reports a synthetic constant pressure. */
async function drawMouse(window: Page, points: readonly Point[]): Promise<void> {
  const first = points[0]!;
  await window.mouse.move(first.x, first.y);
  await window.mouse.down();
  for (const point of points.slice(1)) await window.mouse.move(point.x, point.y, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(40);
}

/**
 * Draws one path with a pen at a chosen pressure.
 *
 * Through the devtools input domain rather than a synthesised `PointerEvent`,
 * because the editor takes pointer capture and a hand-built event has no
 * pointer for it to capture -- the stroke never starts. This produces a real
 * trusted pen event carrying real pressure, which is the same path a stylus
 * takes into the application.
 *
 * Worth knowing while reading the sheet: `marker-felt` resolves **no** pressure
 * response, so these rows are expected to look identical to each other and to
 * the mouse row. That is the design under review, not a bug in the sheet.
 */
async function drawPen(
  session: CDPSession,
  points: readonly Point[],
  pressure: number,
): Promise<void> {
  const send = async (
    type: "mousePressed" | "mouseMoved" | "mouseReleased",
    at: Point,
    force: number,
    buttons: number,
  ): Promise<void> => {
    await session.send("Input.dispatchMouseEvent", {
      type,
      x: at.x,
      y: at.y,
      button: "left",
      buttons,
      force,
      pointerType: "pen",
      clickCount: 1,
    } as never);
  };
  await send("mousePressed", points[0]!, pressure, 1);
  for (const point of points.slice(1)) await send("mouseMoved", point, pressure, 1);
  await send("mouseReleased", points[points.length - 1]!, 0, 0);
}

function straight(from: Point, to: Point, steps = 16): Point[] {
  return Array.from({ length: steps + 1 }, (_unused, index) => ({
    x: from.x + ((to.x - from.x) * index) / steps,
    y: from.y + ((to.y - from.y) * index) / steps,
  }));
}

function arc(centre: Point, radius: number, from: number, to: number, steps = 40): Point[] {
  return Array.from({ length: steps + 1 }, (_unused, index) => {
    const angle = from + ((to - from) * index) / steps;
    return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
  });
}

function zigzag(start: Point, width: number, height: number, legs: number): Point[] {
  const points: Point[] = [];
  for (let leg = 0; leg <= legs; leg += 1) {
    points.push({
      x: start.x + (width * leg) / legs,
      y: start.y + (leg % 2 === 0 ? 0 : height),
    });
  }
  return points;
}

async function setSize(window: Page, size: string): Promise<void> {
  await openSlotToolOptions(window, "marker");
  const palette = window.getByTestId("context-tool-palette");
  const field = palette.getByLabel("Size value");
  await field.fill(size);
  await field.press("Enter");
  await window.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(
    window.getByTestId("drawing-property-rail").locator('button[data-property-key="strokeWidth"]'),
  ).toHaveAttribute("data-property-value", size);
}

test("draws the Marker inspection sheet", async () => {
  test.skip(
    process.env.FOLIO_MARKER_SHEET !== "1",
    "Set FOLIO_MARKER_SHEET=1 to regenerate the Marker inspection sheet.",
  );
  test.setTimeout(900_000);
  const electronApp = await launch();
  try {
    const window = await electronApp.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1600, height: 1000 });
    const surface = window.getByTestId("canvas-surface");

    await activateDockSlot(window, "marker");
    await expect(surface).toHaveAttribute("data-drawing-preset-id", "marker-felt");

    // Laid out against the paper rather than the window. A stroke wholly
    // outside the paper is unreachable artwork and the editor refuses it, so a
    // sheet positioned in viewport coordinates silently loses its left column.
    const session = await electronApp.context().newCDPSession(window);
    const paper = await window.evaluate(() => {
      const element = document.querySelector('[data-testid="canvas-surface"]');
      const read = (name: string): number => Number(element?.getAttribute(name) ?? "0");
      return {
        x: read("data-viewport-page-x"),
        y: read("data-viewport-page-y"),
        width: read("data-viewport-page-width"),
        height: read("data-viewport-page-height"),
      };
    });
    expect(paper.width).toBeGreaterThan(400);
    const MARGIN = 40;
    // The top of the paper sits under the window chrome, and a press that lands
    // on chrome is not a press on the canvas: the first run of this sheet lost
    // its top row that way and reported it as the *next* case failing. Starting
    // the layout clear of it is the fix; the sheet has the room.
    const TOP = 150;
    const at = (x: number, y: number): Point => ({
      x: paper.x + MARGIN + x,
      y: paper.y + TOP + y,
    });
    const span = { width: paper.width - MARGIN * 2, height: paper.height - TOP - MARGIN };

    /** Draws one case and proves it reached the document. */
    let drawn = 0;
    const draw = async (label: string, run: () => Promise<void>): Promise<void> => {
      await run();
      drawn += 1;
      await expect(surface, label).toHaveAttribute("data-document-object-count", String(drawn));
    };

    // ---- Sheet one: the default preset width, every path shape. ----
    await setSize(window, "8");

    // Taps, which must show the nib rather than a dot.
    for (const [index, x] of [0, 40, 80].entries()) {
      await draw(`tap ${String(index)}`, () => drawMouse(window, [at(x, 10)]));
    }

    // The four orientations the fixed nib is meant to differ across.
    await draw("horizontal", () => drawMouse(window, straight(at(150, 10), at(350, 10))));
    await draw("vertical", () => drawMouse(window, straight(at(400, 0), at(400, 120))));
    await draw("diagonal down", () => drawMouse(window, straight(at(450, 0), at(580, 120))));
    await draw("diagonal up", () => drawMouse(window, straight(at(640, 120), at(770, 0))));

    // Short and long runs.
    await draw("short", () => drawMouse(window, straight(at(0, 170), at(60, 170))));
    await draw("long", () => drawMouse(window, straight(at(0, 210), at(span.width - 20, 230), 40)));

    // Curves, a tight turn, a loop, a zigzag.
    await draw("arc", () => drawMouse(window, arc(at(110, 350), 90, Math.PI, Math.PI * 2)));
    await draw("tight turn", () =>
      drawMouse(window, [
        ...straight(at(260, 290), at(400, 290)),
        ...straight(at(400, 290), at(400, 420)).slice(1),
      ]),
    );
    await draw("loop", () => drawMouse(window, arc(at(540, 350), 60, 0, Math.PI * 2, 60)));
    await draw("zigzag", () => drawMouse(window, zigzag(at(670, 300), 220, 90, 7)));

    // Crossings, and separate overlapping strokes: the one place a Marker is
    // expected to darken.
    await draw("cross a", () => drawMouse(window, straight(at(20, 530), at(300, 530))));
    await draw("cross b", () => drawMouse(window, straight(at(160, 470), at(160, 600))));
    await draw("cross c", () => drawMouse(window, straight(at(60, 590), at(280, 490))));

    // Dense shading, which is where a stamped brush would show its lanes.
    for (let row = 0; row < 7; row += 1) {
      await draw(`shading ${String(row)}`, () =>
        drawMouse(window, straight(at(400, 490 + row * 11), at(640, 490 + row * 11))),
      );
    }

    await window.waitForTimeout(500);
    await window.screenshot({ path: `${OUT}/${LABEL}-sheet-default-8pu.png` });
    expect(drawn, "every default-width case drew").toBe(23);

    // ---- Sheet two: pressure, by pointer type, at a broader width. ----
    for (let undo = 0; undo < drawn + 2; undo += 1) {
      await window.keyboard.press("Control+z");
    }
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    drawn = 0;
    await setSize(window, "26");

    await draw("mouse broad", () => drawMouse(window, straight(at(0, 40), at(420, 40), 30)));
    for (const [index, pressure] of [0.15, 0.5, 0.95].entries()) {
      await draw(`pen ${String(pressure)}`, () =>
        drawPen(
          session,
          straight(at(0, 130 + index * 90), at(420, 130 + index * 90), 30),
          pressure,
        ),
      );
    }
    // A broad nib through a tight turn and a loop, where a swept shape is most
    // likely to fold or spike.
    await draw("broad arc", () =>
      drawPen(session, arc(at(700, 220), 110, Math.PI * 0.75, Math.PI * 2.1, 70), 0.7),
    );
    await draw("broad zigzag", () => drawPen(session, zigzag(at(880, 60), 180, 120, 6), 0.7));
    await draw("broad tap", () => drawPen(session, [at(980, 400)], 0.8));
    await draw("broad down", () => drawPen(session, straight(at(0, 480), at(500, 620), 30), 0.6));
    await draw("broad up", () => drawPen(session, straight(at(0, 620), at(500, 480), 30), 0.6));

    await window.waitForTimeout(500);
    await window.screenshot({ path: `${OUT}/${LABEL}-sheet-broad-26pu.png` });
    expect(drawn, "every broad-width case drew").toBe(9);

    // A close look at the two broad diagonals, where the nib's edge is most
    // legible and where a chisel should read differently in each direction.
    await window.screenshot({
      path: `${OUT}/${LABEL}-detail-broad-diagonals.png`,
      clip: {
        x: at(0, 450).x,
        y: at(0, 450).y,
        width: 540,
        height: 220,
      },
    });

    expect(consoleErrors, "no console errors while drawing the sheet").toEqual([]);
  } finally {
    await electronApp.close();
  }
});
