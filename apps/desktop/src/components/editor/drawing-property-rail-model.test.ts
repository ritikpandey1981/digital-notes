import { createBrushToolStateStore, type ResolvedDrawingBrush } from "@folio/editor";
import { describe, expect, it } from "vitest";
import {
  UNAVAILABLE_VALUE_TEXT,
  formatPercentage,
  formatWidth,
  isDrawingPropertyTool,
  resolveDrawingPropertyRail,
  supportsSmoothing,
} from "./drawing-property-rail-model";
import { DRAWING_SLOTS, UTILITY_SLOTS } from "./tool-dock-model";
import type { EditorTool } from "./editor-types";

/** The real store, so the rail is proven against canonical brush state. */
function resolvedBrush(family: "pencil" | "pen" | "marker" | "highlighter"): ResolvedDrawingBrush {
  return createBrushToolStateStore().resolvedBrush(family);
}

function railFor(tool: EditorTool, family: "pencil" | "pen" | "marker" | "highlighter") {
  return resolveDrawingPropertyRail({ tool, brush: resolvedBrush(family), color: null });
}

describe("drawing property rail visibility", () => {
  it("belongs to every tool that owns a drawing preset slot", () => {
    for (const slot of DRAWING_SLOTS) {
      expect(isDrawingPropertyTool(slot.tool), slot.label).toBe(true);
    }
  });

  it("never presents drawing properties for a utility tool", () => {
    for (const utility of UTILITY_SLOTS) {
      expect(isDrawingPropertyTool(utility.tool), utility.label).toBe(false);
      expect(
        resolveDrawingPropertyRail({
          tool: utility.tool,
          brush: resolvedBrush("pen"),
          color: "#111111",
        }),
        utility.label,
      ).toBeNull();
    }
  });

  it("returns nothing without a resolved brush", () => {
    expect(resolveDrawingPropertyRail({ tool: "Pencil", brush: null, color: null })).toBeNull();
    expect(
      resolveDrawingPropertyRail({ tool: "Pencil", brush: undefined, color: null }),
    ).toBeNull();
  });
});

describe("drawing property rail composition", () => {
  it("exposes exactly four controls in the fixed order", () => {
    const rail = railFor("Pencil", "pencil");
    expect(rail?.controls.map(({ key }) => key)).toEqual([
      "strokeWidth",
      "opacity",
      "smoothing",
      "strokeColor",
    ]);
  });

  it("reads canonical width, opacity and smoothing from the brush store", () => {
    const brush = resolvedBrush("pencil");
    const rail = resolveDrawingPropertyRail({ tool: "Pencil", brush, color: null });
    const [width, opacity, smoothing] = rail?.controls ?? [];
    expect(width?.value).toBe(brush.size);
    expect(opacity?.value).toBe(brush.opacity);
    expect(smoothing?.value).toBe(brush.smoothing.amount);
  });

  it("reflects the active preset when the brush changes", () => {
    const store = createBrushToolStateStore();
    const before = resolveDrawingPropertyRail({
      tool: "Pen",
      brush: store.resolvedBrush("pen"),
      color: null,
    });
    store.selectPreset("pen", "pen-brush");
    const after = resolveDrawingPropertyRail({
      tool: "Pen",
      brush: store.resolvedBrush("pen"),
      color: null,
    });
    expect(after?.controls[0]?.value).not.toBe(before?.controls[0]?.value);
    expect(after?.controls[0]?.value).toBe(store.resolvedBrush("pen").size);
  });

  it("prefers the colour target's value over the brush's own colour", () => {
    const brush = resolvedBrush("pencil");
    const rail = resolveDrawingPropertyRail({ tool: "Pencil", brush, color: "#ab12cd" });
    expect(rail?.controls[3]?.value).toBe("#ab12cd");
  });

  it("falls back to the brush colour when no target is active", () => {
    const brush = resolvedBrush("marker");
    const rail = resolveDrawingPropertyRail({ tool: "Marker", brush, color: null });
    expect(rail?.controls[3]?.value).toBe(brush.color);
  });

  it("marks smoothing unavailable for the Highlighter and available elsewhere", () => {
    expect(supportsSmoothing("Highlighter")).toBe(false);
    const highlighter = railFor("Highlighter", "highlighter");
    const smoothing = highlighter?.controls.find(({ key }) => key === "smoothing");
    expect(smoothing?.available).toBe(false);
    expect(smoothing?.accessibleLabel).toContain("unavailable");
    for (const [tool, family] of [
      ["Pencil", "pencil"],
      ["Pen", "pen"],
      ["Marker", "marker"],
    ] as const) {
      const rail = railFor(tool, family);
      expect(rail?.controls.find(({ key }) => key === "smoothing")?.available, tool).toBe(true);
    }
  });

  it("names every control with its current value for assistive technology", () => {
    const rail = resolveDrawingPropertyRail({
      tool: "Pencil",
      brush: resolvedBrush("pencil"),
      color: "#343434",
    });
    const labels = rail?.controls.map(({ accessibleLabel }) => accessibleLabel) ?? [];
    expect(labels[0]).toMatch(/^Stroke width [\d.]+ px\./u);
    expect(labels[1]).toMatch(/^Opacity \d+%\./u);
    expect(labels[2]).toMatch(/^Smoothness \d+%\./u);
    expect(labels[3]).toBe("Current color #343434. Open full color picker");
  });

  it("remaps the Highlighter's opacity onto its displayed scale", () => {
    // The model ceiling is 0.45; the spoken value must still read as a full
    // scale, exactly as the tool options panel presents it.
    const brush = resolvedBrush("highlighter");
    const rail = resolveDrawingPropertyRail({ tool: "Highlighter", brush, color: null });
    const opacity = rail?.controls[1];
    expect(opacity?.value).toBe(brush.opacity);
    expect(opacity?.accessibleLabel).not.toContain(`${Math.round(brush.opacity * 100)}%`);
  });
});

