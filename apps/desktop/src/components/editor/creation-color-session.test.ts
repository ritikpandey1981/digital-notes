import { createDrawingSlotStore, type DrawingSlotDescriptor } from "@folio/editor";
import { describe, expect, it } from "vitest";
import { createHistoryFreeColorTarget } from "./color-target-adapters";
import { resolveCreationColorSession } from "./creation-color-session";

/** The five dock slots, described exactly as the workspace describes them. */
const SLOTS: readonly DrawingSlotDescriptor[] = Object.freeze([
  { id: "pencil", family: "pencil", presetId: null, brushId: "hb-pencil" },
  { id: "pen", family: "pen", presetId: "pen-fineliner", brushId: "fineliner" },
  { id: "brush-pen", family: "pen", presetId: "pen-brush", brushId: "brush-pen-soft" },
  { id: "marker", family: "marker", presetId: null, brushId: "felt-marker" },
  { id: "highlighter", family: "highlighter", presetId: null, brushId: null },
]);

/**
 * The workspace's creation-colour wiring, without a window.
 *
 * `slotColorTarget` reproduces `useEditorWorkspaceState`'s memoised target
 * exactly: one adapter per slot id, reading and writing only that slot. That is
 * the detail the bug turned on, so the harness must not smooth it over.
 */
function createHarness() {
  const store = createDrawingSlotStore(SLOTS);
  let openSession: {
    readonly targetId: string;
    readonly target: ReturnType<typeof slotTarget>;
  } | null = null;

  function slotTarget(slotId: string) {
    return createHistoryFreeColorTarget({
      id: `creation-${slotId}`,
      label: `${slotId} Color`,
      getColor: () => store.resolvedBrush(slotId).color,
      setColor: (color) => {
        store.updateProperties(slotId, { color });
      },
    });
  }

  return {
    store,
    colorOf: (slotId: string): string => store.resolvedBrush(slotId).color,
    /** Opens the picker against the currently active slot's creation target. */
    openPicker(slotId: string): void {
      const target = slotTarget(slotId);
      target.begin();
      openSession = { targetId: target.id, target };
    },
    preview(color: string): void {
      openSession?.target.preview(color);
    },
    /** Escape, window blur, or a genuinely vanished target. */
    abort(): void {
      openSession?.target.cancel();
      openSession = null;
    },
    /**
     * One deliberate ownership change, exactly as the workspace performs it:
     * resolve the open session against the outgoing creation target, then move.
     */
    switchTo(nextActiveSlotId: string | null, currentActiveSlotId: string): void {
      const resolution = resolveCreationColorSession(
        openSession?.targetId ?? null,
        `creation-${currentActiveSlotId}`,
      );
      if (resolution === "commit") {
        openSession?.target.commit();
        openSession = null;
      }
      void nextActiveSlotId;
    },
  };
}

describe("creation colour session resolution", () => {
  it("commits only the session belonging to the outgoing creation target", () => {
    expect(resolveCreationColorSession("creation-pen", "creation-pen")).toBe("commit");
    expect(
      resolveCreationColorSession("creation-shape-rectangle", "creation-shape-rectangle"),
    ).toBe("commit");
  });

  it("leaves a selected-object session entirely alone", () => {
    expect(
      resolveCreationColorSession("selected-vector-object-1", "creation-pen"),
      "an object session is never a creation session",
    ).toBe("none");
    expect(resolveCreationColorSession("selected-vector-object-1", null)).toBe("none");
  });

  it("has no opinion when there is no session or no creation target", () => {
    expect(resolveCreationColorSession(null, "creation-pen")).toBe("none");
    expect(resolveCreationColorSession("creation-pen", null)).toBe("none");
    expect(resolveCreationColorSession(null, null)).toBe("none");
  });

  it("never commits a stale session left over from another slot", () => {
    expect(
      resolveCreationColorSession("creation-pencil", "creation-marker"),
      "only the target actually losing ownership is resolved",
    ).toBe("none");
  });
});

