import { describe, expect, it, vi } from "vitest";
import { createContinuousColorTarget, createHistoryFreeColorTarget } from "./color-target-adapters";

describe("Phase 18B ColorTargetAdapter implementations", () => {
  it.each(["Pencil", "Pen", "Marker", "Highlighter", "Shapes"] as const)(
    "previews, commits, and cancels %s without changing another creation owner",
    (label) => {
      let targetColor = "#111111";
      const otherOwnerColor = "#dc2626";
      const setTargetColor = vi.fn((color: string) => {
        targetColor = color;
      });
      const target = createHistoryFreeColorTarget({
        id: `creation-${label.toLowerCase()}`,
        label: `${label} Color`,
        getColor: () => targetColor,
        setColor: setTargetColor,
      });

      expect(target.begin()).toBe(true);
      expect(target.preview("#2563EB")).toBe(true);
      expect(targetColor).toBe("#2563eb");
      expect(otherOwnerColor).toBe("#dc2626");
      expect(target.cancel()).toBe(true);
      expect(targetColor).toBe("#111111");

      expect(target.begin()).toBe(true);
      target.preview("#16a34a");
      expect(target.commit()).toBe(true);
      expect(targetColor).toBe("#16a34a");
      expect(setTargetColor).toHaveBeenCalledTimes(3);
    },
  );

  it("delegates selected-vector color to exactly one continuous History transaction", () => {
    let color = "#111111";
    const begin = vi.fn(() => true);
    const preview = vi.fn((next: string) => {
      color = next;
      return true;
    });
    const commit = vi.fn(() => true);
    const cancel = vi.fn(() => true);
    const target = createContinuousColorTarget({
      id: "selected-vector-shape-1",
      label: "Rectangle Color",
      getColor: () => color,
      beginContinuousEdit: begin,
      previewContinuousEdit: preview,
      commitContinuousEdit: commit,
      cancelContinuousEdit: cancel,
    });

    expect(target.begin()).toBe(true);
    expect(target.preview("#DC2626")).toBe(true);
    expect(target.preview("#2563EB")).toBe(true);
    expect(target.commit()).toBe(true);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });
});
