import { describe, expect, it } from "vitest";
import {
  DOCK_SLOT_ORDER,
  DRAWING_SLOTS,
  UTILITY_SLOTS,
  dockSlotById,
  resolveActiveDockSlotId,
  resolveDockKeyboardTarget,
  resolveTabbableDockSlotId,
} from "./tool-dock-model";

describe("tool dock composition", () => {
  it("holds exactly five drawing slots and three utilities", () => {
    expect(DRAWING_SLOTS).toHaveLength(5);
    expect(UTILITY_SLOTS).toHaveLength(3);
  });

  it("keeps the utilities in their fixed order", () => {
    expect(UTILITY_SLOTS.map(({ label }) => label)).toEqual(["Select", "Eraser", "Shapes"]);
  });

  it("traverses drawing slots before utilities", () => {
    expect(DOCK_SLOT_ORDER).toEqual([
      "pencil",
      "pen",
      "brush-pen",
      "marker",
      "highlighter",
      "select",
      "eraser",
      "shapes",
    ]);
  });

  it("gives every slot a unique id and a unique accessible name", () => {
    const slots = [...DRAWING_SLOTS, ...UTILITY_SLOTS];
    expect(new Set(slots.map(({ id }) => id)).size).toBe(slots.length);
    expect(new Set(slots.map(({ label }) => label)).size).toBe(slots.length);
  });

  it("activates only tools the editor already defines", () => {
    expect([...DRAWING_SLOTS, ...UTILITY_SLOTS].map(({ tool }) => tool)).toEqual([
      "Pencil",
      "Pen",
      "Pen",
      "Marker",
      "Highlighter",
      "Select",
      "Eraser",
      "Shapes",
    ]);
  });

  it("pins a preset only where a family hosts more than one slot", () => {
    const slotsPerFamily = new Map<string, number>();
    for (const slot of DRAWING_SLOTS) {
      slotsPerFamily.set(slot.family, (slotsPerFamily.get(slot.family) ?? 0) + 1);
    }
    for (const slot of DRAWING_SLOTS) {
      const shared = (slotsPerFamily.get(slot.family) ?? 0) > 1;
      expect(slot.presetId === null, `${slot.label} pinning`).toBe(!shared);
    }
  });

  it("gives every shared-family slot a distinct preset so no two slots draw alike", () => {
    const pinned = DRAWING_SLOTS.filter((slot) => slot.presetId !== null);
    expect(pinned.map(({ presetId }) => presetId)).toEqual(["pen-fineliner", "pen-brush"]);
    expect(new Set(pinned.map(({ presetId }) => presetId)).size).toBe(pinned.length);
  });

  it("looks slots up by id from either group", () => {
    expect(dockSlotById("brush-pen")?.label).toBe("Brush Pen");
    expect(dockSlotById("shapes")?.label).toBe("Shapes");
    expect(dockSlotById("nothing")).toBeNull();
  });
});

describe("active dock slot resolution", () => {
  it("activates the drawing slot matching the active tool", () => {
    expect(resolveActiveDockSlotId("Pencil", null)).toBe("pencil");
    expect(resolveActiveDockSlotId("Marker", null)).toBe("marker");
    expect(resolveActiveDockSlotId("Highlighter", null)).toBe("highlighter");
  });

  it("separates two slots sharing one tool by the slot last chosen", () => {
    expect(resolveActiveDockSlotId("Pen", "brush-pen")).toBe("brush-pen");
    expect(resolveActiveDockSlotId("Pen", "pen")).toBe("pen");
  });

  it("falls back to the first slot of a shared tool", () => {
    expect(resolveActiveDockSlotId("Pen", null)).toBe("pen");
    expect(resolveActiveDockSlotId("Pen", "marker")).toBe("pen");
  });

  it("lets a utility own the active presentation outright", () => {
    // The remembered drawing slot must not keep a drawing button lit while a
    // utility is the active tool.
    for (const utility of UTILITY_SLOTS) {
      expect(resolveActiveDockSlotId(utility.tool, "brush-pen")).toBe(utility.id);
    }
  });

  it("never reports two active slots for one tool", () => {
    for (const slot of [...DRAWING_SLOTS, ...UTILITY_SLOTS]) {
      const active = resolveActiveDockSlotId(slot.tool, slot.id);
      const matches = [...DRAWING_SLOTS, ...UTILITY_SLOTS].filter(({ id }) => id === active);
      expect(matches).toHaveLength(1);
    }
  });

  it("reports no active slot for a tool the dock does not present", () => {
    expect(resolveActiveDockSlotId("Text", null)).toBeNull();
    expect(resolveActiveDockSlotId("Move", "pencil")).toBeNull();
  });
});

describe("dock keyboard model", () => {
  it("keeps the toolbar reachable when nothing in it is active", () => {
    expect(resolveTabbableDockSlotId(null)).toBe("pencil");
    expect(resolveTabbableDockSlotId("eraser")).toBe("eraser");
  });

  it("moves across the capsule boundary in both directions", () => {
    expect(resolveDockKeyboardTarget("highlighter", "ArrowDown")).toBe("select");
    expect(resolveDockKeyboardTarget("select", "ArrowUp")).toBe("highlighter");
  });

  it("treats horizontal arrows as the vertical equivalent", () => {
    expect(resolveDockKeyboardTarget("pencil", "ArrowRight")).toBe("pen");
    expect(resolveDockKeyboardTarget("pen", "ArrowLeft")).toBe("pencil");
  });

  it("jumps to either end", () => {
    expect(resolveDockKeyboardTarget("marker", "Home")).toBe("pencil");
    expect(resolveDockKeyboardTarget("marker", "End")).toBe("shapes");
  });

  it("stops at the ends instead of wrapping", () => {
    expect(resolveDockKeyboardTarget("pencil", "ArrowUp")).toBeNull();
    expect(resolveDockKeyboardTarget("shapes", "ArrowDown")).toBeNull();
  });

  it("ignores keys the toolbar does not own", () => {
    expect(resolveDockKeyboardTarget("pencil", "Enter")).toBeNull();
    expect(resolveDockKeyboardTarget("pencil", "a")).toBeNull();
    expect(resolveDockKeyboardTarget(null, "ArrowDown")).toBeNull();
  });
});
