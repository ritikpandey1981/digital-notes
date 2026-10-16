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
 * This exists to be *looked at*. Nothing here asserts a pixel: what it asserts
 * is that every case drew something and that the console stayed quiet. The
 * decision the sheet exists for is a person's.
 *
 * Three artifacts, which are the three questions:
 *
 * 1. the **sheet**, at the canonical preset's own width, covering every path
 *    shape a nib can be embarrassed by, plus a mouse row and three pen rows;
 * 2. the **detail**, a close crop of two crossing diagonals, where the nib's
 *    edge and the darkening between separate strokes are legible;
 * 3. the **comparison strip**, the same five marks at 8, 12, 14 and 26 page
 *    units, top to bottom. That one is diagnostic: it exists to show what the
 *    chosen width is being chosen *against*, not to reopen the choice.
 *
 * Opt in with `FOLIO_MARKER_SHEET=1`; `MARKER_LABEL` names the run. Sheets land
 * in `test-results/marker/`, which is gitignored.
 */

const REPOSITORY_ROOT = process.cwd();
const LABEL = process.env.MARKER_LABEL ?? "current";
const OUT = "test-results/marker";

/** The canonical preset's own width, and the widths it is compared against. */
const PRESET_WIDTH = 12;
const COMPARISON_WIDTHS = [8, 12, 14, 26] as const;

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

/**
 * Out, around a radius barely wider than the nib, and back alongside itself.
 *
 * The hardest thing to ask of a swept shape: the normal rotates through half a
 * turn in a short distance, which is where a boundary that was computed rather
 * than traced would fold, spike, or leave a hole on the inside of the turn.
 */
function uTurn(from: Point, length: number, radius: number): Point[] {
  const turn = { x: from.x + length, y: from.y + radius };
  return [
    ...straight(from, { x: turn.x, y: from.y }),
    ...arc(turn, radius, -Math.PI / 2, Math.PI / 2, 24).slice(1),
    ...straight({ x: turn.x, y: from.y + radius * 2 }, { x: from.x, y: from.y + radius * 2 }),
  ];
}

/** One stroke that crosses itself twice, without ever retracing its own line. */
function figureEight(centre: Point, rx: number, ry: number, steps = 90): Point[] {
  return Array.from({ length: steps + 1 }, (_unused, index) => {
    const t = (index / steps) * Math.PI * 2;
    return { x: centre.x + Math.sin(t * 2) * rx, y: centre.y + Math.sin(t) * ry };
  });
}

/** Out and back along the same line, in one stroke: the retrace case. */
function retrace(from: Point, to: Point, steps = 20): Point[] {
  return [...straight(from, to, steps), ...straight(to, from, steps).slice(1)];
}

async function setSize(window: Page, size: number): Promise<void> {
  const text = String(size);
  await openSlotToolOptions(window, "marker");
  const palette = window.getByTestId("context-tool-palette");
  const field = palette.getByLabel("Size value");
  await field.fill(text);
  await field.press("Enter");
  await window.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(
    window.getByTestId("drawing-property-rail").locator('button[data-property-key="strokeWidth"]'),
  ).toHaveAttribute("data-property-value", text);
}

/**
 * Picks a zoom from the viewport menu.
 *
 * The detail sheet is drawn at three hundred percent rather than cropped out
 * of the sheet above, because a crop of a twelve-unit mark is a twelve-pixel
 * mark however tightly it is cropped. Zooming also asks the strategy a real
 * question: the committed geometry is rebuilt at the new scale, so if the nib
 * were approximated anywhere this is where the edge would coarsen.
 */
