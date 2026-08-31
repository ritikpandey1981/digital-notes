/**
 * Whether a keyboard event landed on a control that owns its own key handling.
 *
 * Some editor shortcuts are bound at the window: Space, most notably, holds the
 * transient viewport pan. A window-level binding that claims a key
 * unconditionally steals it from whatever the user has actually focused, and
 * Space is exactly the key that activates buttons, radios, checkboxes and
 * switches. Without this the canvas pans while a focused control sits inert.
 *
 * The check is deliberately semantic rather than a list of components. Anything
 * presenting itself as an interactive control -- by tag, by contenteditable, or
 * by ARIA role -- keeps its own keys, so this improves keyboard correctness
 * everywhere rather than carving out one exception for one widget. It stays a
 * predicate: no focus manager, no key registry, no interception.
 *
 * The decision is a pure function of a small description, and the DOM walk is a
 * thin adapter over it. That keeps the rules testable in this repository, which
 * has no DOM test environment, without pulling one in for one helper.
 */

/** Tags that are interactive controls in their own right. */
const INTERACTIVE_TAGS: ReadonlySet<string> = new Set([
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
  "AUDIO",
  "VIDEO",
  "SUMMARY",
  "DETAILS",
]);

/**
 * ARIA roles whose controls are keyboard-operated.
 *
 * These are the roles whose activation or adjustment keys overlap with editor
 * shortcuts. An SVG cell carrying `role="radio"` is as much a control as a
 * `<button>`, and must be treated as one.
 */
const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

/** Tags whose content the user types into, and which own every printable key. */
const EDITABLE_TAGS: ReadonlySet<string> = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/** Everything the decision needs, with no DOM types involved. */
export interface KeyboardTargetDescription {
  readonly tagName: string;
  readonly role: string | null;
  readonly contentEditable: boolean;
  readonly disabled: boolean;
  /** Anchors are only controls when they lead somewhere. */
  readonly hasHref: boolean;
}

/** The editable half of the decision, as a pure rule. */
export function describesEditableTarget(target: KeyboardTargetDescription): boolean {
  return target.contentEditable || EDITABLE_TAGS.has(target.tagName.toUpperCase());
}

/** The full rule: does this target own the key itself? */
export function describesInteractiveControl(target: KeyboardTargetDescription): boolean {
  if (describesEditableTarget(target)) return true;
  // A disabled control cannot act on the key, so a shortcut may keep it.
  if (target.disabled) return false;
  if (target.role !== null && target.role.trim().length > 0) {
    // An explicit role wins over the tag, which is what lets a semantic SVG
    // control be recognised and a presentational element opt out.
    return INTERACTIVE_ROLES.has(target.role.trim().toLowerCase());
  }
  const tag = target.tagName.toUpperCase();
  if (tag === "A") return target.hasHref;
  return INTERACTIVE_TAGS.has(tag);
}

/** The selector for the nearest thing that might own its own keys. */
const CONTROL_SELECTOR =
  "button, input, select, textarea, a, audio, video, summary, details, [contenteditable], [role]";

function describeElement(element: Element): KeyboardTargetDescription {
  return {
    tagName: element.tagName,
    role: element.getAttribute("role"),
    contentEditable: element instanceof HTMLElement && element.isContentEditable,
    disabled: element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
    hasHref: element.hasAttribute("href"),
  };
}

/** Editable targets, which own every printable key including Space. */
export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return describesEditableTarget(describeElement(target));
}

/**
 * True when the target is a control that should receive the key itself.
 *
 * Covers editable targets too, so a caller wanting "anything owning its own
 * keys" needs only this one predicate.
 */
export function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  // `closest` rather than the element itself: a press very often lands on the
  // glyph or path inside a control rather than on the control's own node.
  const control = target.closest<Element>(CONTROL_SELECTOR);
  if (control === null) return false;
  return describesInteractiveControl(describeElement(control));
}
