import {
  createEditorHistoryManager,
  createHistoryController,
  type EditorCommand,
  type HistoryDocumentSession,
  type IHistoryController,
} from "@folio/history";
import { describe, expect, it } from "vitest";
import { installEditorHistoryShortcuts } from "../history/editor-history-shortcuts";

interface CounterDocument {
  readonly value: number;
}

describe("Editor History keyboard shortcuts", () => {
  it("maps Ctrl+Z, Ctrl+Shift+Z, and Ctrl+Y to the existing controller", () => {
    const fixture = createHistoryFixture();
    const target = new TestKeyboardTarget();
    const uninstall = installEditorHistoryShortcuts({
      controller: fixture.controller,
      eventTarget: target,
    });
    fixture.controller.executeCommand(createCounterCommand("one"));

    expect(target.keydown({ key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(fixture.current.value).toBe(0);
    expect(target.keydown({ key: "Z", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(fixture.current.value).toBe(1);
    target.keydown({ key: "z", ctrlKey: true });
    expect(target.keydown({ key: "y", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(fixture.current.value).toBe(1);
    uninstall();
    fixture.controller.destroy();
  });

  it("undoes and redoes a committed transaction as one keyboard step", () => {
    const fixture = createHistoryFixture();
    const target = new TestKeyboardTarget();
    const uninstall = installEditorHistoryShortcuts({
      controller: fixture.controller,
      eventTarget: target,
    });
    fixture.controller.beginTransaction({
      id: "group",
      timestamp: "2026-07-28T09:00:00.000Z",
      description: "Grouped counters",
    });
    fixture.controller.executeCommand(createCounterCommand("one"));
    fixture.controller.executeCommand(createCounterCommand("two"));
    fixture.controller.commitTransaction();

    target.keydown({ key: "z", ctrlKey: true });
    expect(fixture.current.value).toBe(0);
    expect(fixture.controller.getHistoryState()).toMatchObject({ undoDepth: 0, redoDepth: 1 });
    target.keydown({ key: "z", ctrlKey: true, shiftKey: true });
    expect(fixture.current.value).toBe(2);
    expect(fixture.controller.getHistoryState()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
    uninstall();
    fixture.controller.destroy();
  });

  it("handles repeated keydown events until the corresponding stack is empty", () => {
    const fixture = createHistoryFixture();
    const target = new TestKeyboardTarget();
    const uninstall = installEditorHistoryShortcuts({
      controller: fixture.controller,
      eventTarget: target,
    });
    fixture.controller.executeCommand(createCounterCommand("one"));
    fixture.controller.executeCommand(createCounterCommand("two"));
    fixture.controller.executeCommand(createCounterCommand("three"));

    expect(target.keydown({ key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(target.keydown({ key: "z", ctrlKey: true, repeat: true }).defaultPrevented).toBe(true);
    expect(target.keydown({ key: "z", ctrlKey: true, repeat: true }).defaultPrevented).toBe(true);
    expect(target.keydown({ key: "z", ctrlKey: true, repeat: true }).defaultPrevented).toBe(false);
    expect(fixture.current.value).toBe(0);

    expect(target.keydown({ key: "z", ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    expect(
      target.keydown({ key: "z", ctrlKey: true, shiftKey: true, repeat: true }).defaultPrevented,
    ).toBe(true);
    expect(
      target.keydown({ key: "z", ctrlKey: true, shiftKey: true, repeat: true }).defaultPrevented,
    ).toBe(true);
    expect(
      target.keydown({ key: "z", ctrlKey: true, shiftKey: true, repeat: true }).defaultPrevented,
    ).toBe(false);
    expect(fixture.current.value).toBe(3);
    uninstall();
    fixture.controller.destroy();
  });

  it("leaves browser behavior untouched when History cannot act or focus is editable", () => {
    const fixture = createHistoryFixture();
    const target = new TestKeyboardTarget();
    const uninstall = installEditorHistoryShortcuts({
      controller: fixture.controller,
      eventTarget: target,
    });

    expect(target.keydown({ key: "z", ctrlKey: true }).defaultPrevented).toBe(false);
    fixture.controller.executeCommand(createCounterCommand("one"));
    expect(
      target.keydown({ key: "z", ctrlKey: true, target: { tagName: "input" } }).defaultPrevented,
    ).toBe(false);
    expect(
      target.keydown({
        key: "z",
        ctrlKey: true,
        target: { isContentEditable: true },
      }).defaultPrevented,
    ).toBe(false);
    expect(target.keydown({ key: "z", ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(target.keydown({ key: "z", metaKey: true }).defaultPrevented).toBe(false);
    expect(
      target.keydown({ key: "z", ctrlKey: true, defaultPrevented: true }).defaultPrevented,
    ).toBe(true);
    expect(fixture.current.value).toBe(1);
    uninstall();
    fixture.controller.destroy();
  });

  it("removes its sole keydown listener before controller teardown", () => {
    const fixture = createHistoryFixture();
    const target = new TestKeyboardTarget();
    const uninstall = installEditorHistoryShortcuts({
      controller: fixture.controller,
      eventTarget: target,
    });
    fixture.controller.executeCommand(createCounterCommand("one"));

    expect(target.listenerCount).toBe(1);
    uninstall();
    uninstall();
    expect(target.listenerCount).toBe(0);
    expect(target.keydown({ key: "z", ctrlKey: true }).defaultPrevented).toBe(false);
    expect(fixture.current.value).toBe(1);
    fixture.controller.destroy();
  });
});

function createHistoryFixture(): {
  readonly controller: IHistoryController<CounterDocument>;
  readonly current: CounterDocument;
} {
  let current: CounterDocument = Object.freeze({ value: 0 });
  const documentSession: HistoryDocumentSession<CounterDocument> = Object.freeze({
    getDocument: () => current,
    replaceDocument: (document: CounterDocument) => {
      current = document;
    },
  });
  const manager = createEditorHistoryManager({ documentSession });
  const controller = createHistoryController({ manager });
  return {
    controller,
    get current() {
      return current;
    },
  };
}

function createCounterCommand(id: string): EditorCommand<CounterDocument> {
  return Object.freeze({
    id,
    timestamp: "2026-07-28T09:00:00.000Z",
    description: `Increment ${id}`,
    execute: (document: CounterDocument) => Object.freeze({ value: document.value + 1 }),
    undo: (document: CounterDocument) => Object.freeze({ value: document.value - 1 }),
    redo: (document: CounterDocument) => Object.freeze({ value: document.value + 1 }),
  });
}

interface TestKeyboardInput {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly repeat?: boolean;
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
      isComposing: false,
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