describe("drawing property value formatting", () => {
  it("prints whole widths without a decimal and fractional widths with one", () => {
    expect(formatWidth(2)).toBe("2 px");
    expect(formatWidth(10)).toBe("10 px");
    expect(formatWidth(0.5)).toBe("0.5 px");
    expect(formatWidth(29.4)).toBe("29.4 px");
    expect(formatWidth(40)).toBe("40 px");
  });

  it("rounds display width to one decimal without touching the canonical value", () => {
    const brush = resolvedBrush("pencil");
    const rail = resolveDrawingPropertyRail({ tool: "Pencil", brush, color: null });
    expect(formatWidth(29.44)).toBe("29.4 px");
    // The printed value rounds; the value the canvas draws with does not.
    expect(rail?.controls[0]?.value).toBe(brush.size);
  });

  it("prints 0–1 parameters as whole percentages", () => {
    expect(formatPercentage(0)).toBe("0%");
    expect(formatPercentage(0.18)).toBe("18%");
    expect(formatPercentage(1)).toBe("100%");
  });

  it("prints a display value for each parameter and none for the colour", () => {
    const rail = railFor("Pencil", "pencil");
    const brush = resolvedBrush("pencil");
    expect(rail?.controls[0]?.displayValue).toBe(formatWidth(brush.size));
    expect(rail?.controls[1]?.displayValue).toBe(formatPercentage(brush.opacity));
    expect(rail?.controls[2]?.displayValue).toBe(formatPercentage(brush.smoothing.amount));
    expect(rail?.controls[3]?.displayValue).toBeNull();
  });

  it("prints the Highlighter's opacity on its remapped display scale", () => {
    const brush = resolvedBrush("highlighter");
    const rail = resolveDrawingPropertyRail({ tool: "Highlighter", brush, color: null });
    // 0.34 sits most of the way up a 0.45 ceiling, so it reads as 72%, not 34%.
    expect(brush.opacity).toBeCloseTo(0.34, 5);
    expect(rail?.controls[1]?.displayValue).not.toBe(formatPercentage(brush.opacity));
    expect(rail?.controls[1]?.displayValue).toBe("72%");
  });

  it("prints a dash rather than inventing a number for unavailable smoothing", () => {
    const rail = railFor("Highlighter", "highlighter");
    const smoothing = rail?.controls.find(({ key }) => key === "smoothing");
    expect(smoothing?.available).toBe(false);
    expect(smoothing?.displayValue).toBe(UNAVAILABLE_VALUE_TEXT);
    expect(smoothing?.displayValue).not.toMatch(/\d/u);
  });

  it("updates printed values when the active preset changes", () => {
    const store = createBrushToolStateStore();
    const before = resolveDrawingPropertyRail({
      tool: "Pen",
      brush: store.resolvedBrush("pen"),
      color: null,
    });
    store.selectPreset("pen", "pen-brush");
    const after = resolveDrawingPropertyRail({
      tool: "Pen",
      brush: store.resolvedBrush("pen"),
      color: null,
    });
    expect(after?.controls[0]?.displayValue).not.toBe(before?.controls[0]?.displayValue);
    expect(after?.controls[0]?.displayValue).toBe(formatWidth(store.resolvedBrush("pen").size));
  });
});
