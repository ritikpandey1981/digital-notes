import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("preserves Pen pressure silhouettes and Highlighter compositing across commit", async () => {
  test.setTimeout(60_000);
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
    const surface = window.getByTestId("canvas-surface");
    const host = window.getByTestId("canvas-host");
    const baseCanvas = host.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = host.locator("canvas[data-folio-layer='ink']");
    const pageToScreen = await pageCoordinateMapper(baseCanvas, inkCanvas, surface);

    await window.getByRole("button", { name: "Pen", exact: true }).click();
    await window.getByRole("button", { name: "Pen", exact: true }).click();
    const presetTrigger = window.getByRole("button", { name: "Pen preset" });
    await presetTrigger.click();
    await window.locator('[role="menuitemradio"][data-preset-id="pen-brush"]').click();
    await expect(presetTrigger).toHaveAttribute("data-active-preset-id", "pen-brush");
    await setNumericValue(window.getByRole("spinbutton", { name: "Size value" }), "20");
    await window.keyboard.press("Escape");

    const pressureSamples = [
      { ...pageToScreen(110, 120), pressure: 0.1 },
      { ...pageToScreen(170, 120), pressure: 0.3 },
      { ...pageToScreen(230, 120), pressure: 0.6 },
      { ...pageToScreen(290, 120), pressure: 1 },
      { ...pageToScreen(350, 120), pressure: 0.8 },
    ];
    await dispatchPressureStroke(inkCanvas, pressureSamples, false);
    await nextPaint(window);
    const profilePoints = pressureSamples.slice(1, 4);
    const livePressureProfile = await verticalInkSpans(inkCanvas, profilePoints, "alpha");
    expect(livePressureProfile[0]).toBeLessThan(livePressureProfile[1] ?? 0);
    expect(livePressureProfile[1]).toBeLessThan(livePressureProfile[2] ?? 0);

    await dispatchPressureStroke(inkCanvas, pressureSamples, true);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await nextPaint(window);
    const finalPressureProfile = await verticalInkSpans(baseCanvas, profilePoints, "dark");
    finalPressureProfile.forEach((width, index) => {
      expect(Math.abs(width - (livePressureProfile[index] ?? 0))).toBeLessThanOrEqual(2);
    });
    expect(await inkRendererKind(surface, 0)).toBe("outline");
    expect(await inkPointerType(surface, 0)).toBe("pen");

    const committedPressureProfile = finalPressureProfile;
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await nextPaint(window);
    const restoredPressureProfile = await verticalInkSpans(baseCanvas, profilePoints, "dark");
    restoredPressureProfile.forEach((width, index) => {
      expect(Math.abs(width - (committedPressureProfile[index] ?? 0))).toBeLessThanOrEqual(1);
    });

    const viewportZoom = Number(await surface.getAttribute("data-viewport-zoom"));
    const canvasPixelScale = await baseCanvas.evaluate((element) => {
      const target = element as HTMLCanvasElement;
      return target.width / target.getBoundingClientRect().width;
    });
    const nominalMousePixelWidth = 20 * viewportZoom * canvasPixelScale;

    const mouseCases = [
      {
        name: "long curve",
        pagePoints: [
          { x: 90, y: 280 },
          { x: 150, y: 255 },
          { x: 220, y: 245 },
          { x: 290, y: 255 },
          { x: 370, y: 280 },
        ],
        profileIndexes: [2],
      },
      {
        name: "zig-zag",
        pagePoints: [
          { x: 90, y: 350 },
          { x: 145, y: 325 },
          { x: 205, y: 325 },
          { x: 260, y: 350 },
          { x: 330, y: 350 },
        ],
        profileIndexes: [2, 4],
      },
      {
        name: "loop",
        pagePoints: Array.from({ length: 17 }, (_, index) => ({
          x: 230 + Math.cos((index / 16) * Math.PI * 2) * 75,
          y: 435 + Math.sin((index / 16) * Math.PI * 2) * 38,
        })),
        profileIndexes: [4, 12],
      },
      {
        name: "sharp turn",
        pagePoints: [
          { x: 90, y: 525 },
          { x: 170, y: 525 },
          { x: 260, y: 525 },
          { x: 260, y: 590 },
        ],
        profileIndexes: [1],
      },
    ] as const;
    const mouseFinalProfiles: number[][] = [];
    for (const [caseIndex, scenario] of mouseCases.entries()) {
      const screenPoints = scenario.pagePoints.map(({ x, y }) => pageToScreen(x, y));
      const samplePoints = scenario.profileIndexes.map((index) => screenPoints[index]!);
      const start = screenPoints[0]!;
      await window.mouse.move(start.x, start.y);
      await window.mouse.down();
      for (const sample of screenPoints.slice(1)) {
        await window.mouse.move(sample.x, sample.y, { steps: 2 });
      }
      await nextPaint(window);
      await expect(inkCanvas).toHaveAttribute("data-ink-brush-strategy", "centerline");
      const liveProfile = await verticalInkSpans(inkCanvas, samplePoints, "alpha");
      await window.mouse.up();
      await expect(surface).toHaveAttribute("data-document-object-count", String(caseIndex + 2));
      await nextPaint(window);
      const finalProfile = [...(await verticalInkSpans(baseCanvas, samplePoints, "dark"))];
      finalProfile.forEach((width, index) => {
        expect(
          Math.abs(width - nominalMousePixelWidth),
          `${scenario.name} nominal width`,
        ).toBeLessThanOrEqual(2);
        expect(
          Math.abs(width - (liveProfile[index] ?? 0)),
          `${scenario.name} release parity`,
        ).toBeLessThanOrEqual(3);
      });
      expect(await inkRendererKind(surface, caseIndex + 1)).toBe("centerline");
      expect(await inkPointerType(surface, caseIndex + 1)).toBe("mouse");
      mouseFinalProfiles.push(finalProfile);
    }

    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "4");
    await window.keyboard.press("Control+Y");
    await expect(surface).toHaveAttribute("data-document-object-count", "5");
    await nextPaint(window);
    const restoredMouseProfile = await verticalInkSpans(
      baseCanvas,
      [pageToScreen(170, 525)],
      "dark",
    );
    expect(restoredMouseProfile).toEqual(mouseFinalProfiles.at(-1));
    expect(await inkRendererKind(surface, 4)).toBe("centerline");
    expect(await inkPointerType(surface, 4)).toBe("mouse");

    await window.getByRole("button", { name: "Highlighter", exact: true }).click();
    const highlighterStart = pageToScreen(120, 640);
    const highlighterMiddle = pageToScreen(230, 640);
    const highlighterEnd = pageToScreen(340, 640);
    await window.mouse.move(highlighterStart.x, highlighterStart.y);
    await window.mouse.down();
    await window.mouse.move(highlighterEnd.x, highlighterEnd.y, { steps: 6 });
    await nextPaint(window);
    const [liveHighlighterWidth] = await verticalInkSpans(inkCanvas, [highlighterMiddle], "alpha");
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "6");
    const [finalHighlighterWidth] = await verticalInkSpans(
      baseCanvas,
      [highlighterMiddle],
      "yellow",
    );
    expect(
      Math.abs((liveHighlighterWidth ?? 0) - (finalHighlighterWidth ?? 0)),
    ).toBeLessThanOrEqual(2);
    expect(await inkRendererKind(surface, 5)).toBe("centerline");
    expect(await inkPointerType(surface, 5)).toBe("mouse");
    const firstHighlighterPixel = await pixelAt(baseCanvas, highlighterMiddle);

    await window.mouse.move(highlighterStart.x, highlighterStart.y);
    await window.mouse.down();
    await window.mouse.move(highlighterEnd.x, highlighterEnd.y, { steps: 6 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "7");
    const secondHighlighterPixel = await pixelAt(baseCanvas, highlighterMiddle);
    expect(secondHighlighterPixel.blue).toBeLessThan(firstHighlighterPixel.blue - 10);

    await window.getByRole("button", { name: "Eraser", exact: true }).click();
    await window.mouse.click(profilePoints[1]!.x, profilePoints[1]!.y);
    await expect(surface).toHaveAttribute("data-document-object-count", "6");
    await window.keyboard.press("Control+Z");
    await expect(surface).toHaveAttribute("data-document-object-count", "7");
    expect(await inkRendererKind(surface, 0)).toBe("outline");
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function dispatchPressureStroke(
  canvas: Locator,
  samples: readonly PressurePoint[],
  finish: boolean,
): Promise<void> {
  await canvas.evaluate(
    (element, input) => {
      const target = element as HTMLCanvasElement;
      const dispatch = (type: string, sample: PressurePoint, buttons: number) => {
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: sample.x,
            clientY: sample.y,
            pointerId: 71,
            pointerType: "pen",
            isPrimary: true,
            button: 0,
            buttons,
            pressure: sample.pressure,
          }),
        );
      };
      if (!input.finish) {
        const first = input.samples[0];
        if (first === undefined) return;
        const patchedTarget = target as HTMLCanvasElement & {
          __phase17bCapture?: typeof target.setPointerCapture;
          __phase17bRelease?: typeof target.releasePointerCapture;
        };
        patchedTarget.__phase17bCapture = target.setPointerCapture;
        patchedTarget.__phase17bRelease = target.releasePointerCapture;
        target.setPointerCapture = () => undefined;
        target.releasePointerCapture = () => undefined;
        dispatch("pointerdown", first, 1);
        for (const sample of input.samples.slice(1)) dispatch("pointermove", sample, 1);
        return;
      }
      const last = input.samples.at(-1);
      if (last !== undefined) dispatch("pointerup", last, 0);
      const patchedTarget = target as HTMLCanvasElement & {
        __phase17bCapture?: typeof target.setPointerCapture;
        __phase17bRelease?: typeof target.releasePointerCapture;
      };
      if (patchedTarget.__phase17bCapture !== undefined) {
        target.setPointerCapture = patchedTarget.__phase17bCapture;
      }
      if (patchedTarget.__phase17bRelease !== undefined) {
        target.releasePointerCapture = patchedTarget.__phase17bRelease;
      }
    },
    { samples, finish },
  );
}

