/**
 * Captures real Folio product screenshots for the GENESIS EIR pitch deck.
 *
 * This script is deck tooling. It launches the already-built Electron app,
 * draws with normal pointer input through the real drawing pipeline, and saves
 * PNGs into ./assets. It does not modify any product code.
 *
 * Prerequisite: `pnpm build` at the repository root.
 * Run:          node docs/genesis-eir-pitch/capture-screenshots.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "..", "..");
const assetsDirectory = path.join(here, "assets");

const VIEWPORT = { width: 1600, height: 1000 };

fs.mkdirSync(assetsDirectory, { recursive: true });

/** Slight hand wobble so captured strokes read as sketching, not vector geometry. */
function humanise(points, amplitude = 1.4) {
  return points.map((point, index) => {
    const phase = index / Math.max(1, points.length - 1);
    return {
      x: point.x + Math.sin(phase * Math.PI * 3.1) * amplitude,
      y: point.y + Math.cos(phase * Math.PI * 2.3) * amplitude,
    };
  });
}

/** Samples a straight run between two page-space points. */
function segment(from, to, steps = 26) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  });
}

/** Point on the ray from `origin` toward `vanishing`, at the given x. */
function towardVanishingPoint(origin, vanishing, x) {
  const t = (x - origin.x) / (vanishing.x - origin.x);
  return { x, y: origin.y + (vanishing.y - origin.y) * t };
}

/** Intersection of line a1->a2 with line b1->b2. */
function intersection(a1, a2, b1, b2) {
  const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  const p = a1.x * a2.y - a1.y * a2.x;
  const q = b1.x * b2.y - b1.y * b2.x;
  return {
    x: (p * (b1.x - b2.x) - (a1.x - a2.x) * q) / d,
    y: (p * (b1.y - b2.y) - (a1.y - a2.y) * q) / d,
  };
}

