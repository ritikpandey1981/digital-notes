import { describe, expect, it } from "vitest";
import { createDeleteManipulationResult, createDuplicateManipulationResult } from "../index";

describe("object lifecycle manipulation results", () => {
  it("creates immutable delete and duplicate variants", () => {
    const input = { objectId: "object-1", sessionId: "session-1", sessionTimestamp: 42 };
    const deletion = createDeleteManipulationResult(input);
    const duplication = createDuplicateManipulationResult(input);

    expect(deletion).toEqual({
      kind: "delete",
      objectId: "object-1",
      sessionId: "session-1",
      sessionTimestamp: 42,
    });
    expect(duplication).toEqual({ ...deletion, kind: "duplicate" });
    expect(Object.isFrozen(deletion)).toBe(true);
    expect(Object.isFrozen(duplication)).toBe(true);
  });

  it.each([
    () => createDeleteManipulationResult(null as never),
    () => createDeleteManipulationResult({ objectId: " " }),
    () =>
      createDuplicateManipulationResult({
        objectId: "object-1",
        sessionId: " ",
      }),
    () =>
      createDuplicateManipulationResult({
        objectId: "object-1",
        sessionTimestamp: Number.NaN,
      }),
  ])("rejects invalid logical result input", (create) => {
    expect(create).toThrow(TypeError);
  });
});
