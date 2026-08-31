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

test("unfolds the radial brush library from its slot and collapses back into it", async () => {
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

    await slot("Brush Pen").click();
    const slotBoxBefore = (await slot("Brush Pen").boundingBox())!;
    const dockBoxBefore = (await dock.boundingBox())!;
    const railBoxBefore = (await rail.boundingBox())!;

    // 1. Opening begins as an unfolding, not as a finished wheel appearing.
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library).toBeVisible();
    const firstFrames = await sampleWhileOpening(window);
    expect(firstFrames.length, "the open is observable, not instant").toBeGreaterThan(0);
    const earliest = firstFrames[0]!;
    expect(earliest.phase).toBe("opening");
    expect(earliest.progress, "caught early in the unfolding").toBeLessThan(1);

    // 2. Ring 1 establishes ahead of ring 4 the whole way out.
    for (const frame of firstFrames) {
      for (let ring = 1; ring < frame.expansions.length; ring += 1) {
        expect(
          frame.expansions[ring - 1]!,
          `ring ${ring} never overtakes ring ${ring - 1} at ${frame.progress}`,
        ).toBeGreaterThanOrEqual(frame.expansions[ring]! - 1e-9);
      }
    }
    const staggered = firstFrames.filter(
      (frame) => frame.expansions[0]! > frame.expansions[frame.expansions.length - 1]!,
    );
    expect(staggered.length, "the inner ring genuinely leads").toBeGreaterThan(0);

    // 2b. Circumferential unfurl: a ring does NOT arrive as a complete circle.
    //     Early frames must show some of its cells still untouched by the front.
    const partialRings = firstFrames.filter((frame) => frame.revealCounts[0]![2] > 0);
    expect(partialRings.length, "ring 1 is drawn around, not switched on").toBeGreaterThan(0);
    const feathering = firstFrames.filter((frame) =>
      frame.revealCounts.some((counts) => counts[1] > 0),
    );
    expect(feathering.length, "the front has a soft edge, not a hard cut").toBeGreaterThan(0);

    // 2c. The sweep runs the same way on every ring, starting from the dock.
    //     Bearings are measured clockwise from 180 (the hidden dock direction),
    //     so an uncovered set must always be a prefix of that travel.
    for (const frame of firstFrames) {
      const travelled = frame.ringOneUncoveredBearings
        .map((bearing) => (bearing - 180 + 360) % 360)
        .sort((first, second) => first - second);
      if (travelled.length === 0 || travelled.length === frame.revealCounts[0]![0]) continue;
      expect(travelled[0]!, "the sweep starts at the dock side").toBeLessThan(90);
    }

    // 2d. Radial growth and angular sweep happen together, not one then the other.
    const together = firstFrames.filter(
      (frame) =>
        frame.expansions[0]! > 0 &&
        frame.expansions[0]! < 1 &&
        frame.angulars[0]! > 0 &&
        frame.angulars[0]! < 1,
    );
    expect(together.length, "ring 1 grows while it is being drawn").toBeGreaterThan(0);

    // 3. Rings grow outward from the hub rather than scaling as one flat object.
    const growing = firstFrames.filter((frame) => frame.outermostRadius > 0);
    expect(growing.length).toBeGreaterThan(0);
    for (const frame of growing) {
      expect(frame.minInnerRadius, "nothing starts inside the hub").toBeGreaterThanOrEqual(89.9);
      expect(frame.anyInverted, "no sector is ever inverted").toBe(false);
    }

    // 4. It settles on exactly the frozen geometry.
    await waitForOpen(window);
    const settled = await readGeometry(window);
    expect(settled.trackCount).toBe(4);
    expect(settled.cellCount).toBe(45);
    expect(settled.radii, "final radii are the approved ones").toEqual([
      [90, 154],
      [154, 218],
      [218, 282],
      [282, 346],
    ]);
    for (const expansion of settled.expansions) expect(expansion).toBe(1);
    const settledFrame = (await window.evaluate(frameScript))!;
    for (const counts of settledFrame.revealCounts) {
      expect(counts[1], "nothing left mid-feather").toBe(0);
      expect(counts[2], "nothing left uncovered").toBe(0);
    }
    expect(settledFrame.angulars.every((value) => value === 1)).toBe(true);

    // 5. The slot, the dock and the rail never moved.
    expect(await slot("Brush Pen").boundingBox()).toEqual(slotBoxBefore);
    expect(await dock.boundingBox()).toEqual(dockBoxBefore);
    expect(await rail.boundingBox()).toEqual(railBoxBefore);

    // 6. The wheel is centred on that stationary slot.
    const axle = await libraryAxle(window);
    expect(axle.x, "axle sits on the slot").toBeCloseTo(
      slotBoxBefore.x + slotBoxBefore.width / 2,
      0,
    );
    expect(axle.y).toBeCloseTo(slotBoxBefore.y + slotBoxBefore.height / 2, 0);

    // 7. Icons stayed upright and channels stayed aligned throughout.
    expect(
      firstFrames.every((frame) => frame.rotatedIcons === 0),
      "icons upright",
    ).toBe(true);
    for (const frame of firstFrames) {
      for (const blocked of frame.outerBlocked) {
        const carried = blocked.some((start) => Math.abs(start - frame.innermostGap) < 0.05);
        expect(carried, `channels aligned at ${frame.progress}`).toBe(true);
      }
    }

    // 8. Rotation and inertia work normally once it has opened.
    await rotateWheel(window, axle, 50, 10);
    const rotated = Number(await library.getAttribute("data-library-rotation"));
    expect(rotated, "rotation still works after opening").toBeGreaterThan(40);
    await flickWheel(window, axle, 80, 5);
    await expect(library, "inertia still works after opening").toHaveAttribute(
      "data-library-coasting",
      "true",
    );

    // 9. Closing mid-coast cancels the momentum immediately.
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library, "the coast is dropped as the collapse starts").toHaveAttribute(
      "data-library-coasting",
      "false",
    );

    // 10. The surface stays mounted while it collapses, and the collapse
    //     reverses the depth: the outer structure withdraws first.
    const closingFrames = await sampleWhileClosing(window);
    expect(closingFrames.length, "the close is observable too").toBeGreaterThan(0);
    for (const frame of closingFrames) {
      expect(frame.phase).toBe("closing");
      for (let ring = 1; ring < frame.expansions.length; ring += 1) {
        expect(
          frame.expansions[ring - 1]!,
          `ring ${ring} leaves before ring ${ring - 1}`,
        ).toBeGreaterThanOrEqual(frame.expansions[ring]! - 1e-9);
      }
      expect(frame.anyInverted).toBe(false);
    }
    const retracting = closingFrames.filter(
      (frame) => frame.expansions[frame.expansions.length - 1]! < frame.expansions[0]!,
    );
    expect(retracting.length, "the outer ring genuinely leads the retreat").toBeGreaterThan(0);
    // The collapse reels the cells back in as well as pulling them home: some
    // frame must show a ring with cells already withdrawn behind the front.
    const unrevealing = closingFrames.filter((frame) =>
      frame.revealCounts.some((counts) => counts[2] > 0),
    );
    expect(unrevealing.length, "cells are withdrawn circumferentially too").toBeGreaterThan(0);
    for (const frame of closingFrames) {
      for (let ring = 1; ring < frame.angulars.length; ring += 1) {
        expect(
          frame.angulars[ring - 1]!,
          `ring ${ring} unreveals before ring ${ring - 1}`,
        ).toBeGreaterThanOrEqual(frame.angulars[ring]! - 1e-9);
      }
    }
    // Rotation is kept during the collapse rather than snapping back to zero.
    expect(closingFrames[0]!.rotation, "no rotation jump on close").not.toBe(0);

    // 11. And then it unmounts.
    await expect(library, "the surface is torn down once collapsed").toHaveCount(0);

    // 12. Reopening starts from rest at the frozen orientation.
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await waitForOpen(window);
    await expect(library).toHaveAttribute("data-library-rotation", "0.000");
    await expect(library).toHaveAttribute("data-library-coasting", "false");

    // 13. Rapid open -> close turns round from wherever it had reached: it
    //     never completes the open first, never remounts at zero, and every
    //     ring keeps following one shared curve across the turn.
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library).toHaveCount(0);
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    const reversal = await reverseMidFlight(window, () =>
      slot("Brush Pen").click({ modifiers: ["Shift"] }),
    );
    expect(
      reversal.some((frame) => frame.phase === "opening"),
      "caught the open",
    ).toBe(true);
    expect(
      reversal.some((frame) => frame.phase === "closing"),
      "and the close",
    ).toBe(true);
    expect(
      reversal.some((frame) => frame.phase === "open"),
      "it never sat fully open on the way round",
    ).toBe(false);
    expect(
      Math.max(...reversal.map((frame) => frame.progress)),
      "and never reached a complete wheel",
    ).toBeLessThan(1);
    expect(reversal.every((frame) => !frame.anyInverted)).toBe(true);
    expectExpansionFollowsProgressOnly(reversal);
    await expect(library).toHaveCount(0);

    // 14. Rapid close -> open likewise: interrupting a collapse brings the
    //     instrument back out from where it had got to.
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await waitForOpen(window);
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    const backOpen: MotionFrame[] = [];
    let reopened = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const frame = await window.evaluate(frameScript);
      if (frame === null) break;
      backOpen.push(frame);
      if (!reopened && frame.phase === "closing" && frame.progress < 0.85) {
        await slot("Brush Pen").click({ modifiers: ["Shift"] });
        reopened = true;
      }
      if (reopened && frame.phase === "open") break;
    }
    expect(reopened, "caught the close mid-flight").toBe(true);
    expect(backOpen.some((frame) => frame.phase === "closing")).toBe(true);
    expect(
      backOpen.some((frame) => frame.phase === "opening"),
      "it came back out",
    ).toBe(true);
    expect(backOpen.every((frame) => !frame.anyInverted)).toBe(true);
    expectExpansionFollowsProgressOnly(backOpen);
    await waitForOpen(window);

    // 15. Each utility still closes it safely, collapse and all.
    for (const utility of ["Select", "Eraser", "Shapes"] as const) {
      await slot("Brush Pen").click();
      await slot("Brush Pen").click({ modifiers: ["Shift"] });
      await waitForOpen(window);
      await slot(utility).click();
      await expect(library, `${utility} closes the library`).toHaveCount(0);
    }

    // 16. The normal Tool Options gesture is untouched: the first press makes
    //     the slot active, the second opens Tool Options rather than the wheel.
    await slot("Brush Pen").click();
    await slot("Brush Pen").click();
    await expect(window.getByTestId("context-tool-palette")).toBeVisible();
    await expect(library, "a plain second press is not the library").toHaveCount(0);
    await window.keyboard.press("Escape");

    // 17. Reduced motion gets the instrument with no unfolding at all.
    await window.emulateMedia({ reducedMotion: "reduce" });
    await slot("Brush Pen").click();
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library).toHaveAttribute("data-library-motion-preset", "reduced");
    await expect(library, "it is simply there").toHaveAttribute("data-library-phase", "open");
    await expect(library).toHaveAttribute("data-library-open-progress", "1.000");
    const reducedGeometry = await readGeometry(window);
    expect(reducedGeometry.radii, "at its final geometry immediately").toEqual(settled.radii);
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library, "and gone immediately").toHaveCount(0);
    await window.emulateMedia({ reducedMotion: "no-preference" });

    // 18. Minimum window: it opens, closes, and stays usable.
    await window.setViewportSize({ width: 960, height: 640 });
    await slot("Brush Pen").click();
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await waitForOpen(window);
    const smallGeometry = await readGeometry(window);
    expect(smallGeometry.radii, "geometry is unchanged by the window").toEqual(settled.radii);
    const smallAxle = await libraryAxle(window);
    await rotateWheel(window, smallAxle, 40, 8);
    expect(
      Number(await library.getAttribute("data-library-rotation")),
      "still rotates at the minimum size",
    ).toBeGreaterThan(25);
    await slot("Brush Pen").click({ modifiers: ["Shift"] });
    await expect(library).toHaveCount(0);
    await expect(dock.locator("button[data-dock-slot]")).toHaveCount(8);
    await expect(rail.locator("button[data-property-key]")).toHaveCount(4);
    await window.setViewportSize({ width: 1440, height: 900 });

    // 19. None of it touched the document, and the canvas still draws.
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
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

