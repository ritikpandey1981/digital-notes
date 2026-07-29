export type EditorToolPointerPhase = "down" | "move" | "up" | "cancel";
export type EditorToolKeyboardPhase = "down" | "up";

export interface EditorToolContext {
  readonly setCursor: (cursor: string) => void;
  readonly requestTemporaryRender: () => void;
}

export interface EditorTool {
  readonly id: string;
  readonly cursor: string;
  readonly activate?: (context: EditorToolContext) => void;
  readonly deactivate?: () => void;
  readonly pointerDown?: (event: PointerEvent) => void;
  readonly pointerMove?: (event: PointerEvent) => void;
  readonly pointerUp?: (event: PointerEvent) => void;
  readonly pointerCancel?: (event: PointerEvent) => void;
  readonly keyboardDown?: (event: KeyboardEvent) => void;
  readonly keyboardUp?: (event: KeyboardEvent) => void;
  readonly renderTemporary?: () => void;
  readonly cleanup?: () => void;
}

export interface EditorToolRegistrySnapshot {
  readonly activeToolId: string | null;
  readonly registeredToolIds: readonly string[];
  readonly version: number;
  readonly destroyed: boolean;
}

export interface EditorToolRegistry {
  readonly register: (tool: EditorTool) => void;
  readonly unregister: (toolId: string) => boolean;
  readonly activate: (toolId: string) => EditorToolRegistrySnapshot;
  readonly handlePointer: (phase: EditorToolPointerPhase, event: PointerEvent) => void;
  readonly handleKeyboard: (phase: EditorToolKeyboardPhase, event: KeyboardEvent) => void;
  readonly renderTemporary: () => void;
  readonly snapshot: () => EditorToolRegistrySnapshot;
  readonly destroy: () => void;
}

class EditorToolRegistryImplementation implements EditorToolRegistry {
  readonly #context: EditorToolContext;
  readonly #tools = new Map<string, EditorTool>();
  #activeTool: EditorTool | null = null;
  #version = 0;
  #destroyed = false;

  constructor(context: EditorToolContext) {
    this.#context = Object.freeze({ ...context });
  }

  register(tool: EditorTool): void {
    this.#assertActive();
    if (tool.id.trim().length === 0) throw new TypeError("Editor tools require an identity.");
    if (this.#tools.has(tool.id)) {
      throw new TypeError("Editor tool '" + tool.id + "' is registered.");
    }
    this.#tools.set(tool.id, tool);
    this.#version += 1;
  }

  unregister(toolId: string): boolean {
    this.#assertActive();
    const tool = this.#tools.get(toolId);
    if (tool === undefined) return false;
    if (tool === this.#activeTool) {
      tool.deactivate?.();
      this.#activeTool = null;
      this.#context.setCursor("default");
    }
    tool.cleanup?.();
    this.#tools.delete(toolId);
    this.#version += 1;
    return true;
  }

  activate(toolId: string): EditorToolRegistrySnapshot {
    this.#assertActive();
    const next = this.#tools.get(toolId);
    if (next === undefined) throw new TypeError("Editor tool '" + toolId + "' is not registered.");
    if (next === this.#activeTool) return this.snapshot();
    const previous = this.#activeTool;
    previous?.deactivate?.();
    try {
      next.activate?.(this.#context);
    } catch (cause) {
      previous?.activate?.(this.#context);
      throw cause;
    }
    this.#activeTool = next;
    this.#context.setCursor(next.cursor);
    this.#version += 1;
    return this.snapshot();
  }

  handlePointer(phase: EditorToolPointerPhase, event: PointerEvent): void {
    this.#assertActive();
    const tool = this.#activeTool;
    if (tool === null) return;
    const handlers = {
      down: tool.pointerDown,
      move: tool.pointerMove,
      up: tool.pointerUp,
      cancel: tool.pointerCancel,
    } as const;
    handlers[phase]?.(event);
  }

  handleKeyboard(phase: EditorToolKeyboardPhase, event: KeyboardEvent): void {
    this.#assertActive();
    const tool = this.#activeTool;
    if (tool === null) return;
    (phase === "down" ? tool.keyboardDown : tool.keyboardUp)?.(event);
  }

  renderTemporary(): void {
    this.#assertActive();
    this.#activeTool?.renderTemporary?.();
  }

  snapshot(): EditorToolRegistrySnapshot {
    return Object.freeze({
      activeToolId: this.#activeTool?.id ?? null,
      registeredToolIds: Object.freeze([...this.#tools.keys()]),
      version: this.#version,
      destroyed: this.#destroyed,
    });
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#activeTool?.deactivate?.();
    this.#activeTool = null;
    for (const tool of this.#tools.values()) tool.cleanup?.();
    this.#tools.clear();
    this.#context.setCursor("default");
    this.#version += 1;
    this.#destroyed = true;
  }

  #assertActive(): void {
    if (this.#destroyed) throw new Error("The editor tool registry is destroyed.");
  }
}

export function createEditorToolRegistry(context: EditorToolContext): EditorToolRegistry {
  return new EditorToolRegistryImplementation(context);
}
