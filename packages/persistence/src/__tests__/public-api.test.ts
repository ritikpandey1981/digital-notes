import { describe, expect, it } from "vitest";
import {
  CURRENT_NOTEBOOK_FORMAT_VERSION,
  CURRENT_RECOVERY_FORMAT_VERSION,
  PersistenceError,
  isPersistenceError,
} from "../index";

describe("@folio/persistence public API", () => {
  it("exposes explicit current format versions", () => {
    expect(CURRENT_NOTEBOOK_FORMAT_VERSION).toBe(1);
    expect(CURRENT_RECOVERY_FORMAT_VERSION).toBe(1);
  });

  it("provides a reliable structured-error type guard", () => {
    const error = new PersistenceError("MISSING_FILE", "Missing.", {
      path: "metadata.json",
      details: { required: true },
    });

    expect(isPersistenceError(error)).toBe(true);
    expect(isPersistenceError(new Error("ordinary"))).toBe(false);
    expect(error).toMatchObject({
      name: "PersistenceError",
      code: "MISSING_FILE",
      path: "metadata.json",
      details: { required: true },
    });
  });
});
