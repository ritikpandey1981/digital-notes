import { describe, expect, it } from "vitest";
import {
  describesEditableTarget,
  describesInteractiveControl,
  type KeyboardTargetDescription,
} from "../interactive-keyboard-target";

function target(patch: Partial<KeyboardTargetDescription> = {}): KeyboardTargetDescription {
  return {
    tagName: "DIV",
    role: null,
    contentEditable: false,
    disabled: false,
    hasHref: false,
    ...patch,
  };
}

describe("editable targets", () => {
  it("recognises the fields that own every printable key", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(describesEditableTarget(target({ tagName })), tagName).toBe(true);
    }
  });

  it("recognises a contenteditable region", () => {
    expect(describesEditableTarget(target({ contentEditable: true }))).toBe(true);
  });

  it("leaves a plain region alone", () => {
    expect(describesEditableTarget(target())).toBe(false);
    expect(describesEditableTarget(target({ tagName: "CANVAS" }))).toBe(false);
  });
});

describe("interactive controls", () => {
  it("recognises native controls", () => {
    for (const tagName of ["BUTTON", "INPUT", "TEXTAREA", "SELECT", "SUMMARY", "DETAILS"]) {
      expect(describesInteractiveControl(target({ tagName })), tagName).toBe(true);
    }
  });

  it("recognises a semantic SVG control by its role", () => {
    // The Brush Library's annular cells are exactly this: real controls that
    // are not native buttons, and Space must reach them rather than panning.
    expect(describesInteractiveControl(target({ tagName: "g", role: "radio" }))).toBe(true);
  });

  it("recognises every role whose keys overlap editor shortcuts", () => {
    for (const role of [
      "button",
      "checkbox",
      "switch",
      "slider",
      "option",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "tab",
      "combobox",
      "listbox",
      "spinbutton",
      "textbox",
      "searchbox",
      "treeitem",
      "link",
      "radio",
    ]) {
      expect(describesInteractiveControl(target({ role })), role).toBe(true);
    }
  });

  it("is not case- or whitespace-sensitive about the role", () => {
    expect(describesInteractiveControl(target({ role: " Radio " }))).toBe(true);
  });

  it("leaves the canvas and plain workspace alone", () => {
    expect(describesInteractiveControl(target({ tagName: "CANVAS" }))).toBe(false);
    expect(describesInteractiveControl(target({ tagName: "DIV" }))).toBe(false);
    expect(describesInteractiveControl(target({ tagName: "g" }))).toBe(false);
    expect(describesInteractiveControl(target({ tagName: "svg" }))).toBe(false);
  });

  it("lets a presentational or grouping role opt out", () => {
    // An explicit role wins over the tag, so the wheel's own radiogroup
    // wrapper does not claim keys its cells will handle.
    for (const role of ["presentation", "none", "group", "radiogroup", "toolbar", "img"]) {
      expect(describesInteractiveControl(target({ role })), role).toBe(false);
    }
  });

  it("releases the key for a disabled control", () => {
    expect(describesInteractiveControl(target({ tagName: "BUTTON", disabled: true }))).toBe(false);
    expect(describesInteractiveControl(target({ role: "radio", disabled: true }))).toBe(false);
  });

  it("treats an anchor as a control only when it leads somewhere", () => {
    expect(describesInteractiveControl(target({ tagName: "A", hasHref: true }))).toBe(true);
    expect(describesInteractiveControl(target({ tagName: "A" }))).toBe(false);
  });

  it("still yields the key to an editable target even when disabled-looking", () => {
    // Typing wins: an editable region owns printable keys unconditionally.
    expect(describesInteractiveControl(target({ tagName: "INPUT", disabled: true }))).toBe(true);
  });
});