describe("drawing slot colour persistence", () => {
  it("puts a preview into the active slot immediately, before any commit", () => {
    const harness = createHarness();
    harness.openPicker("pen");
    harness.preview("#ef4444");
    expect(harness.colorOf("pen")).toBe("#ef4444");
  });

  it("keeps an edited colour when the artist switches slots without drawing", () => {
    const harness = createHarness();
    harness.openPicker("pen");
    harness.preview("#ef4444");
    harness.switchTo("marker", "pen");
    expect(harness.colorOf("pen"), "no stroke is required").toBe("#ef4444");
    harness.switchTo("pen", "marker");
    expect(harness.colorOf("pen")).toBe("#ef4444");
  });

  it("keeps an edited colour when the artist switches to a utility tool", () => {
    for (const utility of ["Select", "Eraser", "Shapes"]) {
      const harness = createHarness();
      harness.openPicker("marker");
      harness.preview("#16a34a");
      // A utility owns no drawing slot, so the outgoing target is still the
      // drawing slot's; resolving before the tool changes is what saves it.
      harness.switchTo(null, "marker");
      expect(harness.colorOf("marker"), utility).toBe("#16a34a");
    }
  });

  it("still restores the original when the edit is genuinely aborted", () => {
    const harness = createHarness();
    const original = harness.colorOf("pen");
    harness.openPicker("pen");
    harness.preview("#ef4444");
    expect(harness.colorOf("pen")).toBe("#ef4444");
    harness.abort();
    expect(harness.colorOf("pen"), "cancel must keep restoring").toBe(original);
  });

  it("cannot revert a committed colour with a later abort", () => {
    const harness = createHarness();
    harness.openPicker("pen");
    harness.preview("#ef4444");
    harness.switchTo("marker", "pen");
    harness.abort();
    expect(harness.colorOf("pen"), "a resolved session owns nothing to restore").toBe("#ef4444");
  });

  it("gives all five slots independent colours across repeated switching", () => {
    const harness = createHarness();
    const colors = {
      pencil: "#ef4444",
      pen: "#2563eb",
      "brush-pen": "#16a34a",
      marker: "#000000",
      highlighter: "#eab308",
    } as const;
    for (const [slotId, color] of Object.entries(colors)) {
      harness.openPicker(slotId);
      harness.preview(color);
      harness.switchTo(null, slotId);
    }
    for (const order of [
      ["pencil", "brush-pen", "highlighter", "pen", "marker", "pencil"],
      ["marker", "pencil", "highlighter"],
    ]) {
      for (let index = 1; index < order.length; index += 1) {
        harness.switchTo(order[index]!, order[index - 1]!);
      }
    }
    expect(
      Object.fromEntries(Object.keys(colors).map((slotId) => [slotId, harness.colorOf(slotId)])),
    ).toEqual(colors);

    harness.openPicker("brush-pen");
    harness.preview("#7c3aed");
    harness.switchTo("pen", "brush-pen");
    expect(
      Object.fromEntries(Object.keys(colors).map((slotId) => [slotId, harness.colorOf(slotId)])),
    ).toEqual({ ...colors, "brush-pen": "#7c3aed" });
  });

  it("replaces only the edited slot's state object", () => {
    const harness = createHarness();
    const before = harness.store.snapshot().slots;
    harness.openPicker("marker");
    harness.preview("#ca8a04");
    harness.switchTo("pen", "marker");
    const after = harness.store.snapshot().slots;
    expect(after["marker"]).not.toBe(before["marker"]);
    for (const slotId of ["pencil", "pen", "brush-pen", "highlighter"]) {
      expect(after[slotId], slotId).toBe(before[slotId]);
    }
  });

  it("keeps the slot's colour when its brush changes family", () => {
    const harness = createHarness();
    harness.openPicker("pen");
    harness.preview("#ef4444");
    harness.switchTo("pen", "pen");
    harness.store.assignBrush("pen", {
      brushId: "felt-marker",
      family: "marker",
      fallbackPresetId: "marker-felt",
    });
    expect(harness.store.stateFor("pen").family, "the slot adopts the brush's family").toBe(
      "marker",
    );
    expect(harness.colorOf("pen"), "colour is the documented exception").toBe("#ef4444");
    harness.switchTo("marker", "pen");
    expect(harness.colorOf("pen")).toBe("#ef4444");
  });

  it("resolves an already-committed session as a no-op", () => {
    const harness = createHarness();
    harness.openPicker("pen");
    harness.preview("#ef4444");
    harness.switchTo("marker", "pen");
    harness.switchTo("pen", "marker");
    harness.switchTo("marker", "pen");
    expect(harness.colorOf("pen")).toBe("#ef4444");
    expect(harness.colorOf("marker"), "an unrelated slot is untouched").toBe(
      createHarness().colorOf("marker"),
    );
  });
});
