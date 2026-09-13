import { describe, expect, it } from "vitest";
import { Page, SketchbookDocument } from "../sketchbook-document";
import { DEFAULT_PAPER_COLOR, type PagePaper } from "../page-paper";

describe("page paper belongs to the page", () => {
  it("cannot be changed by whoever supplied it", () => {
    const supplied = { type: "grid" as const, color: "#ffffff", spacing: 24 };
    const page = new Page({ id: "page-1", paper: supplied });
    const observed = page.paper;

    // The caller still holds its own object and may do anything with it.
    (supplied as { color: string }).color = "#ff0000";
    (supplied as { spacing: number }).spacing = 400;
    (supplied as { type: string }).type = "dotted";

    expect(page.paper.color, "the page took the caller's object by reference").toBe("#ffffff");
    expect(page.paper.spacing).toBe(24);
    expect(page.paper.type).toBe("grid");
    expect(page.paper).toBe(observed);
  });

  it("cannot be changed by writing through what a page hands out", () => {
    const page = new Page({ id: "page-1", paper: { type: "ruled", color: "#eeeeee" } });
    expect(Object.isFrozen(page.paper), "page paper is a value, not a handle").toBe(true);
    expect(() => {
      (page.paper as { color: string }).color = "#000000";
    }).toThrow();
    expect(page.paper.color).toBe("#eeeeee");
  });

  it("keeps a captured sketchbook stable while the caller's object changes", () => {
    const supplied = { type: "dotted" as const, color: "#fbf3e0", spacing: 24 };
    const sketchbook = new SketchbookDocument({
      pages: [new Page({ id: "page-1", paper: supplied })],
    });
    const captured = sketchbook;

    (supplied as { color: string }).color = "#123456";

    expect(captured.firstPage.paper.color).toBe("#fbf3e0");
  });

  it("still replaces paper through the supported path", () => {
    const page = new Page({ id: "page-1" });
    expect(page.paper.color).toBe(DEFAULT_PAPER_COLOR);

    const next = page.withPaper({ type: "grid", color: "#ffffff" });
    expect(next).not.toBe(page);
    expect(next.paper.type).toBe("grid");
    expect(next.paper.color).toBe("#ffffff");
    // A patterned paper still gains the spacing its type requires.
    expect(next.paper.spacing).toBeGreaterThan(0);
    expect(page.paper.color, "the original page is untouched").toBe(DEFAULT_PAPER_COLOR);
  });

  it("normalises what it is given rather than trusting it", () => {
    const page = new Page({ id: "page-1", paper: { type: "grid", color: "#FFF" } as PagePaper });
    // Whatever the factory does to a value, a constructed page gets the same
    // treatment as one built through withPaper.
    expect(page.paper).toEqual(
      new Page({ id: "page-2" }).withPaper({ type: "grid", color: "#FFF" }).paper,
    );
  });
});