async function pageCoordinateMapper(
  baseCanvas: Locator,
  inkCanvas: Locator,
  surface: Locator,
): Promise<(x: number, y: number) => Point> {
  await expect(baseCanvas).toBeVisible();
  await expect(inkCanvas).toBeVisible();
  const metrics = await baseCanvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return {
      logicalWidth: Number(canvas.dataset.logicalWidth),
      logicalHeight: Number(canvas.dataset.logicalHeight),
      pageX: Number(canvas.dataset.pageX),
      pageY: Number(canvas.dataset.pageY),
    };
  });
  const bounds = await inkCanvas.boundingBox();
  if (bounds === null) throw new Error("Ink canvas has no visible bounds.");
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  return (x, y) => ({
    x: bounds.x + (metrics.pageX + x * zoom) * (bounds.width / metrics.logicalWidth),
    y: bounds.y + (metrics.pageY + y * zoom) * (bounds.height / metrics.logicalHeight),
  });
}

async function verticalInkSpans(
  canvas: Locator,
  points: readonly Point[],
  mode: "alpha" | "dark" | "yellow",
): Promise<readonly number[]> {
  return canvas.evaluate(
    (element, input) => {
      const target = element as HTMLCanvasElement;
      const context = target.getContext("2d");
      if (context === null) throw new Error("Canvas context is unavailable.");
      const bounds = target.getBoundingClientRect();
      const scaleX = target.width / bounds.width;
      const scaleY = target.height / bounds.height;
      return input.points.map((point) => {
        const x = Math.round((point.x - bounds.left) * scaleX);
        const centerY = Math.round((point.y - bounds.top) * scaleY);
        const radius = Math.ceil(40 * scaleY);
        const startY = Math.max(0, centerY - radius);
        const height = Math.min(target.height - startY, radius * 2 + 1);
        const pixels = context.getImageData(Math.max(0, x - 1), startY, 3, height).data;
        const paintedRows = Array.from({ length: height }, () => false);
        for (let pixel = 0; pixel < pixels.length; pixel += 4) {
          const red = pixels[pixel] ?? 255;
          const green = pixels[pixel + 1] ?? 255;
          const blue = pixels[pixel + 2] ?? 255;
          const alpha = pixels[pixel + 3] ?? 0;
          const painted =
            input.mode === "alpha"
              ? alpha > 24
              : input.mode === "yellow"
                ? red > 180 && green > 160 && blue < 230
                : red < 100 && green < 100 && blue < 100;
          if (!painted) continue;
          const y = Math.floor(pixel / 4 / 3);
          paintedRows[y] = true;
        }
        const localCenter = Math.min(height - 1, Math.max(0, centerY - startY));
        let seed = paintedRows[localCenter] ? localCenter : -1;
        for (let distance = 1; seed < 0 && distance < height; distance += 1) {
          if (paintedRows[localCenter - distance]) seed = localCenter - distance;
          else if (paintedRows[localCenter + distance]) seed = localCenter + distance;
        }
        if (seed < 0) return 0;
        let minimumY = seed;
        let maximumY = seed;
        while (paintedRows[minimumY - 1]) minimumY -= 1;
        while (paintedRows[maximumY + 1]) maximumY += 1;
        return maximumY - minimumY + 1;
      });
    },
    { points, mode },
  );
}