interface MotionFrame {
  readonly phase: string;
  readonly progress: number;
  readonly rotation: number;
  readonly expansions: readonly number[];
  readonly angulars: readonly number[];
  /** Per-ring counts of cells fully uncovered / partly uncovered / untouched. */
  readonly revealCounts: readonly (readonly [number, number, number])[];
  /** Bearings of the cells this ring has fully uncovered, in screen degrees. */
  readonly ringOneUncoveredBearings: readonly number[];
  readonly minInnerRadius: number;
  readonly outermostRadius: number;
  readonly anyInverted: boolean;
  readonly rotatedIcons: number;
  readonly innermostGap: number;
  readonly outerBlocked: readonly (readonly number[])[];
}

/** Reads one frame of the unfolding straight out of the live DOM. */
function frameScript(): MotionFrame | null {
  const library = document.querySelector('[data-testid="radial-brush-library"]');
  if (library === null) return null;
  const parse = (value: string | null) =>
    (value ?? "")
      .split(" ")
      .filter((entry) => entry.length > 0)
      .map((entry) => Number(entry.split(":")[0]));
  const tracks = [...document.querySelectorAll("[data-library-track]")];
  const cells = [...document.querySelectorAll("[data-brush-item]")];
  const inner = cells.map((cell) => Number(cell.getAttribute("data-brush-inner-radius")));
  const outer = cells.map((cell) => Number(cell.getAttribute("data-brush-outer-radius")));
  return {
    phase: library.getAttribute("data-library-phase") ?? "",
    progress: Number(library.getAttribute("data-library-open-progress")),
    rotation: Number(library.getAttribute("data-library-rotation")),
    expansions: tracks.map((track) => Number(track.getAttribute("data-track-expansion"))),
    angulars: tracks.map((track) => Number(track.getAttribute("data-track-angular"))),
    revealCounts: tracks.map((track) => {
      const own = [...track.querySelectorAll("[data-brush-item]")].map((cell) =>
        Number(cell.getAttribute("data-brush-circumferential")),
      );
      return [
        own.filter((value) => value >= 0.999).length,
        own.filter((value) => value > 0.001 && value < 0.999).length,
        own.filter((value) => value <= 0.001).length,
      ] as [number, number, number];
    }),
    ringOneUncoveredBearings: [...(tracks[0]?.querySelectorAll("[data-brush-item]") ?? [])]
      .filter((cell) => Number(cell.getAttribute("data-brush-circumferential")) >= 0.999)
      .map((cell) => {
        const start = Number(cell.getAttribute("data-brush-start-angle"));
        const span = Number(cell.getAttribute("data-brush-cell-angle"));
        return (((start + span / 2) % 360) + 360) % 360;
      }),
    minInnerRadius: inner.length === 0 ? 0 : Math.min(...inner),
    outermostRadius: outer.length === 0 ? 0 : Math.max(...outer),
    anyInverted: cells.some((_cell, index) => inner[index]! > outer[index]! + 1e-6),
    rotatedIcons: [...document.querySelectorAll("[data-brush-item] > g")].filter((group) =>
      /rotate/u.test(group.getAttribute("transform") ?? ""),
    ).length,
    innermostGap: parse(tracks[0]?.getAttribute("data-track-blocked") ?? "")[0] ?? 0,
    outerBlocked: tracks.slice(1).map((track) => parse(track.getAttribute("data-track-blocked"))),
  };
}

