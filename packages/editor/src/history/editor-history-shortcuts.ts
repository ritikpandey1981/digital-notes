import type { IHistoryController } from "@folio/history";

interface EditorHistoryShortcutOptions<TDocument> {
  readonly controller: IHistoryController<TDocument>;
  readonly eventTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  readonly onError?: (error: Error) => void;
}

/** Registers the Windows/Linux History shortcuts for one mounted editor lifetime. */
export function installEditorHistoryShortcuts<TDocument>(
  options: EditorHistoryShortcutOptions<TDocument>,
): () => void {
  const eventTarget = options.eventTarget ?? window;
  const listener: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (!isEditorShortcut(keyboardEvent)) return;

    const key = keyboardEvent.key.toLowerCase();
    const operation =
      key === "z" && !keyboardEvent.shiftKey
        ? "undo"
        : (key === "z" && keyboardEvent.shiftKey) || (key === "y" && !keyboardEvent.shiftKey)
          ? "redo"
          : null;
    if (operation === null) return;

    try {
      const available =
        operation === "undo" ? options.controller.canUndo() : options.controller.canRedo();
      if (!available) return;
      keyboardEvent.preventDefault();
      if (operation === "undo") options.controller.undo();
      else options.controller.redo();
    } catch (cause) {
      options.onError?.(
        cause instanceof Error ? cause : new Error(`History ${operation} failed.`, { cause }),
      );
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

function isEditorShortcut(event: KeyboardEvent): boolean {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !isEditableTarget(event.target)
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const candidate = target as { readonly isContentEditable?: unknown; readonly tagName?: unknown };
  if (candidate.isContentEditable === true) return true;
  if (typeof candidate.tagName !== "string") return false;
  return ["INPUT", "SELECT", "TEXTAREA"].includes(candidate.tagName.toUpperCase());
}