async function pixelAt(canvas: Locator, point: Point): Promise<Pixel> {
  return canvas.evaluate((element, screenPoint) => {
    const target = element as HTMLCanvasElement;
    const context = target.getContext("2d");
    if (context === null) throw new Error("Canvas context is unavailable.");
    const bounds = target.getBoundingClientRect();
    const x = Math.round((screenPoint.x - bounds.left) * (target.width / bounds.width));
    const y = Math.round((screenPoint.y - bounds.top) * (target.height / bounds.height));
    const pixel = context.getImageData(x, y, 1, 1).data;
    return {
      red: pixel[0] ?? 0,
      green: pixel[1] ?? 0,
      blue: pixel[2] ?? 0,
      alpha: pixel[3] ?? 0,
    };
  }, point);
}

async function inkRendererKind(surface: Locator, index: number): Promise<string | undefined> {
  const brushes = JSON.parse(
    (await surface.getAttribute("data-document-stroke-brushes")) ?? "[]",
  ) as Array<{ rendererKind?: string }>;
  return brushes[index]?.rendererKind;
}

async function inkPointerType(surface: Locator, index: number): Promise<string | undefined> {
  const brushes = JSON.parse(
    (await surface.getAttribute("data-document-stroke-brushes")) ?? "[]",
  ) as Array<{ pointerType?: string }>;
  return brushes[index]?.pointerType;
}

async function nextPaint(window: Page): Promise<void> {
  await window.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function setNumericValue(locator: Locator, value: string): Promise<void> {
  await locator.fill(value);
  await locator.press("Enter");
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface PressurePoint extends Point {
  readonly pressure: number;
}

interface Pixel {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}
