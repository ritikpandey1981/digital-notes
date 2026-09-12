import { describe, expect, it, vi } from "vitest";
import { installProjectFileShortcuts } from "../project-file-shortcuts";
import type { ProjectFileCommands } from "../project-file-commands";

interface PressOptions {
  readonly key: string;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly isComposing?: boolean;
  readonly defaultPrevented?: boolean;
  readonly target?: unknown;
}

function setup(options: { readonly modalOpen?: boolean } = {}) {
  const listeners = new Set<EventListener>();
  const eventTarget = {
    addEventListener: (_type: string, listener: EventListener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: EventListener) => listeners.delete(listener),
  };
  const commands: ProjectFileCommands = {
    newProject: vi.fn(async () => undefined),
    openProject: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    saveAs: vi.fn(async () => undefined),
  };
  const querySelector = vi.fn(() => (options.modalOpen === true ? ({} as Element) : null));
  const onError = vi.fn();
  const release = installProjectFileShortcuts({
    commands,
    eventTarget,
    ownerDocument: { querySelector } as unknown as Pick<Document, "querySelector">,
    onError,
  });

  const press = (press: PressOptions) => {
    const event = {
      key: press.key,
      ctrlKey: press.ctrlKey ?? true,
      shiftKey: press.shiftKey ?? false,
      metaKey: press.metaKey ?? false,
      altKey: press.altKey ?? false,
      isComposing: press.isComposing ?? false,
      defaultPrevented: press.defaultPrevented ?? false,
      target: press.target ?? null,
      preventDefault(): void {
        (this as { defaultPrevented: boolean }).defaultPrevented = true;
      },
    };
    for (const listener of [...listeners]) listener(event as unknown as Event);
    return event;
  };

  const calls = () => ({
    newProject: vi.mocked(commands.newProject).mock.calls.length,
    openProject: vi.mocked(commands.openProject).mock.calls.length,
    save: vi.mocked(commands.save).mock.calls.length,
    saveAs: vi.mocked(commands.saveAs).mock.calls.length,
  });

  return { commands, press, calls, release, onError, querySelector, size: () => listeners.size };
}

describe("application file shortcuts", () => {
  it("routes each standard accelerator to exactly one command", () => {
    const s = setup();
    try {
      expect(s.press({ key: "n" }).defaultPrevented).toBe(true);
      expect(s.calls()).toEqual({ newProject: 1, openProject: 0, save: 0, saveAs: 0 });

      expect(s.press({ key: "o" }).defaultPrevented).toBe(true);
      expect(s.calls()).toEqual({ newProject: 1, openProject: 1, save: 0, saveAs: 0 });

      expect(s.press({ key: "s" }).defaultPrevented).toBe(true);
      expect(s.calls()).toEqual({ newProject: 1, openProject: 1, save: 1, saveAs: 0 });

      // Shift is the only thing that separates Save from Save As, so it must
      // never reach both.
      expect(s.press({ key: "S", shiftKey: true }).defaultPrevented).toBe(true);
      expect(s.calls()).toEqual({ newProject: 1, openProject: 1, save: 1, saveAs: 1 });
    } finally {
      s.release();
    }
  });

  it("leaves every other keystroke alone", () => {
    const s = setup();
    try {
      for (const press of [
        { key: "z" },
        { key: "y" },
        { key: "s", ctrlKey: false },
        { key: "s", metaKey: true },
        { key: "s", altKey: true },
        { key: "n", shiftKey: true },
        { key: "o", shiftKey: true },
        { key: "s", isComposing: true },
        { key: "s", defaultPrevented: true },
      ])
        expect(s.press(press).defaultPrevented, `${press.key} was claimed`).toBe(
          press.defaultPrevented === true,
        );
      expect(s.calls()).toEqual({ newProject: 0, openProject: 0, save: 0, saveAs: 0 });
    } finally {
      s.release();
    }
  });

  it("stands down while a dialog is asking the user something", () => {
    const s = setup({ modalOpen: true });
    try {
      for (const key of ["n", "o", "s"]) expect(s.press({ key }).defaultPrevented).toBe(false);
      expect(s.calls()).toEqual({ newProject: 0, openProject: 0, save: 0, saveAs: 0 });
      expect(s.querySelector).toHaveBeenCalledWith('[role="dialog"][data-state="open"]');
    } finally {
      s.release();
    }
  });

  it("still saves while the caret is in a text field", () => {
    const s = setup();
    try {
      // Unlike the editing shortcuts, Ctrl+S means save wherever focus is.
      expect(s.press({ key: "s", target: { tagName: "INPUT" } }).defaultPrevented).toBe(true);
      expect(s.calls().save).toBe(1);
    } finally {
      s.release();
    }
  });

  it("reports a command that rejects instead of losing it", async () => {
    const s = setup();
    try {
      vi.mocked(s.commands.save).mockRejectedValue(new Error("save exploded"));
      s.press({ key: "s" });
      await Promise.resolve();
      await Promise.resolve();

      expect(s.onError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "save exploded",
        }),
      );
    } finally {
      s.release();
    }
  });

  it("installs one listener and removes it exactly once", () => {
    const s = setup();
    expect(s.size()).toBe(1);
    s.release();
    expect(s.size()).toBe(0);
    s.release();
    expect(s.size()).toBe(0);
    s.press({ key: "s" });
    expect(s.calls().save).toBe(0);
  });
});
