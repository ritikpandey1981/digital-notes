import { describe, expect, it } from "vitest";
import { DirtyTracker } from "../dirty-tracker";
import { buildNotebook } from "./helpers";

describe("DirtyTracker", () => {
  it("tracks metadata, sections, pages, and status transitions", () => {
    const tracker = new DirtyTracker();
    expect(tracker.status).toBe("saved");

    tracker.markMetadata();
    tracker.markSection("section-1");
    tracker.markPage("page-1");
    expect(tracker.status).toBe("dirty");
    expect(tracker.snapshot()).toEqual({
      revision: 5,
      entries: [
        { target: { kind: "metadata" }, revision: 5 },
        { target: { kind: "section", id: "section-1" }, revision: 2 },
        { target: { kind: "page", id: "page-1" }, revision: 4 },
      ],
    });

    const snapshot = tracker.beginSave();
    expect(tracker.status).toBe("saving");
    tracker.completeSave(snapshot);
    expect(tracker.status).toBe("saved");
  });

  it("does not clear work dirtied while a save is in progress", () => {
    const tracker = new DirtyTracker();
    tracker.markPage("page-1");
    const snapshot = tracker.beginSave();
    tracker.markPage("page-2");
    tracker.completeSave(snapshot);

    expect(tracker.status).toBe("dirty");
    expect(tracker.snapshot().entries.map(({ target }) => target)).toEqual([
      { kind: "metadata" },
      { kind: "page", id: "page-2" },
    ]);
  });

  it("returns to dirty after a failed save and supports all-dirty and clear", () => {
    const tracker = new DirtyTracker();
    tracker.markAll(buildNotebook());
    const snapshot = tracker.beginSave();
    expect(snapshot.entries.length).toBeGreaterThan(1);
    tracker.failSave();
    expect(tracker.status).toBe("dirty");
    tracker.clear();
    expect(tracker.status).toBe("saved");
  });
});
