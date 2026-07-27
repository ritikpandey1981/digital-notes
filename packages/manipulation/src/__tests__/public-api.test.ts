import { describe, expect, it } from "vitest";
import * as manipulation from "../index";

describe("@folio/manipulation public API", () => {
  it("exposes only factories and frozen centralized configuration at runtime", () => {
    expect(Object.keys(manipulation).sort()).toEqual([
      "DEFAULT_MANIPULATION_CONFIGURATION",
      "createManipulationController",
      "createManipulationManager",
      "createTranslationEngine",
    ]);
    expect(Object.isFrozen(manipulation.DEFAULT_MANIPULATION_CONFIGURATION)).toBe(true);
  });
});
