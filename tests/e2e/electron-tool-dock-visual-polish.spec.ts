import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";
import { activateDockSlot } from "./dock-helpers";

const DRAWING_SLOT_IDS = ["pencil", "pen", "brush-pen", "marker", "highlighter"] as const;

test("restores the earlier Folio selection while keeping every stored drawing colour", async () => {
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

    const surface = window.getByTestId("canvas-surface");
    const dock = window.getByRole("toolbar", { name: "Notebook tool dock" });
    const rail = window.getByTestId("drawing-property-rail");

    await expect(window.locator("html")).toHaveAttribute("data-theme", "light");
    const lightColors = {
      pencil: "#ffffff",
      pen: "#16a34a",
      "brush-pen": "#000000",
      marker: "#ca8a04",
      highlighter: "#059669",
    } as const;
    for (const [slotId, color] of Object.entries(lightColors)) {
      await setSlotColor(window, slotId, color);
    }
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");

    await activateDockSlot(window, "brush-pen");
    await expectStoredColors(dock, lightColors);
    await expectEarlierFolioSelection(dock, "brush-pen");
    await expectSimpleGlyphPresentation(dock);
    await expectPresentationWeightParity(dock);
    // On a white dock the pale colour is the one that disappears; black is the
    // clearest thing here and is left exactly as it is.
    const lightTokens = await readDockTokens(window);
    expect(lightTokens.surface, "the light dock surface the contrast rule assumes").toBe(
      "rgb(255, 255, 255)",
    );
    await expectContouredSlots(dock, ["pencil"], lightTokens.ink);
    await expectDrawingSelectionCases(window, dock, lightColors, [
      "highlighter",
      "brush-pen",
      "marker",
    ]);
    await activateDockSlot(window, "brush-pen");
    await expectLiveActiveColorSequence(window, dock, "brush-pen");

    // Switching slots changes selection presentation only. Every inactive
    // glyph remains an exact preview of that slot's canonical drawing colour.
    await activateDockSlot(window, "pen");
    await expectStoredColors(dock, lightColors);
    await expectEarlierFolioSelection(dock, "pen");
    await expect(drawingGlyph(dock, "brush-pen")).toHaveAttribute(
      "data-drawing-slot-glyph-color",
      lightColors["brush-pen"],
    );
    await activateDockSlot(window, "brush-pen");
    await expectEarlierFolioSelection(dock, "brush-pen");
    await collapseToolOptions(window);

    await window.getByRole("button", { name: "Application menu", exact: true }).click();
    await window.getByRole("menuitem", { name: "Use dark appearance", exact: true }).click();
    await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");

    // The reported dark-appearance cases together: black, dark blue and dark
    // red, beside a bright colour and white that must be left alone.
    const darkColors = {
      pencil: "#000000",
      pen: "#00008b",
      "brush-pen": "#8b0000",
      marker: "#eab308",
      highlighter: "#ffffff",
    } as const;
    for (const [slotId, color] of Object.entries(darkColors)) {
      await setSlotColor(window, slotId, color);
    }
    await activateDockSlot(window, "brush-pen");

    await expectStoredColors(dock, darkColors);
    await expectEarlierFolioSelection(dock, "brush-pen");
    await expectSimpleGlyphPresentation(dock);
    await expectPresentationWeightParity(dock);
    const darkTokens = await readDockTokens(window);
    expect(darkTokens.surface, "the dark dock surface the contrast rule assumes").toBe(
      "rgb(51, 47, 43)",
    );
    await expectContouredSlots(dock, ["pencil", "pen", "brush-pen"], darkTokens.ink);
    // The treatment is help, not a substitution: every slot still reports the
    // colour it was given, contour or no contour.
    await expectStoredColors(dock, darkColors);
    await expectDrawingSelectionCases(window, dock, darkColors, ["pencil", "pen", "marker"]);
    await activateDockSlot(window, "brush-pen");
    await expectEarlierFolioSelection(dock, "brush-pen");
    await collapseToolOptions(window);

    // The two panels stay separate hit surfaces in the same foreground band.
    const [drawingCapsuleBox, railBox] = await Promise.all([
      dock.locator('[data-tool-dock-group="drawing"]').boundingBox(),
      rail.boundingBox(),
    ]);
    if (drawingCapsuleBox === null || railBox === null) {
      throw new Error("Dock and Property Rail must be measurable.");
    }
    expect(railBox.x - (drawingCapsuleBox.x + drawingCapsuleBox.width)).toBeCloseTo(3, 1);
    const railButton = rail.locator('button[data-property-key="strokeWidth"]');
    expect(await ownsItsCenter(window, railButton), "the rail keeps its own pointer target").toBe(
      true,
    );

    const selectButton = dock.locator('button[data-dock-slot="select"]');
    await selectButton.click();
    await expect(selectButton).toHaveAttribute("aria-pressed", "true");
    await expectEarlierFolioSelection(dock, "select");
    await expectPresentationWeightParity(dock);
    await activateDockSlot(window, "brush-pen");
    await expectEarlierFolioSelection(dock, "brush-pen");

    await window.setViewportSize({ width: 960, height: 640 });
    await expect(rail).toBeVisible();
    expect(await isFullyOnScreen(rail), "the tightened instrument fits the minimum window").toBe(
      true,
    );
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function setSlotColor(window: Page, slotId: string, color: string): Promise<void> {
  await activateDockSlot(window, slotId);
  await collapseToolOptions(window);
  const rail = window.getByTestId("drawing-property-rail");
  await rail.locator('button[data-property-key="strokeColor"]').click();
  const picker = window.getByTestId("full-color-picker");
  await expect(picker).toBeVisible();
  await picker.getByRole("textbox", { name: "Hex color" }).fill(color);
  await expect(window.getByTestId("canvas-surface")).toHaveAttribute("data-drawing-color", color);
  await commitPickerWithoutCanvas(window, picker);
  await expect(drawingGlyph(window, slotId)).toHaveAttribute(
    "data-drawing-slot-glyph-color",
    color,
  );
}

async function expectLiveActiveColorSequence(
  window: Page,
  dock: Locator,
  slotId: string,
): Promise<void> {
  const activeButton = dock.locator(`button[data-dock-slot="${slotId}"]`);
  const originalColor = await drawingGlyph(dock, slotId).getAttribute(
    "data-drawing-slot-glyph-color",
  );
  if (originalColor === null) throw new Error("The active slot must expose its stored colour.");
  await expect(activeButton).toHaveAttribute("aria-pressed", "true");
  await collapseToolOptions(window);
  await window
    .getByTestId("drawing-property-rail")
    .locator('button[data-property-key="strokeColor"]')
    .click();
  const picker = window.getByTestId("full-color-picker");
  const hex = picker.getByRole("textbox", { name: "Hex color" });
  const historyBefore = await window
    .getByTestId("canvas-surface")
    .getAttribute("data-history-undo-depth");

  for (const color of ["#000000", "#ffffff", "#ca8a04", "#2563eb"] as const) {
    await hex.fill(color);
    const glyph = drawingGlyph(dock, slotId);
    await expect(glyph, `${color} reaches the active glyph live`).toHaveAttribute(
      "data-drawing-slot-glyph-color",
      color,
    );
    await expectSimpleGlyphPresentation(dock);
    expect(await glyph.evaluate((element) => getComputedStyle(element).color)).toBe(
      rgbCssColor(color),
    );
    await expect(activeButton, "live colour changes do not reactivate the slot").toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
  await expect(window.getByTestId("canvas-surface")).toHaveAttribute(
    "data-history-undo-depth",
    historyBefore ?? "0",
  );
  await hex.fill(originalColor);
  await expect(drawingGlyph(dock, slotId)).toHaveAttribute(
    "data-drawing-slot-glyph-color",
    originalColor,
  );
  await commitPickerWithoutCanvas(window, picker);
}

async function expectDrawingSelectionCases(
  window: Page,
  dock: Locator,
  colors: Readonly<Record<string, string>>,
  slotIds: readonly string[],
): Promise<void> {
  for (const slotId of slotIds) {
    await activateDockSlot(window, slotId);
    await expectEarlierFolioSelection(dock, slotId);
    const glyph = drawingGlyph(dock, slotId);
    // Indexing a Record is optional under noUncheckedIndexedAccess; every slot
    // in `slotIds` has a colour, and asserting it says so.
    const expected = colors[slotId];
    expect(expected, `${slotId} has a stored colour`).toBeDefined();
    await expect(glyph).toHaveAttribute("data-drawing-slot-glyph-color", expected!);
    const style = await glyph.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        filter: computed.filter,
        height: computed.height,
        strokeWidth: element.getAttribute("stroke-width"),
        transform: computed.transform,
        width: computed.width,
      };
    });
    expect(style).toEqual({
      filter: "none",
      height: "17px",
      strokeWidth: "2",
      transform: "none",
      width: "17px",
    });
  }
}