async function main() {
  const electronApp = await electron.launch({
    args: [path.join(repositoryRoot, "apps/desktop/dist-electron/main.js")],
    executablePath: path.join(
      repositoryRoot,
      "apps/desktop/node_modules/electron/dist/electron.exe",
    ),
  });

  try {
    const window = await electronApp.firstWindow();
    await window.setViewportSize(VIEWPORT);
    const host = window.getByTestId("canvas-host");
    const surface = window.getByTestId("canvas-surface");
    const baseCanvas = host.locator("canvas[data-folio-renderer='true']");
    const inkCanvas = host.locator("canvas[data-folio-layer='ink']");

    await baseCanvas.waitFor({ state: "visible" });
    await inkCanvas.waitFor({ state: "visible" });
    await window.waitForTimeout(700);

    const metrics = await baseCanvas.evaluate((element) => ({
      logicalWidth: Number(element.dataset.logicalWidth),
      logicalHeight: Number(element.dataset.logicalHeight),
      pageX: Number(element.dataset.pageX),
      pageY: Number(element.dataset.pageY),
      pageWidth: Number(element.dataset.pageWidth),
      pageHeight: Number(element.dataset.pageHeight),
    }));
    const bounds = await inkCanvas.boundingBox();
    const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
    const scaleX = bounds.width / metrics.logicalWidth;
    const scaleY = bounds.height / metrics.logicalHeight;
    const pageWidth = metrics.pageWidth / zoom;
    const pageHeight = metrics.pageHeight / zoom;
    console.log("page:", pageWidth.toFixed(0), "x", pageHeight.toFixed(0), "zoom:", zoom);

    const pageToScreen = (x, y) => ({
      x: bounds.x + (metrics.pageX + x * zoom) * scaleX,
      y: bounds.y + (metrics.pageY + y * zoom) * scaleY,
    });

    async function drawPath(points) {
      const first = points[0];
      await window.mouse.move(...Object.values(pageToScreen(first.x, first.y)));
      await window.mouse.down();
      for (const point of points.slice(1)) {
        const screen = pageToScreen(point.x, point.y);
        await window.mouse.move(screen.x, screen.y);
      }
      await window.mouse.up();
      await window.waitForTimeout(60);
    }

    async function selectSlot(slotId) {
      const button = window.locator(`button[data-dock-slot="${slotId}"]`);
      if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
      await window.waitForTimeout(180);
    }

    // ---- two-point perspective study -------------------------------------
    const horizonY = pageHeight * 0.24;
    const vpLeft = { x: -pageWidth * 0.34, y: horizonY };
    const vpRight = { x: pageWidth * 1.34, y: horizonY };

    const frontX = pageWidth * 0.47;
    const leftX = pageWidth * 0.235;
    const rightX = pageWidth * 0.7;
    const frontTop = { x: frontX, y: pageHeight * 0.45 };
    const frontBottom = { x: frontX, y: pageHeight * 0.79 };

    const leftTop = towardVanishingPoint(frontTop, vpLeft, leftX);
    const leftBottom = towardVanishingPoint(frontBottom, vpLeft, leftX);
    const rightTopCorrect = towardVanishingPoint(frontTop, vpRight, rightX);
    const rightBottom = towardVanishingPoint(frontBottom, vpRight, rightX);
    // Deliberately drawn with a shallow top-right edge: a real beginner error,
    // and the geometry the deck's illustrative feedback callout refers to.
    const rightTop = { x: rightX, y: rightTopCorrect.y - pageHeight * 0.045 };
    // The back corner follows the correct construction; only the drawn
    // top-right edge deviates, which is the error the deck annotates.
    const backTop = intersection(leftTop, vpRight, rightTopCorrect, vpLeft);

    // Construction pass: horizon plus two convergence guides, drawn in pencil.
    await selectSlot("pencil");
    await drawPath(
      humanise(
        segment({ x: pageWidth * 0.07, y: horizonY }, { x: pageWidth * 0.93, y: horizonY }, 40),
        0.7,
      ),
    );
    for (const guideX of [pageWidth * 0.13, pageWidth * 0.87]) {
      const vanishing = guideX < frontX ? vpLeft : vpRight;
      await drawPath(
        humanise(
          segment(frontTop, towardVanishingPoint(frontTop, vanishing, guideX), 30),
          0.6,
        ),
      );
    }

    // Box pass: the learner's actual edges, drawn in pen.
    await selectSlot("pen");
    await drawPath(humanise(segment(frontTop, frontBottom, 24)));
    await drawPath(humanise(segment(frontTop, leftTop, 24)));
    await drawPath(humanise(segment(frontBottom, leftBottom, 24)));
    await drawPath(humanise(segment(leftTop, leftBottom, 22)));
    await drawPath(humanise(segment(frontTop, rightTop, 24)));
    await drawPath(humanise(segment(frontBottom, rightBottom, 24)));
    await drawPath(humanise(segment(rightTop, rightBottom, 22)));
    await drawPath(humanise(segment(leftTop, backTop, 22), 1.1));
    await drawPath(humanise(segment(rightTop, backTop, 22), 1.1));

    const objectCount = await surface.getAttribute("data-document-object-count");
    console.log("objects drawn:", objectCount);

    // Park the cursor away from the artwork so no hover chrome is captured.
    await window.mouse.move(VIEWPORT.width - 40, VIEWPORT.height - 240);
    await window.waitForTimeout(500);

    await window.screenshot({
      path: path.join(assetsDirectory, "folio-workspace-sketch.png"),
      animations: "disabled",
    });

    // Tight crop of the drawing itself, for close-up callout slides.
    const topLeft = pageToScreen(pageWidth * 0.06, pageHeight * 0.14);
    const bottomRight = pageToScreen(pageWidth * 0.96, pageHeight * 0.82);
    await window.screenshot({
      path: path.join(assetsDirectory, "folio-canvas-closeup.png"),
      animations: "disabled",
      clip: {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      },
    });

    // Tool options open over the same artwork: shows the real drawing controls.
    await selectSlot("pencil");
    const rail = window.getByTestId("drawing-property-rail");
    await rail.waitFor({ state: "visible" });
    await rail.locator('button[data-property-key="strokeWidth"]').click();
    await window.getByTestId("context-tool-palette").waitFor({ state: "visible" });
    await window.mouse.move(VIEWPORT.width - 40, VIEWPORT.height - 240);
    await window.waitForTimeout(600);
    await window.screenshot({
      path: path.join(assetsDirectory, "folio-tool-options.png"),
      animations: "disabled",
    });
    await window.keyboard.press("Escape");
    await window.waitForTimeout(300);

    // Dark appearance of the same workspace.
    await window.getByRole("button", { name: "Workspace menu", exact: true }).click();
    await window.getByRole("menuitem", { name: "Use dark appearance", exact: true }).click();
    await window.mouse.move(VIEWPORT.width - 40, VIEWPORT.height - 240);
    await window.waitForTimeout(700);
    await window.screenshot({
      path: path.join(assetsDirectory, "folio-workspace-dark.png"),
      animations: "disabled",
    });

    console.log("captured into", assetsDirectory);
  } finally {
    await electronApp.close();
  }
}

await main();
