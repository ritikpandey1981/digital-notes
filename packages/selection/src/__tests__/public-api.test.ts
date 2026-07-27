import { describe, expect, it } from "vitest";
import * as selection from "../index";

describe("@folio/selection public API", () => {
  it("exposes factories and stable configuration without concrete implementations", () => {
    expect(Object.keys(selection).sort()).toEqual([
      "DEFAULT_HIT_TEST_CONFIGURATION",
      "createHitTestEngine",
      "createSelectionController",
      "createSelectionManager",
    ]);
    expect(Object.isFrozen(selection.DEFAULT_HIT_TEST_CONFIGURATION)).toBe(true);
  });
});