async function collapseToolOptions(window: Page): Promise<void> {
  // A prior picker opened from the Property Rail retains Tool Options as its
  // expanded context after committing; collapse it before targeting the rail.
  const palette = window.getByTestId("context-tool-palette");
  if (await palette.isVisible()) {
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
  }
}

async function commitPickerWithoutCanvas(window: Page, picker: Locator): Promise<void> {
  // The right-hand utility is outside the picker and commits the creation
  // setting without sending a drawing pointer to the canvas or changing tools.
  const layers = window.getByRole("button", { name: "Layers", exact: true });
  await layers.click();
  await expect(picker).toHaveCount(0);
  await expect(layers).toHaveAttribute("aria-pressed", "true");
  await layers.click();
  await expect(layers).toHaveAttribute("aria-pressed", "false");
}

function drawingGlyph(root: Page | Locator, slotId: string): Locator {
  return root.locator(`[data-drawing-slot-glyph="${slotId}"]`);
}

async function expectStoredColors(
  dock: Locator,
  colors: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [slotId, color] of Object.entries(colors)) {
    const glyph = drawingGlyph(dock, slotId);
    await expect(glyph, `${slotId} retains ${color}`).toHaveAttribute(
      "data-drawing-slot-glyph-color",
      color,
    );
    expect(await glyph.evaluate((element) => getComputedStyle(element).color)).toBe(
      rgbCssColor(color),
    );
  }
}

