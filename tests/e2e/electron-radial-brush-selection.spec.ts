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

test("assigns real brush identities to independent drawing slots", async () => {
  test.setTimeout(180_000);
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

    // 1. Open the library from the Pen slot; its own brush reads as selected.
    await openLibraryFrom(window, slot("Pen"));
    expect(await selectedBrush(window), "the slot's own brush is indicated").toBe("fineliner");
    expect(await selectedCount(window), "exactly one cell is selected").toBe(1);

    // 2. The wheel offers only real identities, all pencil/pen/marker.
    await expect(library.locator("[data-brush-item]")).toHaveCount(45);
    const families = await window.evaluate(() => [
      ...new Set(
        [...document.querySelectorAll("[data-brush-item]")].map(
          (cell) => cell.getAttribute("data-brush-family") ?? "",
        ),
      ),
    ]);
    expect(families.sort()).toEqual(["marker", "pen", "pencil"]);

    // 3. The native SVG tooltip is gone; the name is on the accessible label.
    const naming = await window.evaluate(() => {
      const cell = document.querySelector('[data-brush-item="gel-pen"]')!;
      return {
        titles: document.querySelectorAll("[data-brush-item] > title").length,
        label: cell.getAttribute("aria-label"),
        role: cell.getAttribute("role"),
        checked: cell.getAttribute("aria-checked"),
        focusable: cell.getAttribute("tabindex"),
      };
    });
    expect(naming.titles, "no native SVG tooltip remains").toBe(0);
    expect(naming.label).toBe("Gel Pen");
    expect(naming.role).toBe("radio");
    expect(naming.checked).toBe("false");
    expect(naming.focusable).toBe("0");

    // 4. Click a different brush: the library closes and the slot stays active.
    const penChoice = await clickReachableBrush(window, { excludeSelected: true });
    expect(penChoice.id, "a different brush was chosen").not.toBe("fineliner");
    await expect(library, "selection closes the library").toHaveCount(0);
    await expect(slot("Pen")).toHaveAttribute("aria-pressed", "true");

    // 5. The rail follows the new brush's real preset, read from canonical
    //    state rather than from any second store the library might keep.
    const railWidth = await railValue(window, "strokeWidth");
    expect(railWidth, "the rail printed a width").toMatch(/[0-9]/u);

    // 6. Reopening indicates the newly chosen brush.
    await slot("Pen").click();
    await waitForOpen(window);
    expect(await selectedBrush(window)).toBe(penChoice.id);
    expect(await selectedCount(window)).toBe(1);
    await slot("Pen").click();
    await expect(library).toHaveCount(0);

    // 7. Slot independence: Brush Pen keeps its own assignment.
    await openLibraryFrom(window, slot("Brush Pen"));
    expect(await selectedBrush(window), "Brush Pen holds its own brush").toBe("brush-pen-soft");
    const brushPenChoice = await clickReachableBrush(window, { excludeSelected: true });
    await expect(library).toHaveCount(0);

    // 8. Going back to Pen must restore Pen's assignment, not the last one used.
    await openLibraryFrom(window, slot("Pen"));
    expect(await selectedBrush(window), "Pen kept its own choice").toBe(penChoice.id);
    await expect(library).toHaveAttribute("data-library-anchor-slot", "pen");
    await slot("Pen").click();
    await expect(library).toHaveCount(0);

    // And Brush Pen still holds what it was given.
    await openLibraryFrom(window, slot("Brush Pen"));
    expect(await selectedBrush(window), "Brush Pen kept its own choice").toBe(brushPenChoice.id);
    expect(brushPenChoice.id, "the two slots hold different brushes").not.toBe(penChoice.id);
    await slot("Brush Pen").click();
    await expect(library).toHaveCount(0);

    // 9. A slot whose family has no catalogue entries shows no selection.
    await openLibraryFrom(window, slot("Highlighter"));
    expect(await selectedCount(window), "no fake default selection").toBe(0);
    await slot("Highlighter").click();
    await expect(library).toHaveCount(0);

    // 10. Drawing uses the selected identity's real backing preset.
    await slot("Pen").click();
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const bounds = (await inkCanvas.boundingBox())!;
    await drawStroke(window, bounds, 320);
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");
    const firstStroke = await strokeBrushes(window);
    expect(firstStroke, "one stroke exists").toHaveLength(1);
    expect(firstStroke[0]!.presetId, "the stroke used the chosen identity's backing preset").toBe(
      penChoice.fallbackPresetId,
    );

    // 11. Reassigning must not restyle what is already drawn.
    await slot("Pen").click();
    await waitForOpen(window);
    const historyBefore = await surface.getAttribute("data-history-undo-depth");
    const secondChoice = await clickReachableBrush(window, { excludeSelected: true });
    await expect(library).toHaveCount(0);
    expect(await strokeBrushes(window), "existing artwork is untouched").toEqual(firstStroke);
    await expect(surface, "reassignment creates no History").toHaveAttribute(
      "data-history-undo-depth",
      historyBefore!,
    );
    await expect(surface).toHaveAttribute("data-document-object-count", "1");

    // 12. The next stroke uses the newly assigned backing.
    await drawStroke(window, bounds, 420);
    await expect(surface).toHaveAttribute("data-document-object-count", "2");
    expect((await strokeBrushes(window)).map((stroke) => stroke.presetId)).toEqual([
      penChoice.fallbackPresetId,
      secondChoice.fallbackPresetId,
    ]);
    // Drawing History still works exactly as before.
    await window.keyboard.press("Control+z");
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await window.keyboard.press("Control+y");
    await expect(surface).toHaveAttribute("data-document-object-count", "2");

    // 13. A rotation drag must not select anything.
    await slot("Pen").click();
    await waitForOpen(window);
    const beforeDrag = await selectedBrush(window);
    const axle = await libraryAxle(window);
    await rotateWheel(window, axle, 55, 10);
    expect(
      Number(await library.getAttribute("data-library-rotation")),
      "the wheel turned",
    ).toBeGreaterThan(40);
    await expect(library, "and stayed open").toBeVisible();
    expect(await selectedBrush(window), "a drag selects nothing").toBe(beforeDrag);

    // 14. Pressing during a coast stops it, and a sub-threshold release still
    //     selects the brush it landed on - whatever family that brush is.
    await flickWheel(window, axle, 80, 5);
    await expect(library).toHaveAttribute("data-library-coasting", "true");
    const caught = await pressAndRelease(window, axle);
    await expect(library, "the press stopped the coast and selected").toHaveCount(0);
    await slot("Pen").click();
    await waitForOpen(window);
    expect(await selectedBrush(window), "the caught cell was selected").toBe(caught);

    // 15. Every one of the 45 cells is a candidate: none is refused, dimmed or
    //     removed from the tab order because of its family.
    const openness = await window.evaluate(() => {
      const cells = [...document.querySelectorAll("[data-brush-item]")];
      return {
        total: cells.length,
        disabled: cells.filter((c) => c.getAttribute("aria-disabled") === "true").length,
        visibleNotTabbable: cells.filter(
          (c) =>
            Number(c.getAttribute("data-brush-opacity")) > 0.9 &&
            c.getAttribute("tabindex") !== "0",
        ).length,
      };
    });
    expect(openness.total).toBe(45);
    expect(openness.disabled, "nothing is disabled by family").toBe(0);
    expect(openness.visibleNotTabbable, "every visible cell is a tab stop").toBe(0);

    // 16. Keyboard selection.
    const keyboardTarget = await window.evaluate(() => {
      const cell = [...document.querySelectorAll("[data-brush-item]")].find(
        (item) =>
          Number(item.getAttribute("data-brush-opacity")) > 0.9 &&
          item.getAttribute("data-brush-selected") === "false" &&
          item.getAttribute("data-brush-family") === "pen",
      );
      if (cell === undefined) return null;
      (cell as SVGGElement).focus();
      return cell.getAttribute("data-brush-item");
    });
    expect(keyboardTarget).not.toBeNull();
    await window.keyboard.press("Enter");
    await expect(library, "Enter selects and closes").toHaveCount(0);
    await slot("Pen").click();
    await waitForOpen(window);
    expect(await selectedBrush(window)).toBe(keyboardTarget);

    // Space now reaches the focused cell and selects it. The editor still
    // binds Space to transient viewport panning, but that shortcut no longer
    // claims the key when a semantic control is focused.
    // The library is already open from the Enter check above.
    const spaceTarget = await window.evaluate(() => {
      const cell = [...document.querySelectorAll("[data-brush-item]")].find(
        (item) =>
          Number(item.getAttribute("data-brush-opacity")) > 0.9 &&
          item.getAttribute("data-brush-selected") === "false",
      );
      (cell as SVGGElement | undefined)?.focus();
      return cell?.getAttribute("data-brush-item") ?? null;
    });
    expect(spaceTarget).not.toBeNull();
    await window.keyboard.press("Space");
    await expect(library, "Space selects and closes").toHaveCount(0);
    await slot("Pen").click();
    await waitForOpen(window);
    expect(await selectedBrush(window)).toBe(spaceTarget);

    // 17. A cell faded out behind the dock cannot be selected.
    const hidden = await window.evaluate(() => {
      const cell = [...document.querySelectorAll("[data-brush-item]")].find(
        (item) => Number(item.getAttribute("data-brush-visibility")) <= 0.02,
      );
      return cell === undefined
        ? null
        : {
            id: cell.getAttribute("data-brush-item"),
            interactive: getComputedStyle(cell).pointerEvents !== "none",
            tabindex: cell.getAttribute("tabindex"),
          };
    });
    expect(hidden, "a hidden cell exists to check").not.toBeNull();
    expect(hidden!.interactive, "hidden cells take no input").toBe(false);
    expect(hidden!.tabindex, "and are not tab stops").toBe("-1");

    // 18. The selected cell honours the fade rather than shining through it.
    const selectedOpacity = await window.evaluate(() => {
      const cell = document.querySelector('[data-brush-selected="true"]');
      return cell === null
        ? null
        : {
            opacity: Number(cell.getAttribute("data-brush-opacity")),
            visibility: Number(cell.getAttribute("data-brush-visibility")),
          };
    });
    expect(selectedOpacity).not.toBeNull();
    expect(selectedOpacity!.opacity).toBeLessThanOrEqual(selectedOpacity!.visibility + 1e-9);
    await slot("Pen").click();
    await expect(library).toHaveCount(0);

    // 19b. Cross-family: one slot walks pencil -> pen -> marker, its dock glyph
    //      and tool follow each time, and earlier strokes never change.
    await slot("Pencil").click();
    const strokesBefore = await strokeBrushes(window);
    for (const family of ["pen", "marker", "pencil"] as const) {
      await slot("Pencil").click();
      await waitForOpen(window);
      const chosen = await clickReachableBrush(window, { family, excludeSelected: true });
      await expect(library).toHaveCount(0);
      const dockState = await window.evaluate(() => {
        const button = document.querySelector('button[data-dock-slot="pencil"]');
        return {
          family: button?.getAttribute("data-slot-family") ?? null,
          active: button?.getAttribute("data-tool-active") ?? null,
          glyph:
            button
              ?.querySelector("svg.lucide")
              ?.getAttribute("class")
              ?.match(/lucide-[a-z-]+/u)?.[0] ?? null,
        };
      });
      expect(dockState.family, `slot follows ${family}`).toBe(family);
      expect(dockState.active, "and stays the active slot").toBe("true");
      expect(dockState.glyph, "with a glyph of its own").not.toBeNull();
      // A new stroke uses the newly assigned identity's backing preset.
      const before = (await strokeBrushes(window)).length;
      await drawStroke(window, bounds, 520 + before * 30);
      const after = await strokeBrushes(window);
      expect(after).toHaveLength(before + 1);
      expect(after[after.length - 1]!.presetId).toBe(chosen.fallbackPresetId);
      // Everything drawn earlier is byte-identical.
      expect(after.slice(0, strokesBefore.length)).toEqual(strokesBefore);
    }

    // 19b-ii. The slot's accessible name and tooltip follow what it holds.
    //         Position stays; contents change.
    for (const family of ["pencil", "pen", "marker"] as const) {
      await slot("Pencil").click();
      await waitForOpen(window);
      const chosen = await clickReachableBrush(window, { family, excludeSelected: true });
      await expect(library).toHaveCount(0);
      const naming = await window.evaluate(() => {
        const button = document.querySelector('button[data-dock-slot="pencil"]');
        return {
          label: button?.getAttribute("aria-label") ?? null,
          brushId: button?.getAttribute("data-slot-brush") ?? null,
          toolName: button?.getAttribute("data-tool-name") ?? null,
          slot: button?.getAttribute("data-dock-slot") ?? null,
        };
      });
      const brushName = chosen.name;
      expect(naming.slot, "the physical slot never moves").toBe("pencil");
      expect(naming.label, "position first, contents second").toBe(`Brush slot 1, ${brushName}`);
      // Each attribute carries exactly one thing: the id, the display name,
      // and the stable physical position.
      expect(naming.brushId, "data-slot-brush is the identity id").toBe(chosen.id);
      expect(naming.toolName, "data-tool-name is the display name").toBe(brushName);
      // No stale seeded family name survives the reassignment.
      expect(naming.label).not.toMatch(/^Pencil$|^Pen$|^Brush Pen$|^Marker$|^Highlighter$/u);
      // The tooltip shows the same brush.
      await window.locator('button[data-dock-slot="pencil"]').hover();
      await expect(window.getByRole("tooltip", { name: brushName, exact: true })).toBeVisible();
      await window.mouse.move(900, 600);
    }

    // 19c. The fifth slot is an ordinary slot: it takes any family too.
    await slot("Highlighter").click();
    for (const family of ["pencil", "marker"] as const) {
      await slot("Highlighter").click();
      await waitForOpen(window);
      await clickReachableBrush(window, { family, excludeSelected: true });
      await expect(library).toHaveCount(0);
      await expect(
        window.locator('button[data-dock-slot="highlighter"]'),
        `fifth slot takes ${family}`,
      ).toHaveAttribute("data-slot-family", family);
    }

    // 19d. Five slots, five independent identities, each restored on return.
    const assigned: Record<string, string> = {};
    for (const name of ["Pencil", "Pen", "Brush Pen", "Marker", "Highlighter"] as const) {
      await slot(name).click();
      await slot(name).click();
      await waitForOpen(window);
      const chosen = await clickReachableBrush(window, {
        excludeSelected: true,
        excludeIds: Object.values(assigned),
      });
      await expect(library).toHaveCount(0);
      assigned[name] = chosen.id;
    }
    for (const name of ["Pencil", "Pen", "Brush Pen", "Marker", "Highlighter"] as const) {
      await slot(name).click();
      await slot(name).click();
      await waitForOpen(window);
      expect(await selectedBrush(window), `${name} restored its own brush`).toBe(assigned[name]);
      await slot(name).click();
      await expect(library).toHaveCount(0);
    }
    expect(new Set(Object.values(assigned)).size, "five distinct identities").toBe(5);

    // 19e. Space still pans the canvas when the canvas owns the key.
    await window.mouse.move(bounds.x + 600, bounds.y + 400);
    const cameraBefore = await surface.getAttribute("data-viewport-camera-x");
    await window.keyboard.down("Space");
    await window.mouse.down();
    await window.mouse.move(bounds.x + 700, bounds.y + 400, { steps: 6 });
    await window.mouse.up();
    await window.keyboard.up("Space");
    expect(
      await surface.getAttribute("data-viewport-camera-x"),
      "Space still pans the canvas",
    ).not.toBe(cameraBefore);
    await expect(surface, "and panning draws nothing").toHaveAttribute(
      "data-document-object-count",
      String((await strokeBrushes(window)).length),
    );

    // 19. The normal Tool Options gesture is untouched.
    await slot("Pen").click();
    await expect(window.getByTestId("context-tool-palette")).toBeVisible();
    await expect(library, "a plain press is not the library").toHaveCount(0);
    await window.keyboard.press("Escape");

    // 20. Dock and rail never moved, and the rail still reads canonical state.
    await expect(dock.locator("button[data-dock-slot]")).toHaveCount(8);
    await expect(rail.locator("button[data-property-key]")).toHaveCount(4);

    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function waitForOpen(window: Page): Promise<void> {
  await expect(window.getByTestId("radial-brush-library")).toHaveAttribute(
    "data-library-phase",
    "open",
  );
}

/** The id of the one selected cell, or null when nothing is selected. */
async function selectedBrush(window: Page): Promise<string | null> {
  return window.evaluate(
    () =>
      document.querySelector('[data-brush-selected="true"]')?.getAttribute("data-brush-item") ??
      null,
  );
}

async function selectedCount(window: Page): Promise<number> {
  return window.evaluate(() => document.querySelectorAll('[data-brush-selected="true"]').length);
}

async function railValue(window: Page, key: string): Promise<string | null> {
  return window.evaluate(
    (property) =>
      document.querySelector(`[data-property-key="${property}"]`)?.textContent?.trim() ?? null,
    key,
  );
}

/**
 * The brushes frozen into the strokes already on the page.
 *
 * Read from the diagnostics the canvas already publishes, so proving that
 * artwork is untouched needs no change to the renderer.
 */
async function strokeBrushes(
  window: Page,
): Promise<readonly { id: string; presetId: string; size: number; opacity: number }[]> {
  return window.evaluate(() => {
    const raw =
      document
        .querySelector('[data-testid="canvas-surface"]')
        ?.getAttribute("data-document-stroke-brushes") ?? "[]";
    return JSON.parse(raw) as { id: string; presetId: string; size: number; opacity: number }[];
  });
}

async function drawStroke(
  window: Page,
  bounds: { x: number; y: number },
  offsetY: number,
): Promise<void> {
  await window.mouse.move(bounds.x + 900, bounds.y + offsetY);
  await window.mouse.down();
  await window.mouse.move(bounds.x + 1040, bounds.y + offsetY + 60, { steps: 8 });
  await window.mouse.up();
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
  onlyAssignable = false,
): Promise<Readonly<{ angleDegrees: number; radius: number; id: string }>> {
  const grab = await window.evaluate((assignableOnly) => {
    const normalize = (value: number) => ((value % 360) + 360) % 360;
    for (const cell of document.querySelectorAll("[data-brush-item]")) {
      if (assignableOnly && cell.getAttribute("data-brush-assignable") !== "true") continue;
      const start = Number(cell.getAttribute("data-brush-start-angle"));
      const span = Number(cell.getAttribute("data-brush-cell-angle"));
      const inner = Number(cell.getAttribute("data-brush-inner-radius"));
      const outer = Number(cell.getAttribute("data-brush-outer-radius"));
      const mid = normalize(start + span / 2);
      if (mid < 40 || mid > 320) {
        return {
          angleDegrees: mid > 180 ? mid - 360 : mid,
          radius: (inner + outer) / 2,
          id: cell.getAttribute("data-brush-item") ?? "",
        };
      }
    }
    return null;
  }, onlyAssignable);
  if (grab === null) throw new Error("No brush cell is reachable on the wheel's open side.");
  return grab;
}

/** Presses a live cell and releases without moving, which is a selection. */
async function pressAndRelease(
  window: Page,
  axle: Readonly<{ x: number; y: number }>,
  onlyAssignable = false,
): Promise<string> {
  const grab = await grabPointOnWheel(window, onlyAssignable);
  const point = {
    x: axle.x + grab.radius * Math.cos((grab.angleDegrees * Math.PI) / 180),
    y: axle.y + grab.radius * Math.sin((grab.angleDegrees * Math.PI) / 180),
  };
  await window.mouse.move(point.x, point.y);
  await window.mouse.down();
  await window.mouse.up();
  return grab.id;
}

/**
 * Picks a cell the pointer can actually reach, and clicks its middle.
 *
 * Reachability is not the same as visibility here. A cell can be at full
 * opacity and still be physically covered by the Tool Dock or Property Rail,
 * which sit above the library; and the annular sector's bounding-box centre
 * falls in the hole of the ring rather than on the cell. So the point is
 * computed in polar terms and then hit-tested, and only a cell that answers to
 * its own point is used.
 */
async function clickReachableBrush(
  window: Page,
  options: {
    readonly family?: string;
    readonly excludeSelected?: boolean;
    readonly excludeIds?: readonly string[];
  } = {},
): Promise<{ id: string; name: string; fallbackPresetId: string }> {
  const target = await window.evaluate((filter) => {
    const library = document.querySelector('[data-testid="radial-brush-library"]');
    if (library === null) return null;
    const rect = library.getBoundingClientRect();
    const axleX = rect.left + Number(library.getAttribute("data-library-center-x"));
    const axleY = rect.top + Number(library.getAttribute("data-library-center-y"));
    for (const cell of document.querySelectorAll("[data-brush-item]")) {
      const id = cell.getAttribute("data-brush-item") ?? "";
      if (filter.family !== undefined && cell.getAttribute("data-brush-family") !== filter.family) {
        continue;
      }
      if (filter.excludeSelected === true && cell.getAttribute("data-brush-selected") === "true") {
        continue;
      }
      if (filter.excludeIds !== undefined && filter.excludeIds.includes(id)) continue;
      if (Number(cell.getAttribute("data-brush-opacity")) < 0.9) continue;
      const start = Number(cell.getAttribute("data-brush-start-angle"));
      const span = Number(cell.getAttribute("data-brush-cell-angle"));
      const inner = Number(cell.getAttribute("data-brush-inner-radius"));
      const outer = Number(cell.getAttribute("data-brush-outer-radius"));
      const mid = ((start + span / 2) * Math.PI) / 180;
      const radius = (inner + outer) / 2;
      const x = axleX + radius * Math.cos(mid);
      const y = axleY + radius * Math.sin(mid);
      const hit = document.elementFromPoint(x, y);
      if (hit?.closest("[data-brush-item]")?.getAttribute("data-brush-item") !== id) continue;
      return {
        id,
        name: cell.getAttribute("aria-label") ?? "",
        fallbackPresetId: cell.getAttribute("data-brush-fallback-preset") ?? "",
        x,
        y,
      };
    }
    return null;
  }, options);
  if (target === null) throw new Error("No brush cell is reachable by the pointer.");
  await window.mouse.move(target.x, target.y);
  await window.mouse.down();
  await window.mouse.up();
  return { id: target.id, name: target.name, fallbackPresetId: target.fallbackPresetId };
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
  await window.mouse.move(at(grab.angleDegrees, 34).x, at(grab.angleDegrees, 34).y);
  for (let step = 1; step <= steps; step += 1) {
    const point = at(grab.angleDegrees + (deltaDegrees * step) / steps, 34);
    await window.mouse.move(point.x, point.y);
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

/**
 * Opens the library from one slot, whatever state the dock is in.
 *
 * The production gesture is a toggle on the active slot, so "click twice" is
 * only right when the slot starts inactive. This presses, then presses again
 * only if the library is not yet up.
 */
async function openLibraryFrom(window: Page, target: Locator): Promise<void> {
  const library = window.getByTestId("radial-brush-library");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.click();
    // Wait for the choreography to settle before judging what the press did: a
    // collapsing library is still mounted, so counting elements mid-flight
    // would mistake "closing" for "already open".
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
