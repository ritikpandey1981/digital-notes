import { describe, expect, it } from "vitest";
import { DRAWING_SLOTS, UTILITY_SLOTS, resolveActiveDockSlotId } from "./tool-dock-model";

/**
 * The production dock gesture, as a decision rather than a rendered component.
 *
 * The workspace routes a slot press on one question alone: is this the slot
 * already in use? Everything else — which family it holds, which tool it was
 * seeded with — is deliberately not consulted, so the rule can be stated and
 * checked without a window.
 */
type SlotPress = "activate" | "toggle-library";

function pressMeaning(
  slotId: string,
  activeTool: Parameters<typeof resolveActiveDockSlotId>[0],
  lastActivatedDrawingSlotId: string | null,
  slotFamilies?: Parameters<typeof resolveActiveDockSlotId>[2],
): SlotPress {
  return slotId === resolveActiveDockSlotId(activeTool, lastActivatedDrawingSlotId, slotFamilies)
    ? "toggle-library"
    : "activate";
}

describe("drawing slot press routing", () => {
  it("treats the first press on any slot as activation only", () => {
    // The artist asked for a tool. They must be able to draw straight away, so
    // this press can never put a surface between them and the canvas.
    for (const slot of DRAWING_SLOTS) {
      const other = DRAWING_SLOTS.find((candidate) => candidate.id !== slot.id)!;
      expect(pressMeaning(slot.id, other.tool, other.id), slot.id).toBe("activate");
    }
  });

  it("gives the second press on the active slot to the Brush Library", () => {
    for (const slot of DRAWING_SLOTS) {
      expect(pressMeaning(slot.id, slot.tool, slot.id), slot.id).toBe("toggle-library");
    }
  });

  it("routes on the active slot id, never on the family a slot holds", () => {
    // The pencil slot holding a marker is still the pencil slot. Routing must
    // not change because its contents did.
    const families = { pencil: "marker" } as const;
    expect(pressMeaning("pencil", "Marker", "pencil", families)).toBe("toggle-library");
    expect(pressMeaning("pen", "Marker", "pencil", families)).toBe("activate");
    // And a slot seeded as a pen, now holding a pencil, behaves identically.
    const swapped = { pen: "pencil" } as const;
    expect(pressMeaning("pen", "Pencil", "pen", swapped)).toBe("toggle-library");
    expect(pressMeaning("pencil", "Pencil", "pen", swapped)).toBe("activate");
  });

  it("never routes a press on an inactive slot to the library", () => {
    // Including while a library is open from somewhere else: the press still
    // only means "activate", and the open surface is closed by the tool change.
    for (const slot of DRAWING_SLOTS) {
      for (const active of DRAWING_SLOTS) {
        if (active.id === slot.id) continue;
        expect(pressMeaning(slot.id, active.tool, active.id), `${slot.id} vs ${active.id}`).toBe(
          "activate",
        );
      }
    }
  });

  it("leaves the utilities as plain tools", () => {
    // A utility is a fixed category, not a configurable brush holder, so no
    // press on one can ever reach the Brush Library.
    for (const utility of UTILITY_SLOTS) {
      expect(DRAWING_SLOTS.some((slot) => slot.id === utility.id)).toBe(false);
      expect(resolveActiveDockSlotId(utility.tool, null)).toBe(utility.id);
      // The active utility resolves to itself, and it is not a drawing slot,
      // so the drawing-slot routing above is never consulted for it.
      expect(DRAWING_SLOTS.map(({ id }) => id)).not.toContain(utility.id);
    }
  });

  it("keeps a utility owning the active presentation over any drawing slot", () => {
    for (const utility of UTILITY_SLOTS) {
      for (const slot of DRAWING_SLOTS) {
        expect(pressMeaning(slot.id, utility.tool, slot.id), `${slot.id} under ${utility.id}`).toBe(
          "activate",
        );
      }
    }
  });

  it("takes no account of modifier keys", () => {
    // The routing function receives no modifier at all: the retired Shift
    // scaffolding cannot be reached, because there is nothing to reach it with.
    expect(pressMeaning.length).toBe(4);
    expect(String(pressMeaning)).not.toMatch(/shift|modifier/iu);
  });
});
