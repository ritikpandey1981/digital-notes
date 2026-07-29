export interface EditorEditingShortcutActions {
  readonly copy: () => boolean;
  readonly cut: () => boolean;
  readonly paste: () => boolean;
  readonly duplicate: () => boolean;
  readonly selectAll: () => boolean;
  readonly deleteSelection: () => boolean;
}

interface EditorEditingShortcutOptions {
  readonly actions: EditorEditingShortcutActions;
  readonly eventTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  readonly onError?: (error: Error) => void;
}

/** Registers session-scoped Windows/Linux editing shortcuts. */
export function installEditorEditingShortcuts(options: EditorEditingShortcutOptions): () => void {
  const eventTarget = options.eventTarget ?? window;
  const listener: EventListener = (event) => {
    const keyboardEvent = event as KeyboardEvent;
    const action = resolveAction(keyboardEvent, options.actions);
    if (action === null) return;
    try {
      if (!action()) return;
      keyboardEvent.preventDefault();
    } catch (cause) {
      options.onError?.(
        cause instanceof Error ? cause : new Error("Editor shortcut failed.", { cause }),
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

function resolveAction(
  event: KeyboardEvent,
  actions: EditorEditingShortcutActions,
): (() => boolean) | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.metaKey ||
    event.altKey ||
    isEditableTarget(event.target)
  ) {
    return null;
  }
  const key = event.key.toLowerCase();
  if (!event.ctrlKey && !event.shiftKey && (key === "delete" || key === "backspace")) {
    return actions.deleteSelection;
  }
  if (!event.ctrlKey || event.shiftKey) return null;
  return (
    (
      {
        a: actions.selectAll,
        c: actions.copy,
        d: actions.duplicate,
        v: actions.paste,
        x: actions.cut,
      } as const
    )[key as "a" | "c" | "d" | "v" | "x"] ?? null
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const candidate = target as { readonly isContentEditable?: unknown; readonly tagName?: unknown };
  if (candidate.isContentEditable === true) return true;
  if (typeof candidate.tagName !== "string") return false;
  return ["INPUT", "SELECT", "TEXTAREA"].includes(candidate.tagName.toUpperCase());
}
