import type { EditorTool, ShapeToolKind } from "../editor/editor-types";

export interface ContextHintContext {
  readonly tool: EditorTool;
  readonly shapeKind?: ShapeToolKind;
  readonly navigationTeachingAvailable?: boolean;
}

export interface ContextHint {
  readonly id: string;
  readonly tool?: EditorTool;
  readonly shapeKind?: ShapeToolKind;
  readonly text: string;
}

export interface ContextHintRegistry {
  readonly resolve: (context: ContextHintContext) => ContextHint | null;
  readonly registeredTools: () => readonly EditorTool[];
}

const defaultHints: readonly ContextHint[] = Object.freeze([
  Object.freeze({
    id: "select-overlapping-object",
    tool: "Select",
    text: "Tip: Alt + Click → Select object beneath",
  }),
  Object.freeze({
    id: "shape-perfect-square",
    tool: "Shapes",
    shapeKind: "rectangle",
    text: "Tip: Hold Shift → Draw a perfect square",
  }),
  Object.freeze({
    id: "shape-perfect-circle",
    tool: "Shapes",
    shapeKind: "ellipse",
    text: "Tip: Hold Shift → Draw a perfect circle",
  }),
  Object.freeze({
    id: "canvas-navigation-space-drag",
    text: "Tip: Hold Space + Drag → Move canvas",
  }),
]);

export function createContextHintRegistry(
  hints: readonly ContextHint[] = defaultHints,
): ContextHintRegistry {
  const entries = new Map<string, ContextHint>();
  for (const hint of hints) {
    const key = contextKey(hint);
    if (entries.has(key)) throw new Error(`Context hint already registered for ${key}.`);
    entries.set(key, Object.freeze({ ...hint }));
  }
  return Object.freeze({
    resolve: (context: ContextHintContext): ContextHint | null => {
      const specific =
        entries.get(contextKey(context)) ?? entries.get(contextKey({ tool: context.tool }));
      if (specific !== undefined) return specific;
      return context.navigationTeachingAvailable === true
        ? (entries.get(contextKey({})) ?? null)
        : null;
    },
    registeredTools: (): readonly EditorTool[] =>
      Object.freeze([...new Set(hints.flatMap(({ tool }) => (tool === undefined ? [] : [tool])))]),
  });
}

function contextKey(context: Pick<ContextHint, "tool" | "shapeKind">): string {
  return `${context.tool ?? "*"}:${context.shapeKind ?? ""}`;
}
