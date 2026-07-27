import { describe, expect, it } from "vitest";
import * as editor from "../index";

describe("@folio/editor public API", () => {
  it("exposes only the application-facing canvas adapter at runtime", () => {
    expect(Object.keys(editor).sort()).toEqual(["CanvasSurface"]);
  });
});
