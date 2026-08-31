import { DEFAULT_BRUSH_PRESETS } from "@folio/editor";
import { describe, expect, it } from "vitest";
import {
  BRUSH_LIBRARY_CATALOGUE,
  DEFAULT_SLOT_BRUSH_IDS,
  assignmentForBrush,
  brushLibraryEntryById,
  catalogueIsFullyBacked,
  referencedFallbackPresetIds,
} from "./brush-library-catalogue";
import { buildRadialLibraryLayout } from "./radial-brush-library-model";
import { DRAWING_SLOTS } from "./tool-dock-model";

describe("provisional brush catalogue", () => {
  it("holds exactly forty-five identities", () => {
    expect(BRUSH_LIBRARY_CATALOGUE).toHaveLength(45);
  });

  it("uses only the families the engine has presets for", () => {
    // No watercolour, pastel, chalk or airbrush: those name behaviour the
    // renderer does not have, and putting them in the wheel would promise it.
    const families = new Set(BRUSH_LIBRARY_CATALOGUE.map((item) => item.family));
    expect([...families].sort()).toEqual(["marker", "pen", "pencil"]);
  });

  it("names nothing the engine cannot back", () => {
    const forbidden =
      /watercolou?r|pastel|chalk|charcoal|airbrush|spray|gouache|wash|stipple|grain|blend/iu;
    for (const item of BRUSH_LIBRARY_CATALOGUE) {
      expect(item.name, `${item.id} claims unsupported behaviour`).not.toMatch(forbidden);
    }
  });

  it("gives every identity a stable id, name and fallback", () => {
    for (const item of BRUSH_LIBRARY_CATALOGUE) {
      expect(item.id).toMatch(/^[a-z0-9-]+$/u);
      expect(item.name.trim().length).toBeGreaterThan(0);
      expect(item.fallbackPresetId.trim().length).toBeGreaterThan(0);
      expect(Object.isFrozen(item)).toBe(true);
    }
    const ids = BRUSH_LIBRARY_CATALOGUE.map((item) => item.id);
    expect(new Set(ids).size, "ids are unique").toBe(ids.length);
    const names = BRUSH_LIBRARY_CATALOGUE.map((item) => item.name);
    expect(new Set(names).size, "names are unique").toBe(names.length);
  });

  it("backs every identity with a real preset of the same family", () => {
    expect(catalogueIsFullyBacked()).toBe(true);
    for (const item of BRUSH_LIBRARY_CATALOGUE) {
      const preset = DEFAULT_BRUSH_PRESETS.find(({ id }) => id === item.fallbackPresetId);
      expect(preset, `${item.id} has no backing preset`).toBeDefined();
      expect(preset!.family).toBe(item.family);
    }
  });

  it("refuses a catalogue whose backing does not exist", () => {
    // The guard that stops a typo reaching the wheel claiming a real preset.
    expect(catalogueIsFullyBacked([])).toBe(false);
    expect(
      catalogueIsFullyBacked(DEFAULT_BRUSH_PRESETS.filter(({ id }) => id !== "pencil-hb")),
    ).toBe(false);
  });

  it("is honest that identities outnumber backings", () => {
    // Stated as a test rather than a comment: forty-five identities share nine
    // presets, so several brushes draw identically today. That is the known,
    // intended provisional state, not an accident to be papered over.
    const backings = referencedFallbackPresetIds();
    expect(backings.length).toBeLessThan(BRUSH_LIBRARY_CATALOGUE.length);
    expect(backings.length).toBe(9);
  });

  it("is a fixed sequence, never generated", () => {
    // Two reads must be the same objects in the same order: nothing here is
    // shuffled at import time or per session.
    const first = BRUSH_LIBRARY_CATALOGUE.map((item) => item.id);
    const second = BRUSH_LIBRARY_CATALOGUE.map((item) => item.id);
    expect(second).toEqual(first);
    expect(first[0]).toBe("hb-pencil");
    expect(first[44]).toBe("flat-marker");
    expect(Object.isFrozen(BRUSH_LIBRARY_CATALOGUE)).toBe(true);
  });

  it("interleaves families rather than running them in blocks", () => {
    // A strict pencils-then-pens-then-markers order would hand ring 1 to the
    // pencils outright and make the wheel read as a taxonomy diagram.
    const layout = buildRadialLibraryLayout({ x: 0, y: 0 });
    for (const track of layout.tracks) {
      const families = new Set(track.cells.map((cell) => cell.brush.family));
      expect(families.size, `ring ${track.index} mixes families`).toBeGreaterThan(1);
    }
    expect(layout.cells).toHaveLength(45);
  });

  it("looks an identity up by id, and reports an unknown one as absent", () => {
    expect(brushLibraryEntryById("gel-pen")?.name).toBe("Gel Pen");
    expect(brushLibraryEntryById("no-such-brush")).toBeNull();
    expect(brushLibraryEntryById(null)).toBeNull();
  });

  it("produces an assignment only for a real identity", () => {
    expect(assignmentForBrush("gel-pen")).toEqual({
      brushId: "gel-pen",
      family: "pen",
      fallbackPresetId: "pen-fineliner",
    });
    expect(assignmentForBrush("watercolor")).toBeNull();
  });
});

describe("slot starting identities", () => {
  it("names an identity matching each slot's seeded family", () => {
    for (const slot of DRAWING_SLOTS) {
      const brushId = DEFAULT_SLOT_BRUSH_IDS[slot.id] ?? null;
      if (brushId === null) continue;
      const item = brushLibraryEntryById(brushId);
      expect(item, `${slot.id} starts on a real identity`).not.toBeNull();
      expect(item!.family).toBe(slot.family);
    }
  });

  it("leaves the fifth slot holding no identity to begin with", () => {
    // It is seeded as the Highlighter, whose family has no catalogue entries.
    // That is a starting state only: every one of the 45 brushes can be
    // assigned to it, exactly as to any other slot.
    expect(DEFAULT_SLOT_BRUSH_IDS.highlighter).toBeNull();
  });

  it("offers every identity to every slot", () => {
    // A drawing slot is a stable physical position that owns preferences, not
    // a fixed tool, so nothing in the catalogue is off-limits to any slot.
    for (const slot of DRAWING_SLOTS) {
      for (const item of BRUSH_LIBRARY_CATALOGUE) {
        const assignment = assignmentForBrush(item.id);
        expect(assignment, `${item.id} -> ${slot.id}`).not.toBeNull();
        expect(assignment!.family).toBe(item.family);
      }
    }
  });

  it("starts each slot on the preset the dock already pinned it to", () => {
    for (const slot of DRAWING_SLOTS) {
      const brushId = DEFAULT_SLOT_BRUSH_IDS[slot.id] ?? null;
      if (brushId === null || slot.presetId === null) continue;
      expect(brushLibraryEntryById(brushId)!.fallbackPresetId).toBe(slot.presetId);
    }
  });
});
