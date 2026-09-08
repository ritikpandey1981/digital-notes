import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

interface PolarPoint {
  readonly x: number;
  readonly y: number;
  readonly angleDegrees: number;
  readonly radius: number;
}

test("owns complete ring material while preserving the first outside canvas gesture", async () => {
  test.setTimeout(150_000);
  const repositoryRoot = process.cwd();
  const app = await electron.launch({
    args: [path.join(repositoryRoot, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });

  try {
    const window = await app.firstWindow();
    const consoleErrors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await window.setViewportSize({ width: 1440, height: 900 });

    const library = window.getByTestId("radial-brush-library");
    const rotator = window.getByTestId("radial-brush-library-rotator");
    const slot = window.locator('button[data-dock-slot="pencil"]');
    const surface = window.getByTestId("canvas-surface");
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const selectedBrush = async () =>
      library.locator('[data-brush-selected="true"]').getAttribute("data-brush-item");

    // Opening/closing remain inert; only a settled instrument owns pointers.
    await slot.click();
    await slot.click();
    await expect(library.locator('[data-testid="radial-ring-interaction"]')).toHaveCount(4);
    await expect(library).toHaveAttribute("data-library-phase", "opening");
    for (const annulus of await library.locator('[data-testid="radial-ring-interaction"]').all()) {
      await expect(annulus).toHaveAttribute("pointer-events", "none");
    }
    await waitForOpen(library);

    const annuli = library.locator('[data-testid="radial-ring-interaction"]');
    await expect(annuli).toHaveCount(4);
    expect(
      await annuli.evaluateAll((paths) =>
        paths.map((element) => [
          Number(element.getAttribute("data-ring-inner-radius")),
          Number(element.getAttribute("data-ring-outer-radius")),
        ]),
      ),
    ).toEqual([
      [90, 154],
      [154, 218],
      [218, 282],
      [282, 346],
    ]);
    await expect(
      library.locator("[data-brush-item]"),
      "visible catalogue geometry is intact",
    ).toHaveCount(45);
    for (const annulus of await annuli.all()) {
      await expect(annulus).toHaveAttribute("pointer-events", "all");
      await expect(annulus).not.toHaveAttribute("data-brush-item", /.+/u);
    }

    // Rotate the initially dock-side Ring 1 direct channel into visible space.
    await rotateFromReachableCell(window, 170);
    const beforeSelection = await selectedBrush();
    const beforeObjects = await numericAttribute(surface, "data-document-object-count");
    const beforeHistory = await numericAttribute(surface, "data-history-undo-depth");

    // Direct gap: a sub-threshold release is a complete no-op.
    let directGap = await directGapPoint(window, 0);
    await expectInteractionTarget(window, directGap, 0);
    const beforeDirectClick = await rotation(library);
    await subThresholdPress(window, directGap);
    expect(await rotation(library)).toBe(beforeDirectClick);
    expect(await selectedBrush()).toBe(beforeSelection);
    await expect(library).toHaveAttribute("data-library-phase", "open");

    // The same direct gap feeds the existing rotation threshold and pipeline.
    directGap = await directGapPoint(window, 0);
    const beforeDirectDrag = await rotation(library);
    await dragAroundAxle(window, directGap, 24, "settle");
    expect(await rotation(library)).toBeGreaterThan(beforeDirectDrag + 15);
    expect(await selectedBrush()).toBe(beforeSelection);

    // Ring 1's direct gap is inherited by Ring 2 at the same current angle.
    const propagatedGap = await directGapPoint(window, 1, 0);
    await expectInteractionTarget(window, propagatedGap, 1);
    const beforePropagated = await rotation(library);
    await dragAroundAxle(window, propagatedGap, -18, "settle");
    expect(await rotation(library)).toBeLessThan(beforePropagated - 3);
    expect(await selectedBrush()).toBe(beforeSelection);

    // Ring 4 has a large unused allowed remainder because it carries only the
    // catalogue overflow. Both click and drag semantics remain radial there.
    let unusedGap = await widestAnnulusPoint(window, 3);
    await expectInteractionTarget(window, unusedGap, 3);
    const beforeUnusedClick = await rotation(library);
    await subThresholdPress(window, unusedGap);
    expect(await rotation(library)).toBe(beforeUnusedClick);
    unusedGap = await widestAnnulusPoint(window, 3);
    await dragAroundAxle(window, unusedGap, 20, "settle");
    expect(await rotation(library)).toBeGreaterThan(beforeUnusedClick + 12);

    // Recompute after rotation: the new screen-space gap still resolves to the
    // same complete annulus, guarding against fixed initial hit patches.
    const rotatedGap = await widestAnnulusPoint(window, 3);
    await expectInteractionTarget(window, rotatedGap, 3);
    await dragAroundAxle(window, rotatedGap, -14, "settle");
    expect(await selectedBrush()).toBe(beforeSelection);

    expect(await numericAttribute(surface, "data-document-object-count")).toBe(beforeObjects);
    expect(await numericAttribute(surface, "data-history-undo-depth")).toBe(beforeHistory);

    // A fast gap-origin release uses the unchanged inertia machinery. Pressing
    // another empty region stops that coast immediately and remains a no-op.
    unusedGap = await widestAnnulusPoint(window, 3);
    await dragAroundAxle(window, unusedGap, 38, "fling");
    await expect(library).toHaveAttribute("data-library-coasting", "true");
    unusedGap = await widestAnnulusPoint(window, 3);
    await window.mouse.move(unusedGap.x, unusedGap.y);
    await window.mouse.down();
    await expect(library).toHaveAttribute("data-library-coasting", "false");
    await expect(library).toHaveAttribute("data-library-dragging", "true");
    await window.mouse.up();
    await expect(library).toHaveAttribute("data-library-dragging", "false");
    expect(await selectedBrush()).toBe(beforeSelection);

    // The foreground Property Rail wins even where its colour control lies over
    // Ring 1 interaction geometry.
    await window
      .getByTestId("drawing-property-rail")
      .locator('button[data-property-key="strokeColor"]')
      .click();
    await expect(window.getByTestId("full-color-picker")).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(window.getByTestId("full-color-picker")).toHaveCount(0);

    // Start another coast, then press well beyond r=346 on the real ink canvas.
    // The outside observer cancels momentum and requests close without consuming
    // the pointerdown; that very pointer becomes one normal drawing command.
    unusedGap = await widestAnnulusPoint(window, 3);
    await dragAroundAxle(window, unusedGap, 38, "fling");
    await expect(library).toHaveAttribute("data-library-coasting", "true");
    const outside = await outsideCanvasPoint(window, inkCanvas, surface);
    await window.mouse.move(outside.x, outside.y);
    await window.mouse.down();
    await expect(library).toHaveAttribute("data-library-phase", "closing");
    await expect(library).toHaveAttribute("data-library-coasting", "false");
    expect(await numericAttribute(surface, "data-history-undo-depth")).toBe(beforeHistory);
    await window.mouse.move(outside.x + 90, outside.y + 28, { steps: 8 });
    await window.mouse.up();
    await expect(library).toHaveCount(0);
    expect(await numericAttribute(surface, "data-document-object-count")).toBe(beforeObjects + 1);
    expect(await numericAttribute(surface, "data-history-undo-depth")).toBe(beforeHistory + 1);

    // Escape uses the shared dismissal stack, folds through the approved phase,
    // restores the invoking slot, and creates no History.
    await openLibrary(window, slot, library);
    const historyBeforeEscape = await numericAttribute(surface, "data-history-undo-depth");
    await window.keyboard.press("Escape");
    await expect(library).toHaveAttribute("data-library-phase", "closing");
    for (const annulus of await annuli.all()) {
      await expect(annulus).toHaveAttribute("pointer-events", "none");
    }
    await expect(library).toHaveCount(0);
    await expect(slot).toBeFocused();
    expect(await numericAttribute(surface, "data-history-undo-depth")).toBe(historyBeforeEscape);

    // Unexpected capture loss, pointer cancellation, and window blur all clear
    // the same drag state without selection; a subsequent drag still works.
    await openLibrary(window, slot, library);
    const selectionBeforeRecovery = await selectedBrush();
    await beginGapPress(window);
    await dispatchPointerLifecycle(window, rotator, "lostpointercapture");
    await expect(library).toHaveAttribute("data-library-dragging", "false");
    await window.mouse.up();
    expect(await selectedBrush()).toBe(selectionBeforeRecovery);

    const beforeRecoveredDrag = await rotation(library);
    const recoveredGap = await widestAnnulusPoint(window, 3);
    await dragAroundAxle(window, recoveredGap, 18, "settle");
    expect(await rotation(library)).toBeGreaterThan(beforeRecoveredDrag + 10);

    await beginGapPress(window);
    await dispatchPointerLifecycle(window, rotator, "pointercancel");
    await expect(library).toHaveAttribute("data-library-dragging", "false");
    await window.mouse.up();
    expect(await selectedBrush()).toBe(selectionBeforeRecovery);

    await beginGapPress(window);
    await window.evaluate(() => globalThis.dispatchEvent(new Event("blur")));
    await expect(library).toHaveAttribute("data-library-dragging", "false");
    await expect(library).toHaveAttribute("data-library-coasting", "false");
    await window.mouse.up();
    expect(await selectedBrush()).toBe(selectionBeforeRecovery);

    // The event-transparent outside policy also preserves the existing Space
    // pan authority: the same pointer closes the wheel and moves the viewport,
    // with no stroke and no History entry.
    const cameraBeforePan = await surface.getAttribute("data-viewport-camera-x");
    const objectsBeforePan = await numericAttribute(surface, "data-document-object-count");
    const historyBeforePan = await numericAttribute(surface, "data-history-undo-depth");
    const panStart = await outsideCanvasPoint(window, inkCanvas, surface);
    await window.keyboard.down("Space");
    await window.mouse.move(panStart.x, panStart.y);
    await window.mouse.down();
    await expect(library).toHaveAttribute("data-library-phase", "closing");
    await window.mouse.move(panStart.x + 100, panStart.y, { steps: 8 });
    await window.mouse.up();
    await window.keyboard.up("Space");
    await expect(library).toHaveCount(0);
    expect(await surface.getAttribute("data-viewport-camera-x")).not.toBe(cameraBeforePan);
    expect(await numericAttribute(surface, "data-document-object-count")).toBe(objectsBeforePan);
    expect(await numericAttribute(surface, "data-history-undo-depth")).toBe(historyBeforePan);

    await expect(window.getByTestId("tool-options-affordance")).toHaveCount(0);
    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

async function waitForOpen(library: Locator): Promise<void> {
  await expect(library).toHaveAttribute("data-library-phase", "open");
}

async function openLibrary(window: Page, slot: Locator, library: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await slot.click();
    await expect
      .poll(async () =>
        (await library.count()) === 0
          ? "closed"
          : ((await library.getAttribute("data-library-phase")) ?? "closed"),
      )
      .toMatch(/^(open|closed)$/u);
    if ((await library.count()) > 0) return;
  }
  throw new Error("The Brush Library never opened.");
}

async function numericAttribute(locator: Locator, name: string): Promise<number> {
  return Number(await locator.getAttribute(name));
}

async function rotation(library: Locator): Promise<number> {
  return numericAttribute(library, "data-library-rotation");
}

async function axle(window: Page): Promise<Readonly<{ x: number; y: number }>> {
  return window.evaluate(() => {
    const library = document.querySelector('[data-testid="radial-brush-library"]')!;
    const rect = library.getBoundingClientRect();
    return {
      x: rect.left + Number(library.getAttribute("data-library-center-x")),
      y: rect.top + Number(library.getAttribute("data-library-center-y")),
    };
  });
}

function polarPoint(
  center: Readonly<{ x: number; y: number }>,
  angleDegrees: number,
  radius: number,
): PolarPoint {
  return {
    x: center.x + radius * Math.cos((angleDegrees * Math.PI) / 180),
    y: center.y + radius * Math.sin((angleDegrees * Math.PI) / 180),
    angleDegrees,
    radius,
  };
}

async function directGapPoint(window: Page, trackIndex: number, sourceTrack = trackIndex) {
  const gap = await window.evaluate((index) => {
    const track = document.querySelector(`[data-library-track="${index}"]`)!;
    const [start, width] = (track.getAttribute("data-track-direct-gap") ?? "0:0")
      .split(":")
      .map(Number);
    return { angleDegrees: start! + width! / 2 };
  }, sourceTrack);
  const center = await axle(window);
  return polarPoint(center, gap.angleDegrees, 122 + trackIndex * 64);
}

async function widestAnnulusPoint(window: Page, trackIndex: number): Promise<PolarPoint> {
  const center = await axle(window);
  const radius = 122 + trackIndex * 64;
  const candidates = await window.evaluate(
    ({ center, radius, trackIndex }) => {
      const hits: number[] = [];
      for (let angle = -80; angle <= 80; angle += 1) {
        const x = center.x + radius * Math.cos((angle * Math.PI) / 180);
        const y = center.y + radius * Math.sin((angle * Math.PI) / 180);
        const target = document.elementFromPoint(x, y);
        if (target?.closest(`[data-ring-interaction="${trackIndex}"]`) instanceof Element) {
          hits.push(angle);
        }
      }
      return hits;
    },
    { center, radius, trackIndex },
  );
  if (candidates.length === 0) throw new Error(`No empty area found in ring ${trackIndex + 1}.`);
  let longest: number[] = [];
  let run: number[] = [];
  for (const angle of candidates) {
    if (run.length === 0 || angle === run.at(-1)! + 1) run.push(angle);
    else {
      if (run.length > longest.length) longest = run;
      run = [angle];
    }
  }
  if (run.length > longest.length) longest = run;
  const angleDegrees = longest[Math.floor(longest.length / 2)]!;
  return polarPoint(center, angleDegrees, radius);
}

async function expectInteractionTarget(
  window: Page,
  point: PolarPoint,
  trackIndex: number,
): Promise<void> {
  expect(
    await window.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return {
        ring: target?.closest("[data-ring-interaction]")?.getAttribute("data-ring-interaction"),
        brush: target?.closest("[data-brush-item]")?.getAttribute("data-brush-item") ?? null,
      };
    }, point),
  ).toEqual({ ring: String(trackIndex), brush: null });
}

async function subThresholdPress(window: Page, point: PolarPoint): Promise<void> {
  const center = await axle(window);
  const subThresholdDegrees = (1.5 / point.radius) * (180 / Math.PI);
  const end = polarPoint(center, point.angleDegrees + subThresholdDegrees, point.radius);
  await window.mouse.move(point.x, point.y);
  await window.mouse.down();
  await window.mouse.move(end.x, end.y);
  await window.mouse.up();
}

async function dragAroundAxle(
  window: Page,
  point: PolarPoint,
  deltaDegrees: number,
  ending: "settle" | "fling",
): Promise<void> {
  const center = await axle(window);
  await window.mouse.move(point.x, point.y);
  await window.mouse.down();
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    const next = polarPoint(
      center,
      point.angleDegrees + (deltaDegrees * step) / steps,
      point.radius,
    );
    await window.mouse.move(next.x, next.y);
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

async function rotateFromReachableCell(window: Page, deltaDegrees: number): Promise<void> {
  const center = await axle(window);
  const cell = await window.evaluate(() => {
    for (const candidate of document.querySelectorAll("[data-brush-item]")) {
      if (getComputedStyle(candidate).pointerEvents === "none") continue;
      const start = Number(candidate.getAttribute("data-brush-start-angle"));
      const span = Number(candidate.getAttribute("data-brush-cell-angle"));
      const angleDegrees = ((start + span / 2 + 180) % 360) - 180;
      if (Math.abs(angleDegrees) < 60) {
        return {
          angleDegrees,
          radius:
            (Number(candidate.getAttribute("data-brush-inner-radius")) +
              Number(candidate.getAttribute("data-brush-outer-radius"))) /
            2,
        };
      }
    }
    return null;
  });
  if (cell === null) throw new Error("No reachable brush cell found.");
  await dragAroundAxle(
    window,
    polarPoint(center, cell.angleDegrees, cell.radius),
    deltaDegrees,
    "settle",
  );
}

async function outsideCanvasPoint(window: Page, inkCanvas: Locator, surface: Locator) {
  const box = (await inkCanvas.boundingBox())!;
  const center = await axle(window);
  const metrics = await surface.evaluate((element) => ({
    pageX: Number((element as HTMLElement).dataset.viewportPageX),
    pageY: Number((element as HTMLElement).dataset.viewportPageY),
    pageWidth: Number((element as HTMLElement).dataset.viewportPageWidth),
    pageHeight: Number((element as HTMLElement).dataset.viewportPageHeight),
    zoom: Number((element as HTMLElement).dataset.viewportZoom),
    viewportWidth: Number((element as HTMLElement).dataset.viewportWidth),
    viewportHeight: Number((element as HTMLElement).dataset.viewportHeight),
  }));
  const pageToScreen = (x: number, y: number) => ({
    x: box.x + (metrics.pageX + x * metrics.zoom) * (box.width / metrics.viewportWidth),
    y: box.y + (metrics.pageY + y * metrics.zoom) * (box.height / metrics.viewportHeight),
  });
  const candidates = [
    pageToScreen(metrics.pageWidth * 0.62, metrics.pageHeight * 0.5),
    pageToScreen(metrics.pageWidth * 0.55, metrics.pageHeight * 0.65),
  ];
  const point = candidates.find(
    (candidate) => Math.hypot(candidate.x - center.x, candidate.y - center.y) > 400,
  );
  if (point === undefined) throw new Error("No canvas point is clearly outside the wheel.");
  return point;
}

async function beginGapPress(window: Page): Promise<void> {
  const point = await widestAnnulusPoint(window, 3);
  await window.mouse.move(point.x, point.y);
  await window.mouse.down();
  await expect(window.getByTestId("radial-brush-library")).toHaveAttribute(
    "data-library-dragging",
    "true",
  );
}

async function dispatchPointerLifecycle(
  window: Page,
  rotator: Locator,
  type: "lostpointercapture" | "pointercancel",
): Promise<void> {
  const pointerId = Number(
    await window.getByTestId("radial-brush-library").getAttribute("data-library-pointer-id"),
  );
  await rotator.dispatchEvent(type, { pointerId, bubbles: true });
}
