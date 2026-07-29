import { describe, expect, it, vi } from "vitest";
import {
  installEditorEditingShortcuts,
  type EditorEditingShortcutActions,
} from "../history/editor-editing-shortcuts";

describe("Editor editing keyboard shortcuts", () => {
  it("maps copy, cut, paste, duplicate, select-all, delete, and backspace", () => {
    const target = new TestKeyboardTarget();
    const actions = createActions();
    const uninstall = installEditorEditingShortcuts({ actions, eventTarget: target });

    for (const input of [
      { key: "c", ctrlKey: true },
      { key: "x", ctrlKey: true },
      { key: "v", ctrlKey: true },
      { key: "d", ctrlKey: true },
      { key: "a", ctrlKey: true },
      { key: "Delete" },
      { key: "Backspace", repeat: true },
    ]) {
      expect(target.keydown(input).defaultPrevented).toBe(true);
    }
    expect(actions.copy).toHaveBeenCalledOnce();
    expect(actions.cut).toHaveBeenCalledOnce();
    expect(actions.paste).toHaveBeenCalledOnce();
    expect(actions.duplicate).toHaveBeenCalledOnce();
    expect(actions.selectAll).toHaveBeenCalledOnce();
    expect(actions.deleteSelection).toHaveBeenCalledTimes(2);
    uninstall();
  });

  it("suppresses browser defaults only after the editor handles an action", () => {
    const target = new TestKeyboardTarget();
    const actions = createActions({ copy: false, paste: false, deleteSelection: false });
    const uninstall = installEditorEditingShortcuts({ actions, eventTarget: target });

    expect(target.keydown({ key: "c", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(target.keydown({ key: "v", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(target.keydown({ key: "Delete" }).defaultPrevented).toBe(false);
    expect(target.keydown({ key: "d", ctrlKey: true }).defaultPrevented).toBe(true);
    uninstall();
  });

  it("ignores modified, composing, prehandled, and editable-target events", () => {
    const target = new TestKeyboardTarget();
    const actions = createActions();
    const uninstall = installEditorEditingShortcuts({ actions, eventTarget: target });

    expect(target.keydown({ key: "c", metaKey: true }).defaultPrevented).toBe(false);
    expect(target.keydown({ key: "c", ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(target.keydown({ key: "c", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(
      false,
    );
    expect(
      target.keydown({ key: "c", ctrlKey: true, target: { tagName: "textarea" } }).defaultPrevented,
    ).toBe(false);
    expect(
      target.keydown({ key: "c", ctrlKey: true, target: { isContentEditable: true } })
        .defaultPrevented,
    ).toBe(false);
    expect(target.keydown({ key: "c", ctrlKey: true, isComposing: true }).defaultPrevented).toBe(
      false,
    );
    expect(
      target.keydown({ key: "c", ctrlKey: true, defaultPrevented: true }).defaultPrevented,
    ).toBe(true);
    expect(actions.copy).not.toHaveBeenCalled();
    uninstall();
  });

  it("isolates action failures and removes its listener idempotently", () => {
    const target = new TestKeyboardTarget();
    const onError = vi.fn();
    const actions = createActions();
    actions.cut.mockImplementation(() => {
      throw new Error("cut failed");
    });
    const uninstall = installEditorEditingShortcuts({ actions, eventTarget: target, onError });

    expect(target.keydown({ key: "x", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "cut failed" }));
    expect(target.listenerCount).toBe(1);
    uninstall();
    uninstall();
    expect(target.listenerCount).toBe(0);
    expect(target.keydown({ key: "d", ctrlKey: true }).defaultPrevented).toBe(false);
  });
});

function createActions(results: Partial<Record<keyof EditorEditingShortcutActions, boolean>> = {}) {
  return {
    copy: vi.fn(() => results.copy ?? true),
    cut: vi.fn(() => results.cut ?? true),
    paste: vi.fn(() => results.paste ?? true),
    duplicate: vi.fn(() => results.duplicate ?? true),
    selectAll: vi.fn(() => results.selectAll ?? true),
    deleteSelection: vi.fn(() => results.deleteSelection ?? true),
  };
}

interface TestKeyboardInput {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly repeat?: boolean;
  readonly isComposing?: boolean;
  readonly defaultPrevented?: boolean;
  readonly target?: object;
}

class TestKeyboardTarget implements Pick<EventTarget, "addEventListener" | "removeEventListener"> {
  readonly #listeners = new Set<EventListenerOrEventListenerObject>();

  get listenerCount(): number {
    return this.#listeners.size;
  }

  addEventListener(type: string, callback: EventListenerOrEventListenerObject | null): void {
    if (type === "keydown" && callback !== null) this.#listeners.add(callback);
  }

  removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null): void {
    if (type === "keydown" && callback !== null) this.#listeners.delete(callback);
  }

  keydown(input: TestKeyboardInput): KeyboardEvent {
    let prevented = input.defaultPrevented ?? false;
    const event = {
      key: input.key,
      ctrlKey: input.ctrlKey ?? false,
      shiftKey: input.shiftKey ?? false,
      altKey: input.altKey ?? false,
      metaKey: input.metaKey ?? false,
      repeat: input.repeat ?? false,
      isComposing: input.isComposing ?? false,
      target: input.target ?? null,
      get defaultPrevented() {
        return prevented;
      },
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as KeyboardEvent;
    for (const listener of [...this.#listeners]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
    return event;
  }
}