/** Collects frames until the given phase ends. */
async function sampleWhilePhase(window: Page, phase: string): Promise<MotionFrame[]> {
  const frames: MotionFrame[] = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const frame = await window.evaluate(frameScript);
    if (frame === null) break;
    if (frame.phase !== phase) {
      if (frames.length > 0) break;
      continue;
    }
    frames.push(frame);
  }
  return frames;
}

async function sampleWhileOpening(window: Page): Promise<MotionFrame[]> {
  return sampleWhilePhase(window, "opening");
}

async function sampleWhileClosing(window: Page): Promise<MotionFrame[]> {
  return sampleWhilePhase(window, "closing");
}

/**
 * Interrupts an in-flight unfolding, sampling continuously across the turn.
 *
 * Comparing single frames either side of the click would measure Playwright's
 * own dispatch latency rather than the animation: the unfolding legitimately
 * advances while the click is being delivered. What can be established from the
 * live window is the property that makes a reversal safe — that a ring's size
 * depends only on how far the unfolding has got, never on which way it is
 * going. A stream of samples spanning the turn shows that directly.
 */
async function reverseMidFlight(
  window: Page,
  interrupt: () => Promise<void>,
): Promise<MotionFrame[]> {
  const frames: MotionFrame[] = [];
  let interrupted: Promise<void> | null = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const frame = await window.evaluate(frameScript);
    if (frame === null) break;
    frames.push(frame);
    // Turn round once it is genuinely mid-flight, and keep sampling through it.
    if (interrupted === null && frame.progress > 0.1 && frame.phase === "opening") {
      interrupted = interrupt();
    }
    if (interrupted !== null && frame.phase === "closing" && frame.progress < 0.1) break;
  }
  if (interrupted === null) throw new Error("Never caught the library mid-flight.");
  await interrupted;
  return frames;
}