/**
 * The restored Folio presentation, plus the one thing added back on top of it.
 *
 * Everything the Concepts experiment introduced stays gone: no selected region,
 * no solid backplate behind a glyph, no keyline, no frame around it, and no
 * contrast metadata on the artwork colour. A glyph whose colour cannot be told
 * apart from the dock is given a contour of its own shape -- and nothing else
 * is added, which is what the counts here hold to.
 */
async function expectSimpleGlyphPresentation(dock: Locator): Promise<void> {
  await expect(dock.locator("[data-drawing-slot-selection]")).toHaveCount(0);
  await expect(dock.getByTestId("drawing-slot-selected-surface")).toHaveCount(0);
  await expect(dock.getByTestId("drawing-slot-contrast-backplate")).toHaveCount(0);
  await expect(dock.getByTestId("drawing-slot-contrast-keyline")).toHaveCount(0);
  await expect(dock.locator("[data-drawing-slot-glyph-frame]")).toHaveCount(0);
  await expect(dock.locator("[data-drawing-slot-glyph-keyline]")).toHaveCount(0);
  for (const slotId of DRAWING_SLOT_IDS) {
    const button = dock.locator(`button[data-dock-slot="${slotId}"]`);
    await expect(button.locator("[data-drawing-slot-glyph]")).toHaveCount(1);
    // At most one contour, and no third layer of anything.
    const contours = await button.locator(`[data-drawing-slot-glyph-contour="${slotId}"]`).count();
    expect(contours, `${slotId} draws more than one contour`).toBeLessThanOrEqual(1);
    await expect(button.locator("svg")).toHaveCount(1 + contours);
    await expect(drawingGlyph(dock, slotId)).not.toHaveAttribute(
      "data-drawing-slot-glyph-contrast",
      /.+/,
    );
  }
}

/**
 * The contour appears on exactly the slots that cannot be read without it.
 *
 * Named per slot rather than derived, so the expectation is a statement about
 * these colours on this appearance rather than a restatement of the rule the
 * dock already applies.
 */