async function setZoom(window: Page, label: string, expected: number): Promise<void> {
  await window.getByRole("button", { name: /^Zoom options,/ }).click();
  await expect(window.getByRole("menu")).toBeVisible();
  await window.getByRole("menuitem", { name: label }).click();
  await expect(window.getByRole("menu")).toHaveCount(0);
  await expect
    .poll(async () =>
      Number(
        await window.getByTestId("viewport-controls").getAttribute("data-viewport-zoom"),
      ).toFixed(2),
    )
    .toBe(expected.toFixed(2));
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
    const readPaper = async () =>
      window.evaluate(() => {
        const element = document.querySelector('[data-testid="canvas-surface"]');
        const read = (name: string): number => Number(element?.getAttribute(name) ?? "0");
        return {
          x: read("data-viewport-page-x"),
          y: read("data-viewport-page-y"),
          width: read("data-viewport-page-width"),
          height: read("data-viewport-page-height"),
        };
      });
    let paper = await readPaper();
    const fitZoom = Number(
      await window.getByTestId("viewport-controls").getAttribute("data-viewport-zoom"),
    );
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
    // Asserted rather than assumed: a layout that ran off the paper would lose
    // cases one at a time, and each loss reads as whichever case came next.
    expect(span.width, "paper is wide enough for the sheet").toBeGreaterThanOrEqual(1000);
    expect(span.height, "paper is tall enough for the sheet").toBeGreaterThanOrEqual(660);

    /** Draws one case and proves it reached the document. */
    let drawn = 0;
    const draw = async (label: string, run: () => Promise<void>): Promise<void> => {
      await run();
      drawn += 1;
      await expect(surface, label).toHaveAttribute("data-document-object-count", String(drawn));
    };

    const clear = async (): Promise<void> => {
      for (let undo = 0; undo < drawn + 2; undo += 1) await window.keyboard.press("Control+z");
      await expect(surface).toHaveAttribute("data-document-object-count", "0");
      drawn = 0;
    };

    // ================ Sheet: the canonical preset, every shape ================
    await setSize(window, PRESET_WIDTH);

    // Taps, which must show the nib rather than a dot.
    for (const [index, x] of [0, 36, 72].entries()) {
      await draw(`tap ${String(index)}`, () => drawMouse(window, [at(x, 20)]));
    }

    // Short, and the four orientations a fixed nib is meant to differ across.
    await draw("short horizontal", () => drawMouse(window, straight(at(130, 20), at(200, 20))));
    await draw("vertical", () => drawMouse(window, straight(at(250, 0), at(250, 120))));
    await draw("diagonal down", () => drawMouse(window, straight(at(300, 0), at(420, 120))));
    await draw("diagonal up", () => drawMouse(window, straight(at(470, 120), at(590, 0))));
    await draw("curve", () => drawMouse(window, arc(at(700, 70), 60, Math.PI, Math.PI * 2)));
    await draw("corner", () =>
      drawMouse(window, [
        ...straight(at(820, 0), at(940, 0)),
        ...straight(at(940, 0), at(940, 120)).slice(1),
      ]),
    );

    // The long run, the hard turns, and the two crossing cases that must not
    // darken: a stroke crossing itself, and a stroke drawn back over itself.
    await draw("long horizontal", () =>
      drawMouse(window, straight(at(0, 170), at(span.width - 20, 185), 40)),
    );
    await draw("u-turn", () => drawMouse(window, uTurn(at(0, 240), 130, 22)));
    await draw("loop", () => drawMouse(window, arc(at(260, 262), 50, 0, Math.PI * 2, 60)));
    await draw("zigzag", () => drawMouse(window, zigzag(at(370, 220), 200, 70, 6)));
    await draw("self-crossing", () => drawMouse(window, figureEight(at(660, 262), 60, 50)));
    await draw("retrace", () => drawMouse(window, retrace(at(800, 250), at(980, 250))));

    // Two separate strokes crossing, which is the one place a Marker is
    // expected to darken, and dense shading, where a stamped brush shows lanes.
    await draw("overlap a", () => drawMouse(window, straight(at(0, 380), at(240, 380))));
    await draw("overlap b", () => drawMouse(window, straight(at(120, 330), at(120, 440))));
    // Eight apart, which at this width is closer than the mark is wide: the
    // rows have to overlap or the case proves nothing. Spaced further, they
    // abut and leave a hairline of paper between them, and the sheet would be
    // measuring its own layout rather than the brush.
    for (let row = 0; row < 9; row += 1) {
      await draw(`shading ${String(row)}`, () =>
        drawMouse(window, straight(at(300, 340 + row * 8), at(560, 340 + row * 8))),
      );
    }

    // Pointer type and pressure, four rows adjacent so they can be compared by
    // eye. `marker-felt` resolves no pressure response, so these four rows are
    // *expected* to be indistinguishable.
    await draw("mouse", () => drawMouse(window, straight(at(0, 500), at(420, 500), 30)));
    for (const [index, pressure] of [0.15, 0.5, 0.95].entries()) {
      await draw(`pen ${String(pressure)}`, () =>
        drawPen(
          session,
          straight(at(0, 535 + index * 35), at(420, 535 + index * 35), 30),
          pressure,
        ),
      );
    }

    // The detail pair: two opposed diagonals crossing, at the preset's width.
    await draw("detail down", () => drawMouse(window, straight(at(520, 500), at(700, 640))));
    await draw("detail up", () => drawMouse(window, straight(at(520, 640), at(700, 500))));

    await window.waitForTimeout(500);
    await window.screenshot({ path: `${OUT}/${LABEL}-sheet-12pu.png` });
    expect(drawn, "every case on the sheet drew").toBe(32);

    // ====================== Detail: the same width, at 300% =====================
    await clear();
    await setZoom(window, "300%", 3);
    paper = await readPaper();
    const detail = { x: 520, y: 360 };
    const near = (x: number, y: number): Point => ({ x: detail.x + x, y: detail.y + y });
    // On paper, asserted: at this zoom the page is larger than the window, so
    // the only way this region is off the sheet is if the view moved.
    expect(paper.x).toBeLessThan(detail.x);
    expect(paper.y).toBeLessThan(detail.y);
    expect(paper.x + paper.width).toBeGreaterThan(detail.x + 460);
    expect(paper.y + paper.height).toBeGreaterThan(detail.y + 200);

    await draw("detail tap", () => drawMouse(window, [near(30, 60)]));
    await draw("detail down", () => drawMouse(window, straight(near(110, 0), near(270, 160))));
    await draw("detail up", () => drawMouse(window, straight(near(110, 160), near(270, 0))));
    await draw("detail horizontal", () =>
      drawMouse(window, straight(near(320, 40), near(450, 40))),
    );
    await draw("detail vertical", () => drawMouse(window, straight(near(400, 90), near(400, 180))));
    await window.waitForTimeout(400);
    await window.screenshot({
      path: `${OUT}/${LABEL}-detail-12pu.png`,
      clip: { x: detail.x - 20, y: detail.y - 30, width: 500, height: 250 },
    });
    expect(drawn, "every detail case drew").toBe(5);

    // ===================== Comparison strip: 8, 12, 14, 26 ====================
    // Diagnostic only. The same five marks per width, top to bottom in the
    // order above, so the chosen width can be seen against its neighbours.
    await clear();
    await setZoom(window, "Fit Page", fitZoom);
    paper = await readPaper();
    for (const [index, width] of COMPARISON_WIDTHS.entries()) {
      const top = index * 160;
      await setSize(window, width);
      await draw(`${String(width)}pu tap`, () => drawMouse(window, [at(10, top + 50)]));
      await draw(`${String(width)}pu horizontal`, () =>
        drawMouse(window, straight(at(70, top + 50), at(300, top + 50))),
      );
      // Exactly forty-five degrees, both of them, because the whole point of
      // the strip is the contrast between drawing along the nib and across it
      // and those are the two directions that reach it. A diagonal that is
      // merely diagonal lands somewhere in between and understates the brush.
      await draw(`${String(width)}pu diagonal down`, () =>
        drawMouse(window, straight(at(360, top), at(470, top + 110))),
      );
      await draw(`${String(width)}pu diagonal up`, () =>
        drawMouse(window, straight(at(530, top + 110), at(640, top))),
      );
      await draw(`${String(width)}pu curve`, () =>
        drawMouse(window, arc(at(760, top + 55), 50, Math.PI, Math.PI * 2)),
      );
    }

    await window.waitForTimeout(500);
    await window.screenshot({ path: `${OUT}/${LABEL}-comparison-8-12-14-26.png` });
    expect(drawn, "every comparison case drew").toBe(COMPARISON_WIDTHS.length * 5);

    expect(consoleErrors, "no console errors while drawing the sheet").toEqual([]);
  } finally {
    await electronApp.close();
  }
});
