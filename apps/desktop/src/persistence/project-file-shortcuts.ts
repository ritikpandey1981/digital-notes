import type { ProjectFileCommands } from "./project-file-commands";

interface ProjectFileShortcutOptions {
  readonly commands: ProjectFileCommands;
  readonly eventTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  /** Where to look for an open modal. Injected so this can be tested headlessly. */
  readonly ownerDocument?: Pick<Document, "querySelector">;
  readonly onError?: (error: Error) => void;
}

/**
 * Registers the application's file shortcuts for one mounted shell.
 *
 * These are shell commands, not editing ones: New, Open, Save and Save As
 * decide the fate of the whole project, so they live beside the menu that
 * offers them rather than inside the canvas, which keeps Undo, Redo, Space and
 * the tool keys. One listener, installed once.
 *
 * Unlike the editing shortcuts, these stay live while focus is in a text field
 * -- Ctrl+S means save on a desktop wherever the caret happens to be -- but
 * they stand down for a modal, which owns the keyboard for as long as it is
 * asking something.
 */
export function installProjectFileShortcuts(options: ProjectFileShortcutOptions): () => void {
  const eventTarget = options.eventTarget ?? window;
  const listener: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    const command = resolveCommand(keyboardEvent, options);
    if (command === null) return;
    keyboardEvent.preventDefault();
    try {
      void command().catch((cause: unknown) => report(options, cause));
    } catch (cause) {
      report(options, cause);
    }
  };

  eventTarget.addEventListener("keydown", listener);
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    eventTarget.removeEventListener("keydown", listener);
  };
}

function report(options: ProjectFileShortcutOptions, cause: unknown): void {
  options.onError?.(
    cause instanceof Error ? cause : new Error("Project file shortcut failed.", { cause }),
  );
}

function resolveCommand(
  event: KeyboardEvent,
  options: ProjectFileShortcutOptions,
): (() => Promise<void>) | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (!event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isModalOpen(options.ownerDocument)) return null;
  const key = event.key.toLowerCase();
  if (key === "s") return event.shiftKey ? options.commands.saveAs : options.commands.save;
  if (event.shiftKey) return null;
  if (key === "n") return options.commands.newProject;
  if (key === "o") return options.commands.openProject;
  return null;
}

/** A dialog asking the user something owns the keyboard until it is answered. */
function isModalOpen(ownerDocument: Pick<Document, "querySelector"> | undefined): boolean {
  const target = ownerDocument ?? (typeof document === "undefined" ? undefined : document);
  return target?.querySelector('[role="dialog"][data-state="open"]') != null;
}
