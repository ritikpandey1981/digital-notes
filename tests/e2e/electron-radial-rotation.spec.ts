import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

/**
 * Dock slots are located by their stable position id, not by their accessible
 * name: that name now describes the brush a slot currently holds and changes
 * the moment one is assigned.
 */
const DOCK_SLOT_IDS: Readonly<Record<string, string>> = {
  Pencil: "pencil",
  Pen: "pen",
  "Brush Pen": "brush-pen",
  Marker: "marker",
  Highlighter: "highlighter",
  Select: "select",
  Eraser: "eraser",
  Shapes: "shapes",
};

test("rotates the radial brush library as one rigid instrument", async () => {
  test.setTimeout(120_000);
  const repositoryRoot = process.cwd();
  const electronApp = await electron.launch({
    args: [path.join(repositoryRoot, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });

  try {
    const window = await electronApp.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });

    const dock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const library = window.getByTestId("radial-brush-library");
    const surface = window.getByTestId("canvas-surface");
    const rail = window.getByTestId("drawing-property-rail");
    const slot = (name: string): Locator =>
      dock.locator(`button[data-dock-slot="${DOCK_SLOT_IDS[name] ?? name}"]`);

    // 1. Shift+Click opens the QA library, unrotated.
    await slot("Brush Pen").click();
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library).toBeVisible();
    await waitForOpen(window);
    await expect(library).toHaveAttribute("data-library-rotation", "0.000");

    const axle = await libraryAxle(window);

    // 2. A clockwise drag turns the wheel, roughly one to one.
    await rotateWheel(window, axle, 55, 12);
    const clockwise = await rotation(library);
    expect(clockwise, "clockwise drag rotates forward").toBeGreaterThan(45);
    expect(clockwise, "roughly one to one").toBeLessThan(65);

    // 3. A deliberate drag that comes to rest before release stops dead.
    await expect(library).toHaveAttribute("data-library-coasting", "false");
    await window.waitForTimeout(400);
    expect(await rotation(library), "no momentum after a settled release").toBeCloseTo(
      clockwise,
      3,
    );

    // 4. A second drag continues from the current rotation.
    await rotateWheel(window, axle, 40, 8);
    const continued = await rotation(library);
    expect(continued, "second drag continues").toBeGreaterThan(clockwise);

    // 5. A counter-clockwise drag turns it back.
    await rotateWheel(window, axle, -50, 10);
    expect(await rotation(library), "counter-clockwise reverses").toBeLessThan(continued);

    // 6. Every ring moves by the same amount: one rigid object.
    const before = await ringAngles(window);
    await rotateWheel(window, axle, 35, 8);
    const after = await ringAngles(window);
    const deltas = after.map((angle, index) => angle - before[index]!);
    for (const delta of deltas) {
      expect(delta, "every ring turns together").toBeCloseTo(deltas[0]!, 1);
    }

    // 7. Propagated channels stay radially aligned through rotation.
    const channels = await window.evaluate(() => {
      const parse = (value: string | null) =>
        (value ?? "")
          .split(" ")
          .filter((entry) => entry.length > 0)
          .map((entry) => Number(entry.split(":")[0]));
      const tracks = [...document.querySelectorAll("[data-library-track]")];
      return {
        innermostGap: parse(tracks[0]!.getAttribute("data-track-blocked"))[0],
        outerBlocked: tracks.map((track) => parse(track.getAttribute("data-track-blocked"))),
      };
    });
    for (const blocked of channels.outerBlocked.slice(1)) {
      const carried = blocked.some((start) => Math.abs(start - channels.innermostGap!) < 0.05);
      expect(carried, "ring 1's channel survives rotation on every outer ring").toBe(true);
    }

    // 8. Icons stay upright: the glyphs are only translated, never rotated.
    const iconTransforms = await window.evaluate(() =>
      [...document.querySelectorAll("[data-brush-item] > g")].map(
        (group) => group.getAttribute("transform") ?? "",
      ),
    );
    expect(iconTransforms.length).toBeGreaterThan(0);
    for (const transform of iconTransforms) {
      expect(transform, "icon is positioned, never rotated").not.toMatch(/rotate/u);
    }

    // 9. Crossing the +/-180 seam must not lurch a whole turn.
    // Grab a cell first, then sweep straight through the +/-180 seam.
    const beforeSeam = await rotation(library);
    // A 200 degree sweep from the right-hand side passes straight through the
    // +/-180 seam where atan2 flips sign.
    await rotateWheel(window, axle, 200, 20);
    const afterSeam = await rotation(library);
    expect(Math.abs(afterSeam - beforeSeam - 200), "seam crossing is smooth").toBeLessThan(15);

    // 10. More than a full turn accumulates without corrupting geometry.
    await rotateWheel(window, axle, 400, 40);
    expect(Math.abs(await rotation(library)), "past a full turn").toBeGreaterThan(300);
    await expect(library.locator("[data-brush-item]")).toHaveCount(45);
    await expect(library).toHaveAttribute("data-library-track-count", "4");
    const finite = await window.evaluate(() =>
      [...document.querySelectorAll("[data-brush-cell]")].every(
        (cell) => !(cell.getAttribute("d") ?? "").match(/NaN|Infinity/u),
      ),
    );
    expect(finite, "geometry stays finite past a full turn").toBe(true);

    // 10b. Spatial fade: the wheel passes under the dock rather than being
    //      clipped by it. Opacity is a function of where a cell currently is.
    const visibility = await window.evaluate(() => {
      const normalize = (value: number) => ((value % 360) + 360) % 360;
      const cells = [...document.querySelectorAll("[data-brush-item]")].map((cell) => {
        const start = Number(cell.getAttribute("data-brush-start-angle"));
        const span = Number(cell.getAttribute("data-brush-cell-angle"));
        return {
          bearing: normalize(start + span / 2),
          span,
          opacity: Number(cell.getAttribute("data-brush-visibility")),
          interactive: getComputedStyle(cell).pointerEvents !== "none",
          track: Number(cell.getAttribute("data-brush-track")),
        };
      });
      // Distance from the hidden direction, which is 180 for a left-hand dock.
      const separation = (bearing: number) => Math.abs(normalize(bearing) - 180);
      return {
        // Well clear of the band, edges included.
        canvasFacing: cells.filter((cell) => separation(cell.bearing) > 90),
        // Entirely inside the hidden core, edges included.
        hidden: cells.filter(
          (cell) =>
            separation(cell.bearing - cell.span / 2) <= 15 &&
            separation(cell.bearing + cell.span / 2) <= 15,
        ),
        band: cells.filter(
          (cell) => separation(cell.bearing) > 22 && separation(cell.bearing) < 38,
        ),
        anyInteractiveWhileInvisible: cells.some(
          (cell) => cell.opacity <= 0.02 && cell.interactive,
        ),
        allInRange: cells.every((cell) => cell.opacity >= 0 && cell.opacity <= 1),
      };
    });
    expect(visibility.allInRange, "opacity stays in range").toBe(true);
    expect(visibility.canvasFacing.length).toBeGreaterThan(0);
    for (const cell of visibility.canvasFacing) {
      expect(cell.opacity, "canvas-facing cells are fully visible").toBe(1);
    }
    // A cell wholly inside the core is gone entirely.
    for (const cell of visibility.hidden) {
      expect(cell.opacity, "cells behind the dock reach zero").toBe(0);
    }
    for (const cell of visibility.band) {
      expect(cell.opacity, "band cells are partly visible").toBeGreaterThan(0);
      expect(cell.opacity, "band cells are not yet full").toBeLessThan(1);
    }
    // A fully faded cell must not quietly collect presses through the dock.
    expect(visibility.anyInteractiveWhileInvisible, "hidden cells are inert").toBe(false);

    // 10c. The dock and rail themselves never fade: they are the foreground.
    const chromeOpacity = await window.evaluate(() => ({
      dock: getComputedStyle(document.querySelector("[data-tool-dock-layout]")!).opacity,
      rail: getComputedStyle(document.querySelector('[data-testid="drawing-property-rail"]')!)
        .opacity,
    }));
    expect(chromeOpacity.dock).toBe("1");
    expect(chromeOpacity.rail).toBe("1");

    // 10d. Fade is spatial, not temporal: no CSS transition may make opacity
    //      trail the pointer during a drag.
    const transitions = await window.evaluate(() =>
      [...document.querySelectorAll("[data-brush-item]")].map((cell) => {
        const style = getComputedStyle(cell);
        return { property: style.transitionProperty, duration: style.transitionDuration };
      }),
    );
    for (const { property, duration } of transitions) {
      // Tailwind's base leaves transition-property: all with a zero duration,
      // which animates nothing. What matters is that opacity never eases: a
      // faded cell must track the pointer exactly, not trail behind it.
      if (/opacity|all/u.test(property)) {
        expect(duration, "opacity is never eased").toBe("0s");
      }
    }

    // 10e. Rotating moves a given cell through the band and out the far side.
    const trackCell = async (): Promise<number> =>
      window.evaluate(() =>
        Number(
          document
            .querySelector('[data-brush-item="fine-marker"]')
            ?.getAttribute("data-brush-visibility") ?? -1,
        ),
      );
    // Stepped in 20 degree increments rather than 45: the hidden core is only
    // 30 degrees wide, so a coarser step can carry a cell clean over it and the
    // sampled minimum would depend on which cell happened to be tracked.
    const opacities: number[] = [await trackCell()];
    for (let step = 0; step < 19; step += 1) {
      await rotateWheel(window, axle, 20, 4);
      opacities.push(await trackCell());
    }
    expect(Math.min(...opacities), "the cell passes behind the dock").toBeLessThan(0.15);
    expect(Math.max(...opacities), "and comes back out").toBeGreaterThan(0.85);

    // 10f. Inertia: a flick keeps the wheel turning after the pointer is gone.
    await waitForStillness(window);
    const beforeFlick = await rotation(library);
    await flickWheel(window, axle, 70, 6);
    const atRelease = await rotation(library);
    // Sampled while the wheel is still coasting, so this is momentum rather
    // than anything the pointer is still doing.
    await expect(library).toHaveAttribute("data-library-coasting", "true");
    const coastingFrom = await rotation(library);
    await window.waitForTimeout(60);
    const midCoast = await rotation(library);
    expect(midCoast, "momentum carries the wheel past the release").toBeGreaterThan(coastingFrom);
    expect(midCoast - beforeFlick, "and continues the direction of the flick").toBeGreaterThan(0);

    // 10g. It slows down rather than running at a constant speed.
    const firstStep = midCoast - coastingFrom;
    await window.waitForTimeout(60);
    const laterStep = (await rotation(library)) - midCoast;
    expect(laterStep, "the coast decelerates").toBeLessThan(firstStep);

    // 10h. And it stops on its own, well short of a runaway spin.
    await waitForStillness(window);
    const settled = await rotation(library);
    await window.waitForTimeout(200);
    expect(await rotation(library), "the coast ends").toBeCloseTo(settled, 3);
    // A flick coasts, but a professional selector never spins: the release cap
    // keeps even the fastest gesture well under a full turn of momentum.
    expect(Math.abs(settled - atRelease), "momentum is restrained").toBeLessThan(180);
    expect(Math.abs(settled - atRelease), "but is real").toBeGreaterThan(1);

    // 10i. A fast flick is capped: far more pointer speed does not buy a spin.
    await waitForStillness(window);
    const beforeFast = await rotation(library);
    await flickWheel(window, axle, 150, 3);
    await waitForStillness(window);
    const fastCoast = Math.abs((await rotation(library)) - beforeFast - 150);
    expect(fastCoast, "even a hard flick stays under a half turn").toBeLessThan(180);

    // 10j. Momentum yields to the hand at once: no tug of war.
    await waitForStillness(window);
    await flickWheel(window, axle, 80, 5);
    await expect(library).toHaveAttribute("data-library-coasting", "true");
    // Press the wheel mid-coast and simply hold: the wheel must stop under the
    // finger rather than continuing to drift beneath it.
    const grab = await grabPointOnWheel(window);
    const grabPoint = {
      x: axle.x + grab.radius * Math.cos((grab.angleDegrees * Math.PI) / 180),
      y: axle.y + grab.radius * Math.sin((grab.angleDegrees * Math.PI) / 180),
    };
    await window.mouse.move(grabPoint.x, grabPoint.y);
    await window.mouse.down();
    await expect(library, "the grab stops the coast at once").toHaveAttribute(
      "data-library-coasting",
      "false",
    );
    const caught = await rotation(library);
    await window.waitForTimeout(150);
    expect(await rotation(library), "and nothing drifts under the finger").toBeCloseTo(caught, 3);
    // Past the drag threshold before releasing: a sub-threshold press and
    // release is a brush selection now, which would close the library. This
    // section is about momentum yielding to the hand, so it ends as a drag.
    await window.mouse.move(grabPoint.x + 12, grabPoint.y + 12);
    await window.mouse.up();

    // 10k. Fade keeps working during a coast, and gaps stay radially aligned.
    await waitForStillness(window);
    await flickWheel(window, axle, 90, 5);
    const duringCoast = await window.evaluate(() => {
      const parse = (value: string | null) =>
        (value ?? "")
          .split(" ")
          .filter((entry) => entry.length > 0)
          .map((entry) => Number(entry.split(":")[0]));
      const cells = [...document.querySelectorAll("[data-brush-item]")];
      const tracks = [...document.querySelectorAll("[data-library-track]")];
      return {
        coasting:
          document
            .querySelector('[data-testid="radial-brush-library"]')
            ?.getAttribute("data-library-coasting") === "true",
        opacities: cells.map((cell) => Number(cell.getAttribute("data-brush-visibility"))),
        anyInteractiveWhileInvisible: cells.some(
          (cell) =>
            Number(cell.getAttribute("data-brush-visibility")) <= 0.02 &&
            getComputedStyle(cell).pointerEvents !== "none",
        ),
        // Icons are translated only, exactly as during a manual drag.
        rotatedIcons: [...document.querySelectorAll("[data-brush-item] > g")].filter((group) =>
          /rotate/u.test(group.getAttribute("transform") ?? ""),
        ).length,
        innermostGap: parse(tracks[0]!.getAttribute("data-track-blocked"))[0],
        outerBlocked: tracks
          .slice(1)
          .map((track) => parse(track.getAttribute("data-track-blocked"))),
        // No temporal easing may creep in for the coast.
        easedOpacity: cells.filter((cell) => {
          const style = getComputedStyle(cell);
          return /opacity|all/u.test(style.transitionProperty) && style.transitionDuration !== "0s";
        }).length,
      };
    });
    expect(duringCoast.coasting, "sampled mid-coast").toBe(true);
    expect(duringCoast.opacities.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(
      duringCoast.opacities.some((value) => value < 0.999),
      "cells fade while coasting",
    ).toBe(true);
    expect(duringCoast.anyInteractiveWhileInvisible, "hidden cells stay inert").toBe(false);
    expect(duringCoast.rotatedIcons, "icons stay upright while coasting").toBe(0);
    expect(duringCoast.easedOpacity, "fade stays spatial during momentum").toBe(0);
    for (const blocked of duringCoast.outerBlocked) {
      const carried = blocked.some((start) => Math.abs(start - duringCoast.innermostGap!) < 0.05);
      expect(carried, "channels stay aligned through momentum").toBe(true);
    }
    await waitForStillness(window);

    // 10l. Closing mid-coast cancels the momentum: reopening starts at rest.
    await flickWheel(window, axle, 90, 5);
    await expect(library).toHaveAttribute("data-library-coasting", "true");
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library, "closing during a coast tears the library down").toHaveCount(0);
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await waitForOpen(window);
    await expect(library).toHaveAttribute("data-library-rotation", "0.000");
    await expect(library, "and it reopens at rest").toHaveAttribute(
      "data-library-coasting",
      "false",
    );

    // 10m. Each utility cancels a coast in flight rather than leaving it running.
    for (const utility of ["Select", "Eraser", "Shapes"] as const) {
      await slot("Brush Pen").click();
      await slot("Brush Pen").click({ modifiers: ["Shift"] });
      await expect(library, `${utility} setup`).toBeVisible();
      await waitForOpen(window);
      const utilityAxle = await libraryAxle(window);
      await flickWheel(window, utilityAxle, 90, 5);
      await expect(library, `${utility} coast started`).toHaveAttribute(
        "data-library-coasting",
        "true",
      );
      await slot(utility).click();
      await expect(library, `${utility} cancels the coast`).toHaveCount(0);
      // Nothing may keep rotating in the background once the wheel is gone.
      await window.waitForTimeout(150);
      await expect(library, `${utility} leaves no library behind`).toHaveCount(0);
    }
    await slot("Brush Pen").click();
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await waitForOpen(window);
    const reopenedAxle = await libraryAxle(window);

    // 10n. Momentum accumulates past a full turn without corrupting geometry.
    await rotateWheel(window, reopenedAxle, 330, 30);
    await flickWheel(window, reopenedAxle, 90, 5);
    await waitForStillness(window);
    expect(Math.abs(await rotation(library)), "past a full turn under momentum").toBeGreaterThan(
      360,
    );
    await expect(library.locator("[data-brush-item]")).toHaveCount(45);
    const finiteAfterCoast = await window.evaluate(() =>
      [...document.querySelectorAll("[data-brush-cell]")].every(
        (cell) => !(cell.getAttribute("d") ?? "").match(/NaN|Infinity/u),
      ),
    );
    expect(finiteAfterCoast, "geometry survives momentum past a turn").toBe(true);

    // 10o. A sub-threshold press is a click, never a tiny fling. It now also
    //      selects the brush it landed on, so the library folds away; what
    //      matters here is that no rotation or momentum came out of it.
    await waitForStillness(window);
    const beforeClick = await rotation(library);
    const clickTarget = await grabPointOnWheel(window);
    const clickPoint = {
      x: axle.x + clickTarget.radius * Math.cos((clickTarget.angleDegrees * Math.PI) / 180),
      y: axle.y + clickTarget.radius * Math.sin((clickTarget.angleDegrees * Math.PI) / 180),
    };
    await window.mouse.move(clickPoint.x, clickPoint.y);
    await window.mouse.down();
    // Inside the 4px threshold, so this never becomes a rotation.
    await window.mouse.move(clickPoint.x + 2, clickPoint.y + 1);
    const duringClick = await rotation(library);
    expect(duringClick, "a click never turns the wheel").toBeCloseTo(beforeClick, 3);
    await window.mouse.up();
    await expect(library, "and selecting folds the library away").toHaveCount(0);

    // 11. None of this touches the document.
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");

    // 12. The approved dock and rail are untouched and still above the library.
    await expect(dock.locator("button[data-dock-slot]")).toHaveCount(8);
    await expect(rail.locator("button[data-property-key]")).toHaveCount(4);

    // 13. Each utility still closes the library.
    for (const utility of ["Select", "Eraser", "Shapes"] as const) {
      await slot("Brush Pen").click();
      await slot("Brush Pen").click({ modifiers: ["Shift"] });
      await expect(library, `${utility} setup`).toBeVisible();
      await waitForOpen(window);
      await slot(utility).click();
      await expect(library, `${utility} closes the library`).toHaveCount(0);
    }

    // 14. Reopening starts from the configured orientation again.
    await slot("Brush Pen").click();
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library).toHaveAttribute("data-library-rotation", "0.000");

    // 15. The normal Tool Options gesture is unaffected by any of it.
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library).toHaveCount(0);
    await slot("Brush Pen").click();
    await expect(window.getByTestId("context-tool-palette")).toBeVisible();
    await window.keyboard.press("Escape");

    // 16. And the canvas still draws once the library is closed.
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const bounds = (await inkCanvas.boundingBox())!;
    await window.mouse.move(bounds.x + 900, bounds.y + 320);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 1040, bounds.y + 380, { steps: 8 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");

    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function rotation(library: Locator): Promise<number> {
  return Number(await library.getAttribute("data-library-rotation"));
}

/** The axle in client coordinates, from the library's reported centre. */
async function libraryAxle(window: Page): Promise<Readonly<{ x: number; y: number }>> {
  return window.evaluate(() => {
    const library = document.querySelector('[data-testid="radial-brush-library"]')!;
    const rect = library.getBoundingClientRect();
    return {
      x: rect.left + Number(library.getAttribute("data-library-center-x")),
      y: rect.top + Number(library.getAttribute("data-library-center-y")),
    };
  });
}

/**
 * Grabs a live brush cell on the right-hand side of the wheel.
 *
 * Queried fresh every time because rotation moves the cells: a hard-coded angle
 * that started on a cell can end up inside a rotated channel. The right-hand
 * side is chosen so the press lands on the wheel rather than on the Tool Dock
 * or Property Rail, which sit above the library.
 */
async function grabPointOnWheel(
  window: Page,
): Promise<Readonly<{ angleDegrees: number; radius: number }>> {
  const grab = await window.evaluate(() => {
    const normalize = (value: number) => ((value % 360) + 360) % 360;
    for (const cell of document.querySelectorAll("[data-brush-item]")) {
      const start = Number(cell.getAttribute("data-brush-start-angle"));
      const span = Number(cell.getAttribute("data-brush-cell-angle"));
      const inner = Number(cell.getAttribute("data-brush-inner-radius"));
      const outer = Number(cell.getAttribute("data-brush-outer-radius"));
      const mid = normalize(start + span / 2);
      if (mid < 40 || mid > 320) {
        return { angleDegrees: mid > 180 ? mid - 360 : mid, radius: (inner + outer) / 2 };
      }
    }
    return null;
  });
  if (grab === null) throw new Error("No brush cell is reachable on the wheel's open side.");
  return grab;
}

/**
 * Presses a real brush cell and sweeps around the axle by a signed amount.
 *
 * Once the pointer is captured the sweep drops to a small radius: the axle sits
 * close to the window's left edge, so a wide sweep would have to travel
 * off-screen to reach the +/-180 seam. Dropping the radius is a purely radial
 * move, which contributes no rotation of its own.
 */
async function rotateWheel(
  window: Page,
  axle: Readonly<{ x: number; y: number }>,
  deltaDegrees: number,
  steps: number,
  sweepRadius = 34,
): Promise<void> {
  await sweepWheel(window, axle, deltaDegrees, steps, sweepRadius, "settle");
}

/**
 * Sweeps and releases the instant the sweep ends, so the release carries speed.
 *
 * The difference from `rotateWheel` is only what happens at the end of the
 * gesture: the sweep itself is identical, because inertia must never change how
 * the wheel behaves while the pointer is down.
 */
async function flickWheel(
  window: Page,
  axle: Readonly<{ x: number; y: number }>,
  deltaDegrees: number,
  steps: number,
  sweepRadius = 34,
): Promise<void> {
  await sweepWheel(window, axle, deltaDegrees, steps, sweepRadius, "fling");
}

async function sweepWheel(
  window: Page,
  axle: Readonly<{ x: number; y: number }>,
  deltaDegrees: number,
  steps: number,
  sweepRadius: number,
  ending: "settle" | "fling",
): Promise<void> {
  const grab = await grabPointOnWheel(window);
  const at = (degrees: number, radius: number) => ({
    x: axle.x + radius * Math.cos((degrees * Math.PI) / 180),
    y: axle.y + radius * Math.sin((degrees * Math.PI) / 180),
  });
  const start = at(grab.angleDegrees, grab.radius);
  await window.mouse.move(start.x, start.y);
  await window.mouse.down();
  // Same angle, smaller radius: no angular delta, so no rotation yet.
  const pivot = at(grab.angleDegrees, sweepRadius);
  await window.mouse.move(pivot.x, pivot.y);
  for (let step = 1; step <= steps; step += 1) {
    const point = at(grab.angleDegrees + (deltaDegrees * step) / steps, sweepRadius);
    await window.mouse.move(point.x, point.y);
  }
  if (ending === "settle") {
    // Come to rest before letting go, the way a deliberate drag ends. The
    // sample window ages out, so the release carries no speed at all.
    await window.waitForTimeout(160);
  }
  await window.mouse.up();
  if (ending === "settle") await waitForStillness(window);
}

/** Waits for the instrument to finish unfolding, so it can be grabbed. */
async function waitForOpen(window: Page): Promise<void> {
  await expect(window.getByTestId("radial-brush-library")).toHaveAttribute(
    "data-library-phase",
    "open",
  );
}

/** Waits for any coast to finish, so a measurement is taken at rest. */
async function waitForStillness(window: Page): Promise<void> {
  await expect(window.getByTestId("radial-brush-library")).toHaveAttribute(
    "data-library-coasting",
    "false",
  );
}

/** The first cell's start angle on each ring, for rigid-body comparison. */
async function ringAngles(window: Page): Promise<readonly number[]> {
  return window.evaluate(() =>
    [...document.querySelectorAll("[data-library-track]")].map((track) =>
      Number(track.querySelector("[data-brush-item]")?.getAttribute("data-brush-start-angle")),
    ),
  );
}