/**
 * Asserts a ring's expansion is a function of progress alone.
 *
 * Any two samples at the same progress must agree, and a higher progress must
 * never be smaller. A second, oppositely-staggered closing choreography would
 * fail this immediately.
 */
function expectExpansionFollowsProgressOnly(frames: readonly MotionFrame[]): void {
  const ringCount = frames[0]?.expansions.length ?? 0;
  expect(ringCount).toBeGreaterThan(0);
  for (let ring = 0; ring < ringCount; ring += 1) {
    const points = frames
      .map((frame) => ({ progress: frame.progress, expansion: frame.expansions[ring]! }))
      .sort((first, second) => first.progress - second.progress);
    for (let index = 1; index < points.length; index += 1) {
      expect(
        points[index]!.expansion,
        `ring ${ring} at progress ${points[index]!.progress} vs ${points[index - 1]!.progress}`,
      ).toBeGreaterThanOrEqual(points[index - 1]!.expansion - 1e-6);
    }
  }
}

async function readGeometry(window: Page): Promise<{
  trackCount: number;
  cellCount: number;
  radii: number[][];
  expansions: number[];
}> {
  return window.evaluate(() => {
    const tracks = [...document.querySelectorAll("[data-library-track]")];
    return {
      trackCount: tracks.length,
      cellCount: document.querySelectorAll("[data-brush-item]").length,
      radii: tracks.map((track) => {
        const cell = track.querySelector("[data-brush-item]")!;
        return [
          Number(cell.getAttribute("data-brush-inner-radius")),
          Number(cell.getAttribute("data-brush-outer-radius")),
        ];
      }),
      expansions: tracks.map((track) => Number(track.getAttribute("data-track-expansion"))),
      angulars: tracks.map((track) => Number(track.getAttribute("data-track-angular"))),
      revealCounts: tracks.map((track) => {
        const own = [...track.querySelectorAll("[data-brush-item]")].map((cell) =>
          Number(cell.getAttribute("data-brush-circumferential")),
        );
        return [
          own.filter((value) => value >= 0.999).length,
          own.filter((value) => value > 0.001 && value < 0.999).length,
          own.filter((value) => value <= 0.001).length,
        ] as [number, number, number];
      }),
      ringOneUncoveredBearings: [...(tracks[0]?.querySelectorAll("[data-brush-item]") ?? [])]
        .filter((cell) => Number(cell.getAttribute("data-brush-circumferential")) >= 0.999)
        .map((cell) => {
          const start = Number(cell.getAttribute("data-brush-start-angle"));
          const span = Number(cell.getAttribute("data-brush-cell-angle"));
          return (((start + span / 2) % 360) + 360) % 360;
        }),
    };
  });
}

