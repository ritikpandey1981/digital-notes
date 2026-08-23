import { Camera } from "@folio/rendering";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_VIEWPORT_SNAPSHOT,
  editorViewportWheelZoom,
  formatEditorViewportZoom,
  nextEditorViewportZoom,
} from "../EditorViewport";

describe("editor viewport policy", () => {
  it("uses rendering limits and deterministic shared zoom steps", () => {
    expect(DEFAULT_EDITOR_VIEWPORT_SNAPSHOT.minZoom).toBe(Camera.DEFAULT_MIN_ZOOM);
    expect(DEFAULT_EDITOR_VIEWPORT_SNAPSHOT.maxZoom).toBe(Camera.DEFAULT_MAX_ZOOM);
    expect(nextEditorViewportZoom(0.6, "in")).toBe(0.75);
    expect(nextEditorViewportZoom(0.6, "out")).toBe(0.5);
    expect(nextEditorViewportZoom(8, "in")).toBe(8);
    expect(nextEditorViewportZoom(0.25, "out")).toBe(0.25);
  });

  it("normalizes pixel, line, and page wheel zoom without formatting noise", () => {
    expect(editorViewportWheelZoom(1, -100, 0, 800)).toBeGreaterThan(1);
    expect(editorViewportWheelZoom(1, 3, 1, 800)).toBeLessThan(1);
    expect(editorViewportWheelZoom(1, 1, 2, 800)).toBeLessThan(0.5);
    expect(formatEditorViewportZoom(0.999_999_997)).toBe("100%");
    expect(formatEditorViewportZoom(1.254)).toBe("125%");
  });
});
