import type { EditorTool } from "../editor/editor-types";

export interface ContextHint {
  readonly id: string;
  readonly tool: EditorTool;
  readonly text: string;
}

export interface ContextHintRegistry {
  readonly resolve: (tool: EditorTool) => ContextHint | null;
  readonly registeredTools: () => readonly EditorTool[];
}

const defaultHints: readonly ContextHint[] = Object.freeze([
  Object.freeze({
    id: "select-overlapping-object",
    tool: "Select",
    text: "Tip: Alt + Click → Select object beneath",
  }),
]);

export function createContextHintRegistry(
  hints: readonly ContextHint[] = defaultHints,
): ContextHintRegistry {
  const entries = new Map<EditorTool, ContextHint>();
  for (const hint of hints) {
    if (entries.has(hint.tool))
      throw new Error(`Context hint already registered for ${hint.tool}.`);
    entries.set(hint.tool, Object.freeze({ ...hint }));
  }
  return Object.freeze({
    resolve: (tool: EditorTool): ContextHint | null => entries.get(tool) ?? null,
    registeredTools: (): readonly EditorTool[] => Object.freeze([...entries.keys()]),
  });
}