async function waitForOpen(window: Page): Promise<void> {
  await expect(window.getByTestId("radial-brush-library")).toHaveAttribute(
    "data-library-phase",
    "open",
  );
}

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

async function rotateWheel(
  window: Page,
  axle: Readonly<{ x: number; y: number }>,
  deltaDegrees: number,
  steps: number,
): Promise<void> {
  await sweepWheel(window, axle, deltaDegrees, steps, "settle");
}

async function flickWheel(
  window: Page,
  axle: Readonly<{ x: number; y: number }>,
  deltaDegrees: number,
  steps: number,
): Promise<void> {
  await sweepWheel(window, axle, deltaDegrees, steps, "fling");
}

async function sweepWheel(
  window: Page,
  axle: Readonly<{ x: number; y: number }>,
  deltaDegrees: number,
  steps: number,
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
  const pivot = at(grab.angleDegrees, 34);
  await window.mouse.move(pivot.x, pivot.y);
  for (let step = 1; step <= steps; step += 1) {
    await window.mouse.move(
      at(grab.angleDegrees + (deltaDegrees * step) / steps, 34).x,
      at(grab.angleDegrees + (deltaDegrees * step) / steps, 34).y,
    );
  }
  if (ending === "settle") await window.waitForTimeout(160);
  await window.mouse.up();
  if (ending === "settle") {
    await expect(window.getByTestId("radial-brush-library")).toHaveAttribute(
      "data-library-coasting",
      "false",
    );
  }
}
