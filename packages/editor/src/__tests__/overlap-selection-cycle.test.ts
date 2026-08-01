import { describe, expect, it } from "vitest";
import { OverlapSelectionCycle } from "../OverlapSelectionCycle";

describe("OverlapSelectionCycle", () => {
  it("previews without selecting and starts beneath the current overlapping selection", () => {
    const cycle = new OverlapSelectionCycle();

    expect(cycle.preview(["top", "middle", "bottom"], "top")).toBe("middle");
    expect(cycle.preview(["top", "middle", "bottom"], "top")).toBe("middle");
  });

  it("commits the preview and advances deterministically for repeated Alt-clicks", () => {
    const cycle = new OverlapSelectionCycle();
    const candidates = ["top", "middle", "bottom"] as const;

    expect(cycle.commit(candidates, "top")).toBe("middle");
    expect(cycle.preview(candidates, "middle")).toBe("bottom");
    expect(cycle.commit(candidates, "middle")).toBe("bottom");
    expect(cycle.commit(candidates, "bottom")).toBe("top");
  });

  it("starts at the top-most candidate and resets when the overlap set changes", () => {
    const cycle = new OverlapSelectionCycle();

    expect(cycle.preview(["top", "bottom"], null)).toBe("top");
    expect(cycle.commit(["top", "bottom"], null)).toBe("top");
    expect(cycle.preview(["new-top", "new-bottom"], "top")).toBe("new-top");
    cycle.reset();
    expect(cycle.preview(["top", "bottom"], "bottom")).toBe("top");
  });
});
