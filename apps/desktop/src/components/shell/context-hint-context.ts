import { createContext, useContext } from "react";
import type { EditorTool } from "../editor/editor-types";
import type { ContextHint, ContextHintRegistry } from "./context-hint-registry";

export const ContextHintRegistryContext = createContext<ContextHintRegistry | null>(null);

export function useContextHint(tool: EditorTool): ContextHint | null {
  const registry = useContext(ContextHintRegistryContext);
  if (registry === null) throw new Error("Context hints require ContextHintProvider.");
  return registry.resolve(tool);
}
