import { useEffect } from "react";

export type EditorContextMenuAction =
  "copy" | "cut" | "paste" | "duplicate" | "delete" | "selectAll";

export interface EditorContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly canCopy: boolean;
  readonly canCut: boolean;
  readonly canPaste: boolean;
  readonly canDuplicate: boolean;
  readonly canDelete: boolean;
  readonly canSelectAll: boolean;
}

interface EditorContextMenuProps {
  readonly state: EditorContextMenuState;
  readonly onAction: (action: EditorContextMenuAction) => void;
  readonly onDismiss: () => void;
}

const ITEMS = Object.freeze([
  { action: "copy", label: "Copy", shortcut: "Ctrl+C", capability: "canCopy" },
  { action: "cut", label: "Cut", shortcut: "Ctrl+X", capability: "canCut" },
  { action: "paste", label: "Paste", shortcut: "Ctrl+V", capability: "canPaste" },
  { action: "duplicate", label: "Duplicate", shortcut: "Ctrl+D", capability: "canDuplicate" },
  { action: "delete", label: "Delete", shortcut: "Delete", capability: "canDelete" },
  { action: "selectAll", label: "Select All", shortcut: "Ctrl+A", capability: "canSelectAll" },
] as const);

/** Desktop-only editor context menu using the same session actions as keyboard input. */
export function EditorContextMenu({ state, onAction, onDismiss }: EditorContextMenuProps) {
  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [onDismiss]);

  const left = Math.max(8, Math.min(state.x, window.innerWidth - 220));
  const top = Math.max(8, Math.min(state.y, window.innerHeight - 290));
  return (
    <div
      role="presentation"
      onPointerDown={onDismiss}
      style={{ position: "fixed", inset: 0, zIndex: 1000 }}
    >
      <div
        role="menu"
        aria-label="Editor context menu"
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          position: "fixed",
          left,
          top,
          width: 212,
          padding: 6,
          border: "1px solid var(--folio-border)",
          borderRadius: 12,
          background: "var(--folio-surface)",
          color: "var(--folio-ink)",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.2)",
        }}
      >
        {ITEMS.map((item, index) => (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            disabled={!state[item.capability]}
            onClick={() => onAction(item.action)}
            style={{
              display: "flex",
              width: "100%",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              marginTop: index === 5 ? 5 : 0,
              padding: "8px 10px",
              border: 0,
              borderTop: index === 5 ? "1px solid var(--folio-border)" : undefined,
              borderRadius: 8,
              background: "transparent",
              color: "inherit",
              cursor: state[item.capability] ? "pointer" : "default",
              font: "inherit",
              opacity: state[item.capability] ? 1 : 0.42,
              textAlign: "left",
            }}
          >
            <span>{item.label}</span>
            <span style={{ color: "var(--folio-muted)", fontSize: 11 }}>{item.shortcut}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