async function expectContouredSlots(
  dock: Locator,
  expected: readonly string[],
  ink: string,
): Promise<void> {
  for (const slotId of DRAWING_SLOT_IDS) {
    const wanted = expected.includes(slotId);
    await expect(
      dock.locator(`[data-drawing-slot-glyph-contour="${slotId}"]`),
      `${slotId} contour`,
    ).toHaveCount(wanted ? 1 : 0);
    await expect(drawingGlyph(dock, slotId)).toHaveAttribute(
      "data-drawing-slot-glyph-contoured",
      String(wanted),
    );
  }
  const contours = dock.locator("[data-drawing-slot-glyph-contour]");
  await expect(contours).toHaveCount(expected.length);
  if (expected.length === 0) return;
  // It is the appearance's own ink, drawn heavier than the glyph and behind it.
  const drawn = await contours.evaluateAll((nodes) =>
    nodes.map((node) => ({
      color: getComputedStyle(node).color,
      strokeWidthAttribute: node.getAttribute("stroke-width"),
      height: getComputedStyle(node).height,
      width: getComputedStyle(node).width,
    })),
  );
  expect(drawn).toEqual(
    expected.map(() => ({
      color: ink,
      strokeWidthAttribute: "3",
      height: "17px",
      width: "17px",
    })),
  );
}

/** The dock surface and ink as the running window actually resolves them. */
async function readDockTokens(window: Page): Promise<Readonly<{ surface: string; ink: string }>> {
  return window.evaluate(() => {
    const read = (token: string) => {
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(token);
      document.body.append(probe);
      const value = getComputedStyle(probe).color;
      probe.remove();
      return value;
    };
    return { surface: read("--folio-surface"), ink: read("--folio-ink") };
  });
}

async function expectEarlierFolioSelection(dock: Locator, activeSlotId: string): Promise<void> {
  await expectSimpleGlyphPresentation(dock);
  const activeButton = dock.locator(`button[data-dock-slot="${activeSlotId}"]`);
  await expect(activeButton).toHaveAttribute("aria-pressed", "true");
  const expectedAccentSoft = await activeButton.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue(
      "--folio-accent-soft",
    );
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  });
  await expect(activeButton).toHaveCSS("background-color", expectedAccentSoft);
  await expect(activeButton).toHaveCSS("border-radius", "9px");
  await expect(activeButton).toHaveCSS("box-shadow", "none");

  for (const slotId of DRAWING_SLOT_IDS) {
    const button = dock.locator(`button[data-dock-slot="${slotId}"]`);
    await expect(button).toHaveAttribute("aria-pressed", String(slotId === activeSlotId));
    await expect(drawingGlyph(dock, slotId)).toHaveAttribute(
      "data-drawing-slot-glyph-active",
      String(slotId === activeSlotId),
    );
    if (slotId !== activeSlotId) {
      await expect(button).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    }
  }
}

async function expectPresentationWeightParity(dock: Locator): Promise<void> {
  const drawingStyles = await dock.locator("[data-drawing-slot-glyph]").evaluateAll((glyphs) =>
    glyphs.map((glyph) => {
      const computed = getComputedStyle(glyph);
      return {
        filter: computed.filter,
        height: computed.height,
        strokeWidthAttribute: glyph.getAttribute("stroke-width"),
        transform: computed.transform,
        width: computed.width,
      };
    }),
  );
  expect(drawingStyles).toEqual(
    Array.from({ length: 5 }, () => ({
      filter: "none",
      height: "17px",
      strokeWidthAttribute: "2",
      transform: "none",
      width: "17px",
    })),
  );

  for (const utility of ["select", "eraser", "shapes"] as const) {
    const styles = await dock
      .locator(`button[data-dock-slot="${utility}"] svg`)
      .evaluate((glyph) => {
        const computed = getComputedStyle(glyph);
        return {
          filter: computed.filter,
          height: computed.height,
          strokeWidthAttribute: glyph.getAttribute("stroke-width"),
          width: computed.width,
        };
      });
    expect(styles).toEqual({
      filter: "none",
      height: "17px",
      strokeWidthAttribute: "2",
      width: "17px",
    });
  }
}

async function ownsItsCenter(window: Page, target: Locator): Promise<boolean> {
  const box = await target.boundingBox();
  if (box === null) return false;
  return window.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return hit?.closest('[data-property-key="strokeWidth"]') !== null;
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
}

async function isFullyOnScreen(target: Locator): Promise<boolean> {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return (
      rect.left >= -0.5 &&
      rect.top >= -0.5 &&
      rect.right <= globalThis.innerWidth + 0.5 &&
      rect.bottom <= globalThis.innerHeight + 0.5
    );
  });
}

function rgbCssColor(hex: string): string {
  const normalized = hex.slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgb(${red}, ${green}, ${blue})`;
}
