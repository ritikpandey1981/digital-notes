import path from "node:path";
import { expect, test, _electron as electron, type Locator, type Page } from "@playwright/test";

test("opens a static radial brush library around the active drawing slot", async () => {
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
    const rail = window.getByTestId("drawing-property-rail");
    const surface = window.getByTestId("canvas-surface");
    const slot = (name: string): Locator => dock.getByRole("button", { name, exact: true });

    const palette = window.getByTestId("context-tool-palette");

    // 1. An inactive slot activates its preset and does NOT open the library.
    await expect(library).toHaveCount(0);
    await slot("Pencil").click();
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "pencil");
    await expect(library).toHaveCount(0);

    // 2. A normal press on the ACTIVE slot keeps its established behaviour:
    //    Tool Options, not the library. The gesture migration is a later task.
    await slot("Pencil").click();
    await expect(palette).toBeVisible();
    await expect(palette).toHaveAttribute("data-tool-options-tool", "Pencil");
    await expect(library).toHaveCount(0);
    await window.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);

    // 3. Shift+Click on the active slot is the temporary geometry trigger.
    await slot("Pencil").click({ modifiers: ["Shift"] });
    await expect(library).toBeVisible();
    await waitForOpen(window);
    await expect(library).toHaveAttribute("data-library-anchor-slot", "pencil");
    await expect(palette).toHaveCount(0);

    // 4. Shift+Click again closes it.
    await slot("Pencil").click({ modifiers: ["Shift"] });
    await expect(library).toHaveCount(0);
    await slot("Pencil").click({ modifiers: ["Shift"] });
    await expect(library).toBeVisible();
    await waitForOpen(window);

    // 4. The centre is the selected slot's centre, not the dock's.
    await expectCenteredOnSlot(window, "pencil");

    // 5. Five tracks with exactly the hardcoded capacities.
    await expect(library).toHaveAttribute("data-library-track-count", "4");
    const counts = await window.evaluate(() =>
      [...document.querySelectorAll("[data-library-track]")].map(
        (track) => track.querySelectorAll("[data-brush-item]").length,
      ),
    );
    expect(counts).toEqual([10, 13, 15, 7]);
    await expect(library.locator("[data-brush-item]")).toHaveCount(45);

    // 6. Constant radial thickness, contiguous tracks, and arc length that
    //    grows outward so outer cells are physically longer.
    const geometry = await window.evaluate(() => {
      const cells = [...document.querySelectorAll("[data-brush-item]")].map((cell) => ({
        track: Number(cell.getAttribute("data-brush-track")),
        inner: Number(cell.getAttribute("data-brush-inner-radius")),
        outer: Number(cell.getAttribute("data-brush-outer-radius")),
        arc: Number(cell.getAttribute("data-brush-arc-length")),
        end: Number(cell.getAttribute("data-brush-end-angle")),
        angle: Number(cell.getAttribute("data-brush-cell-angle")),
        family: cell.getAttribute("data-brush-family"),
        icon: cell.querySelector("svg.lucide") !== null,
      }));
      const byTrack = new Map<number, (typeof cells)[number][]>();
      for (const cell of cells) {
        byTrack.set(cell.track, [...(byTrack.get(cell.track) ?? []), cell]);
      }
      return {
        thicknesses: [...new Set(cells.map((cell) => cell.outer - cell.inner))],
        arcs: cells.map((cell) => cell.arc),
        angles: [...byTrack.keys()].sort().map((key) => byTrack.get(key)![0]!.angle),
        familiesWithIcons: cells.every((cell) => cell.icon),
        inners: [...byTrack.keys()].sort().map((key) => byTrack.get(key)![0]!.inner),
        outers: [...byTrack.keys()].sort().map((key) => byTrack.get(key)![0]!.outer),
        firstArcs: [...byTrack.keys()].sort().map((key) => byTrack.get(key)![0]!.arc),
        endAngles: [...byTrack.keys()].sort().map((key) => byTrack.get(key)!.at(-1)!.end),
      };
    });
    expect(geometry.thicknesses, "one shared radial height").toEqual([64]);
    for (let index = 1; index < geometry.inners.length; index += 1) {
      expect(geometry.inners[index], "tracks are contiguous").toBe(geometry.outers[index - 1]);
    }
    // Equal physical width everywhere, achieved by each track taking its own
    // angular span: inner tracks wider in angle, outer tracks narrower.
    for (const arc of geometry.arcs) {
      expect(arc, "every cell is the target physical width").toBeCloseTo(72, 1);
    }
    for (let index = 1; index < geometry.angles.length; index += 1) {
      expect(geometry.angles[index], "outer tracks take a smaller angle").toBeLessThan(
        geometry.angles[index - 1]!,
      );
    }
    expect(geometry.familiesWithIcons, "every cell carries a family glyph").toBe(true);

    // 7. Incomplete rings: staggered starts, staggered ends, and a real empty
    //    remainder on every track that is never justified away.
    expect(new Set(geometry.endAngles).size, "tracks end at different angles").toBe(
      geometry.endAngles.length,
    );
    const rings = await window.evaluate(() => {
      const parse = (value: string | null) =>
        (value ?? "")
          .split(" ")
          .filter((entry) => entry.length > 0)
          .map((entry) => {
            const [start, width] = entry.split(":");
            return { start: Number(start), width: Number(width) };
          });
      return [...document.querySelectorAll("[data-library-track]")].map((track) => ({
        capacity: Number(track.getAttribute("data-track-capacity")),
        cellAngle: Number(track.getAttribute("data-track-cell-angle")),
        blocked: parse(track.getAttribute("data-track-blocked")),
        allowed: parse(track.getAttribute("data-track-allowed")),
        cells: [...track.querySelectorAll("[data-brush-item]")].map((cell) => ({
          start: Number(cell.getAttribute("data-brush-start-angle")),
          angle: Number(cell.getAttribute("data-brush-cell-angle")),
        })),
      }));
    });

    // Gaps accumulate outward: each ring is blocked by every inner ring's gap.
    expect(rings.map((ring) => ring.blocked.length)).toEqual([1, 2, 3, 3]);
    expect(rings.map((ring) => ring.allowed.length)).toEqual([1, 2, 3, 3]);
    expect(rings.map((ring) => ring.capacity)).toEqual([10, 13, 15, 20]);

    // An inherited gap keeps exactly the same angles on every outer ring.
    const innermostGap = rings[0]!.blocked[0]!;
    for (const ring of rings.slice(1)) {
      const carried = ring.blocked.find((gap) => Math.abs(gap.start - innermostGap.start) < 0.01);
      expect(carried, "ring 1's gap survives outward").toBeDefined();
      expect(carried!.width).toBeCloseTo(innermostGap.width, 1);
    }

    // No cell anywhere may overlap any blocked interval on its own ring.
    const overlaps = (aStart: number, aWidth: number, bStart: number, bWidth: number): boolean => {
      const norm = (value: number) => ((value % 360) + 360) % 360;
      return norm(bStart - aStart) + 0.01 < aWidth && norm(aStart - bStart) + 0.01 < bWidth;
    };
    for (const [index, ring] of rings.entries()) {
      for (const cell of ring.cells) {
        for (const blocked of ring.blocked) {
          expect(
            overlaps(cell.start, cell.angle, blocked.start, blocked.width),
            `ring ${index} cell at ${cell.start} vs gap at ${blocked.start}`,
          ).toBe(false);
        }
      }
    }

    // 8. Cells really are annular sectors: two arcs, not rotated rectangles.
    const firstPath = await window.locator("[data-brush-cell]").first().getAttribute("d");
    expect(firstPath?.match(/A /gu)).toHaveLength(2);
    await expect(window.locator("[data-brush-cell]")).toHaveCount(45);

    // 9. The dock and the property rail stay above the library.
    const layering = await window.evaluate(() => {
      const zIndex = (selector: string) => {
        const element = document.querySelector(selector);
        return element === null ? null : getComputedStyle(element).zIndex;
      };
      return {
        libraryZ: zIndex('[data-testid="radial-brush-library"]'),
        dockZ: zIndex("[data-tool-dock-layout]"),
        railZ: zIndex('[data-testid="drawing-property-rail-anchor"]'),
      };
    });
    expect(Number(layering.libraryZ)).toBeLessThan(Number(layering.dockZ));
    expect(Number(layering.libraryZ)).toBeLessThan(Number(layering.railZ));
    // And the dock really receives the pointer where the two overlap.
    const dockBox = (await dock.boundingBox())!;
    const overDock = await window.evaluate(
      (point) => {
        const element = document.elementFromPoint(point.x, point.y);
        return element?.closest("[data-tool-dock-layout]") !== null;
      },
      { x: dockBox.x + dockBox.width / 2, y: dockBox.y + 20 },
    );
    expect(overDock, "dock takes the pointer above the library").toBe(true);

    // 10. Switching the active drawing slot relocates the origin.
    await slot("Marker").click();
    await expect(library).toHaveCount(0);
    await slot("Marker").click({ modifiers: ["Shift"] });
    await waitForOpen(window);
    await expect(library).toHaveAttribute("data-library-anchor-slot", "marker");
    await expectCenteredOnSlot(window, "marker");
    const pencilCenter = await slotCenterY(window, "pencil");
    const markerCenter = await slotCenterY(window, "marker");
    expect(markerCenter).toBeGreaterThan(pencilCenter);

    // 11. Every utility tool closes it.
    for (const utility of ["Select", "Eraser", "Shapes"] as const) {
      await slot("Pencil").click();
      await slot("Pencil").click({ modifiers: ["Shift"] });
      await expect(library, `${utility} setup`).toBeVisible();
      await waitForOpen(window);
      await slot(utility).click();
      await expect(library, `${utility} closes the library`).toHaveCount(0);
    }

    // 12. None of this reaches the document or its History.
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");

    // 13. Fixtures carry their name and their family glyph, and no cell opens
    //      in a selected state: brush selection is a later task.
    await slot("Pencil").click();
    await slot("Pencil").click({ modifiers: ["Shift"] });
    await expect(library).toBeVisible();
    await waitForOpen(window);
    await expect(library.locator('[data-brush-item="watercolor"]')).toHaveAttribute(
      "aria-label",
      "Watercolor",
    );
    await expect(library.locator("[data-brush-inspected]")).toHaveCount(0);
    const glyphFamilies = await window.evaluate(() => {
      const iconOf = (id: string) => {
        const cell = document.querySelector(`[data-brush-item="${id}"] svg.lucide`);
        return cell?.getAttribute("class")?.match(/lucide-[a-z-]+/u)?.[0] ?? null;
      };
      return { pencil: iconOf("hb"), pen: iconOf("fineliner"), brush: iconOf("watercolor") };
    });
    expect(glyphFamilies.pencil).not.toBeNull();
    // Three distinct family glyphs, one per family.
    expect(new Set(Object.values(glyphFamilies)).size).toBe(3);
    await expect(surface).toHaveAttribute("data-history-undo-depth", "0");
    await expect(surface).toHaveAttribute("data-document-object-count", "0");
    await expect(surface).toHaveAttribute("data-drawing-brush-family", "pencil");

    // 14. The canvas still draws normally once the library is closed.
    await slot("Pencil").click({ modifiers: ["Shift"] });
    await expect(library).toHaveCount(0);
    const inkCanvas = window.locator('canvas[data-folio-layer="ink"]');
    const bounds = (await inkCanvas.boundingBox())!;
    await window.mouse.move(bounds.x + 760, bounds.y + 300);
    await window.mouse.down();
    await window.mouse.move(bounds.x + 900, bounds.y + 360, { steps: 8 });
    await window.mouse.up();
    await expect(surface).toHaveAttribute("data-document-object-count", "1");
    await expect(surface).toHaveAttribute("data-history-undo-depth", "1");

    // 15. The approved dock and property rail are unchanged by any of it.
    await expect(dock.locator("button[data-dock-slot]")).toHaveCount(8);
    await expect(rail).toBeVisible();
    await expect(rail.locator("button[data-property-key]")).toHaveCount(4);

    expect(consoleErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

async function slotCenterY(window: Page, slotId: string): Promise<number> {
  return window.evaluate((id) => {
    const slot = document.querySelector(`button[data-dock-slot="${id}"]`);
    const rect = slot!.getBoundingClientRect();
    return rect.top + rect.height / 2;
  }, slotId);
}

/** The library's reported centre must be the slot's centre, in workspace space. */
async function expectCenteredOnSlot(window: Page, slotId: string): Promise<void> {
  const measured = await window.evaluate((id) => {
    const slot = document.querySelector(`button[data-dock-slot="${id}"]`);
    const workspace = document.querySelector('[data-testid="editor-workspace"]');
    const library = document.querySelector('[data-testid="radial-brush-library"]');
    const slotRect = slot!.getBoundingClientRect();
    const workspaceRect = workspace!.getBoundingClientRect();
    return {
      expectedX: slotRect.left + slotRect.width / 2 - workspaceRect.left,
      expectedY: slotRect.top + slotRect.height / 2 - workspaceRect.top,
      reportedX: Number(library!.getAttribute("data-library-center-x")),
      reportedY: Number(library!.getAttribute("data-library-center-y")),
    };
  }, slotId);
  expect(measured.reportedX, `${slotId} centre x`).toBeCloseTo(measured.expectedX, 0);
  expect(measured.reportedY, `${slotId} centre y`).toBeCloseTo(measured.expectedY, 0);
}

/** Waits for the instrument to finish unfolding, so geometry is measurable. */
async function waitForOpen(window: Page): Promise<void> {
  await expect(window.getByTestId("radial-brush-library")).toHaveAttribute(
    "data-library-phase",
    "open",
  );
}
